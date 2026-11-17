# Browser decision acceleration audit and TODO — November 17

Reviewed `2fba392e90039f2153501a547271cbdcd0ac6185` on `feature/browser-decision-acceleration` in `E:/project/aiFetchly-bda`. The worktree was clean at the start. Requirements come from the [PRD](browser-decision-acceleration-prd.md) and [technical design](browser-decision-acceleration-technical-design.md). The [previous pass](browser-decision-acceleration-audit-2026-11-15-pass8-todo.md) includes closure notes for the changes reviewed here.

**The requirements are still incomplete.** There are ten open defect groups and four groups of unfinished requirements or release evidence below. Three defects were reproduced with local synthetic inputs. The rest trace current production call paths and name the regression tests needed to verify them.

## Verification

| Check | November 17 result |
| --- | --- |
| Focused main-process run, browser decision, sign-in, agents, managed browser, agent permissions, accounts and proxy checks | **667 passed across 54 files**. The Vitest configuration ran its TypeScript precheck. |
| Full component suite | **1,622 passed across 183 files**. Node emitted localStorage warnings. |
| Three additional boundary checks | **3 failed as expected for the audited requirements**. The runner accepted completion despite a false URL criterion, plain prose was accepted as evidence of structured output and forced tools, and a synthetic credential survived the observation-text sanitizer. |
| Browser feature E2E | Six tests remain marked `fixme` across decision, parallel and sign-in specs. The previous notes report a green CI run at `ba0873d16`. This audit did not rerun the Electron E2E suite. |
| Local Forge packaging | Environment-blocked by AGENTS.md. Packaged delivery remains an operator/CI check. |
| Provider, bundled Chromium and evaluation qualification | No fresh live-provider, WebRTC, held-out performance or native window verification in this audit. |

Logs are in `%TEMP%/bda-nov17-main.log`, `bda-nov17-components.log` and `bda-nov17-boundaries.log`. The temporary boundary test source was saved as `%TEMP%/bda-nov17-boundaries.test.ts` and removed from the worktree. The temporary tests exercise production runner/probe/sanitizer modules with controlled inputs, without a real provider or account.

## Open defects

### B01 — P0 — child cleanup can close sibling and parent sessions

- [ ] Clean up by authoritative unique child ownership on every return, exception and cancellation path. Await cleanup or report its failure before claiming that leases were released.
- [ ] Validate any reported `session_id` against the task that owns it. Transfer a live session to the parent only after a successful `keep_open` result and explicit ownership transition.

`runBrowserTasksTool.ts:621–635` uses a model-reported session ID directly, or falls back to `stopAllForConversation(conversationId)` when the result omits it. The exception handler at lines 667–680 calls the same broad cleanup. The ID passed here is the parent conversation. `ManagedBrowserModule.stopAllForConversation` at lines 1020–1039 matches both owning and root conversations, so the fallback can stop all sibling browser sessions and the parent's ordinary sessions. Normal non-keep-open results are instructed to omit `session_id`, making the fallback relevant even after success. Cleanup is also fire-and-forget. The early Stop/Return-now branch around lines 574–600 returns before the normal collector cleanup, so that branch needs its own ownership and lease verification.

Test two children with live sessions plus a separate parent session. Finish one normally without an ID, crash it, stop it and return early in separate cases. Only the intended child should be affected. Also test a result carrying an unrelated session ID, a worker cleanup failure and valid keep-open transfer. Requirements M-FR-02/07/09, M-AC-01/02, C-AC-04.

### B02 — P0 — task controls address different IDs, and session-only Pause can sweep unrelated jobs

- [ ] Use one task identity from batch row through the agent loop, browser session, controls, notices and intervention report.
- [ ] Resolve a control request to its own session/task in main. Scope missing-task fallback to that browser session and surface a failed pause/resume to the renderer.

`runBrowserTasksTool.ts:428–445` registers a `batchId:index` row. `AgentRuntime.ts:237–241` creates and separately registers an `agt-*` ID. The model and tool gates in AgentRuntime use the latter ID, while the batch card and intervention collector use the former. Root routing connects the displays to a conversation but does not unify these two records. The starting row event has no browser session ID, leaving a task-only control especially dependent on this mapping. The gate can therefore stay open for the actual child, and the batch can miss its user interventions.

In `managed-browser-ipc.ts:251–286`, a session-only Pause that cannot resolve a runner calls the global `sweepNonTerminalToInterrupted("orphan_session_pause")` and returns before `pauseSession`. The sweep interrupts all nonterminal control records. The same handler services Take control. Pause and Resume also swallow browser command failures, then report `ok: true`. Resume accepts the supplied task/session pair without verifying that the task owns that session in the handler.

Test main-chat runner, standalone session and batch child controls with at least one other task running. Cover Pause before/during model inference, takeover mid-program, absent or mismatched IDs, rejected worker pause/resume, Stop and instructions consumed exactly once by the right task. Requirements D-FR-08/09, M-FR-07/08, C-FR-01/04–08/12/16.

### B03 — P0 — native decision requests use the hosted HTTP transport

- [ ] Use a main-process native transport that sends requests only to the validated profile endpoint with the explicitly selected credential.
- [ ] Fail closed on incomplete profiles and resolve or reject aliases. Validate the native endpoint and model through the real production client.

`ManagedBrowserAiToolService.ts:1427–1452` creates the native client, but its `postQuestion` uses `new HttpClient().postJson(endpoint, body, { signal })`. The native client supplies the full `profile.baseUrl`. The generic HTTP client's `postJson` at `src/modules/lib/httpclient.ts:495–512` uses relative mode. Its URL builder at line 228 prepends the hosted base and its headers include hosted authentication state. The resulting destination is not the configured native URL, and no selected native/chat credential is passed from the native route. The separate hosted-with-native rejection condition at `ManagedBrowserAiToolService.ts:1461` requires a client that is only built in chat mode. It cannot enforce the stated refusal. Also check `mode=native_profile` when the normalized profile is null, which can fall through to chat.

Use a fake transport that captures the final URL and header presence without inspecting or printing secret values. Cover native vs hosted/custom, invalid/missing profile, mismatched endpoint, unavailable key, configured alias, 401 and Stop. Tests that inject the native `postQuestion` function only establish the client's internal behavior. Requirements D-FR-02–04, D-AC-01/08, design §§5.2–5.4/9.3.

### B04 — P1 — capability probes and output negotiation accept unsupported modes

- [ ] Verify the returned schema payload and the exact forced-tool name/arguments. Probe plain chat independently of JSON features and provide a separate native probe.
- [ ] Scope saved capabilities to the selected provider revision, endpoint and real model. Choose the best supported starting mode and keep the two-attempt ceiling.

`ChatCapabilityProbe.runProbe` at lines 60–78 accepts any nonempty content or tool call for every mode. With three ordinary prose replies, the real probe returned all three flags true. Its initial chat probe itself requests `json_object`, so a provider that supports plain text but rejects that format cannot reach either later probe. The current third result is forced chat tooling, not a native-protocol test.

`managed-browser-ipc.ts:561–597` calls the chat probe without a model override and persists provider-agnostic booleans. `ManagedBrowserSettingsModule.ts:402–405` retains them across route edits. This newly added AI request handler also lacks an explicit availability check before the probe and uses the general validated settings wrapper, so verify disabled-AI and unavailable-provider behavior at the IPC entry point. In `DecisionClients.ts:404–424`, forced tooling is only attempted second. A provider supporting tools but not JSON Schema still starts with `json_object` and may never use its verified capability. The response path at lines 481–498 reads the first tool arguments without verifying its name and accepts plain content in forced-tool mode.

Test ignored formatting, `ok:false`, wrong/missing tool call, text-only support, tool-only support, timeout/late reply, previously probed → changed provider/model, and disabled AI. Do not infer capabilities from a response merely being present. Requirements D-FR-01/02/18, D-AC-08/11, PRD §7, design §§5.3–5.4/9.4.

### B05 — P1 — the verifier can turn a failed explicit criterion into success

- [ ] Treat a failed explicit deterministic criterion as unverified. Use a separately configured semantic verifier only when the outcome genuinely needs semantic interpretation.
- [ ] Give verification the checked criteria and fresh bounded evidence. Add an enforced deadline capped by remaining active time and recheck pause generation before completion.

`BrowserTaskRunner.ts:640–690` invokes the verifier when deterministic verification fails and recovery is exhausted, then returns `completed` for any affirmative verdict. A local test kept the page at the search URL, required a different URL via an explicit criterion and returned an affirmative verifier result. The runner completed. `ManagedBrowserAiToolService.ts:1823–1855` wires this for all runs with `completion_criteria: []`, maps a normal decision's `DONE` to true and gives the model only row count rather than relevant extracted evidence. The eight-second field in the request body does not enforce a desktop timeout on this call. The runner checks Stop after the await but does not locally check the active deadline or whether Pause/Resume invalidated the evidence. The no-criteria URL-change fallback at lines 1645–1653 can independently certify an unrelated URL change.

Test failed URL, element, text and extraction predicates with an affirmative provider; no-criteria unrelated navigation; semantic verification with independently observed evidence; provider ignoring abort; Stop/Pause during fresh observation or verification. Requirements D-FR-09/24, D-AC-07/09, design §§11.4/12.

### B06 — P1 — provider-change coverage misses browser decision settings and route admission

- [ ] Freeze one route bundle including native profile, decision model, capability revision and relevant browser feature gates. Invalidate it when these settings change.
- [ ] Share active invalidation across planner/helper/recovery/verifier and action authorization, including awaited setup and retries.

The three clients now watch `providerConfigKey`, improving the earlier hosted/native gap. But the key comes from `AIProviderConfigVersion.ts`, and the only bumps found are in AIProviderSettingsService. Browser route, model and feature changes are saved through ManagedBrowserSettingsModule without a matching bump. `ManagedBrowserAiToolService.ts:1417–1580` reads provider mode and then settings, awaits imports and (hosted) a capability probe, and freezes whatever epoch is current later. If settings move during admission, the initial route and eventual epoch may describe different configurations. Inspect settings and entry-point checks together so a disabled route or changed profile cannot keep authorizing writes under a previously admitted task.

Test toggling acceleration, changing native model/endpoint, changing chat decision model during an in-flight request, changing provider between the admission probe and client construction, and config/Stop during retry. Verify visible interruption and fresh admission. Requirements D-FR-01–04, D-AC-01/07/12, design §§5/12.

### B07 — P1 — batch confirmation is a start flag and can wait through Stop

- [ ] Require visible, single-use confirmation before production batch start and issue a bounded grant scoped to the approved task IDs and sites.
- [ ] Make the pending card cancellation-aware and reflect its wait in the parent job. Prepopulate the approved sites for account-only tasks.

`requestBatchConfirmation` at `runBrowserTasksTool.ts:365–382` automatically allows start when no sink is set. When the sink exists, the await has no abort input and only expires through the registry timer. `runBrowserTasks` checks Signal again after it resolves, so Stop can prevent lane starts while leaving the confirmation outstanding for up to ten minutes. The preview derives its site only from `start_url` and the Boolean resolution is not passed to the permission layer. Child requests still use `allowInteractivePermissionPrompts: false` (line 467). `AgentRuntime.ts:423–460` continues to deny missing persistent/session grants. A newly confirmed batch can therefore be blocked for routine tools on a fresh profile.

Test no sink, renderer disappearance, cancellation/expiry, two concurrent cards, account-only preview, fresh profile with no persistent permission and reuse after batch exit. Confirm harmless routine tools work under the grant and consequential actions still surface a parent approval proposal. Requirements M-FR-03–05, C-FR-09, design §17.2.

### B08 — P1 — iframe and fallback sign-in code mixes document contexts

- [ ] Use the candidate's document/window consistently for element type checks, focus, events, visibility and cleanup. Define supported frame policy explicitly and exercise it in real Chromium.
- [ ] Keep safety revalidation and cleanup intact when fallback typing or submission fails.

`LoginFormFiller.ts:102,120,144` uses top-window `Element`, `Node` and `HTMLInputElement` constructors even after adding iframe documents. Real same-origin iframes have a distinct DOM realm. A frame input can fail those checks, while recipient cleanup at lines 543/552/568 has the same mismatch. Only first-level accessible frames are scanned. The same-site frame policy also needs explicit alignment with A-FR-16 and the cross-origin refusal in A-AC-03.

The fallback at lines 194–195 calls `setSelectionRange` on eligible email inputs, which do not support it in Chromium and may throw before cleanup. The username-only branch also needs the same verified fill/cleanup treatment. Submission at lines 591–615 checks top `document.activeElement` after focusing the field. If the focus test fails, the helper returns without submitting, but the enclosing result still reports `ok:true` and retains populated fields. Verify focus loss, unsupported selection, native-setter mismatch, detached/replaced frame, normal submit, username-only transition and registration refusal together. Requirements A-FR-08/16–21, A-AC-03/04, design §14.

### B09 — P0 — marker redaction does not establish credential containment

- [ ] Trace real filled-credential containment from worker ingress to every outbound channel using a synthetic password chosen independently of redaction patterns.
- [ ] Keep exact option and action provenance inside trusted state where it would otherwise carry page-authored secrets.

`ResultSanitizer.ts:23–53,92–114` recognizes patterns and some fixed-shape markers. The new marker handling redacts an internal decrypt-failure marker but does not know the actual filled value. A local test passed an ordinary synthetic credential embedded in page text through the production sanitizer and the text was returned intact. This is a boundary-function reproduction. The current observation title/body sanitation calls are pattern-based and there is no task-level evidence showing the submitted synthetic value cannot appear across output channels. In addition, the minimum-length gate can bypass shorter internal markers. Review `hrefFull`, option values and extraction alongside labels, page text and notice args. Verify logs, transcript, IPC/results and worker events, including sign-in transitions and error paths. Retain genuine fill-only transport and normal page output. Requirements D-FR-12, A-FR-06/08/15, A-AC-01, design §§13–14.

### B10 — P1 — account opt-in is writable by API but has no UI caller

- [ ] Connect account detail to the read/write opt-in APIs, with explicit save state, error handling and six-language copy.
- [ ] Finish the BrowserSite renderer and filter switch-over. Keep legacy platform IDs and labels stable.

`src/views/api/socialaccount.ts:95–110` exports opt-in calls and the IPC/module tests cover the backend. Searches across production view files find no caller for either function. Existing accounts still cannot be opted in or out from the UI. `socialaccountdetail.vue:403–415` still builds the selector from static SocialPlatformList. The debug watch around line 483 also logs platform item data. Registry-aware server helpers landed, but do not make a new custom site available in the account editor. The credential-card duplicate guard uses a read followed by separate writes. Verify simultaneous saves from two card requests for the same account/site and interruption between password and opt-in writes.

Test existing legacy and custom-site accounts, true→false→true, disabled/stale account, no duplicate or unintended opt-in on failed save, and account labels/filter values on both sides of renderer IPC. Requirements S-FR-06, Q-01, A-FR-03/05–07, PRD §7.

## Remaining requirements and release gates

### R01 — Restore user control and parallel execution as complete product workflows

- [ ] On Resume, recheck HTTPS, authoritative allowed sites and current sign-in identity for the bound account before reopening work. A domain comparison against the start URL plus a model subgoal note is an advisory check in `BrowserTaskRunner.ts:428–452`. Persist the transcript time/note and instructions in the actual agent transcript. Keep task state paused when the browser cannot resume.
- [ ] Keep the sub-agent job resumable after a user pause. AgentRuntime currently writes `waiting_user` with `finishedAt` and returns a blocked result when the query loop reports pause (lines 649–660). Verify that Resume actually restarts safe work, discards held pre-pause tool calls and preserves late action evidence. Ensure only resolved user handoff advances the task.
- [ ] Queue handoff dialogs with the task count and implement Open browser focus. The focus IPC still returns `focus_not_supported_yet` at `managed-browser-ipc.ts:366`. Verify title, window arrangement, no focus steal, repeated unexpected-page auto-pause and backdrop throttling against the bundled browser.
- [ ] Enforce per-provider concurrency and aggregate batch usage/cost. Current 429-sensitive delay is local to chat decision retries. Qualify the separately selectable sub-agent model and the pluggable fast-runner route.
- [ ] Finish strict browser-child output validation and parent result access. The collector at `runBrowserTasksTool.ts:602–647` treats an unrecognized/missing child status as completed when AgentRuntime completed. AgentRuntime can return a lenient parse fallback. Verify bounded extracted/evidence data, externalized output access and honest partial/failed results.
- [ ] Verify queued-account handling past the current bounded poll and during reservation waits. The second lane can still wait beyond its control window at `acquireBusyAccountReservation`, and it does not recheck abort immediately after obtaining the reservation. Cover simultaneous new starts, an account remaining busy, Stop during queue/reservation, same-account reuse and cleanup isolation.

Requirements M-FR-01–13, C-FR-01–16, D-FR-07–10a. Account reservation, parent notices, batch previews, extracted-row dedupe and configurable browser cap are present. The precise cross-layer failures remain above.

### R02 — Finish observation, action support and route accounting

- [ ] Use admitted provider operations, capabilities and token budgets in candidate preparation. Chat/native `getCapabilities` return empty operation lists and the runner does not consult them at the admission or candidate call sites. Verify older contract versions, unsupported operations, bounded request size and recovery with the same route budget.
- [ ] Measure shortlist recall independently, with focused/dialog/task-priority controls, bounded scrolling, and genuinely unreachable or oversized options. Retain the currently implemented omission of oversized SELECT values and disabled/occluded target checks, and test these against real DOM changes and action-dispatch evidence.
- [ ] Complete all-attempt accounting, with model/source attribution, separate planner/helper/verification budgets, provider attempt durations and unknown cost for disconnected requests. Test approval provenance and pause/Stop across state transitions using the same production dispatch path.

Requirements D-FR-05–27 and design §§6–12. Preserve the landed hosted availability negotiation, bounded planner/helper, full link provenance, exact offered options, fresh recovery, refusal of unsafe controls and unknown-effect semantics.

### R03 — Finish credentials, registry and proxy qualification

- [ ] Reconcile registration wording in PRD A-FR-12 and Q-02 with the product's current `registration_disabled` behavior. Confirm the accepted v1 scope or implement the specified explicit approval/Create account flow. The worker's new-password form guard is present.
- [ ] Qualify site registry upgrade, trusted redirect-domain approval, concurrent requests and held-out identity cases. Verify ciphertext/key failure paths and actual credential lifetime. Current JavaScript string reference clearing is not byte-level wiping, as the implementation now documents.
- [ ] Exercise proxy migration, selection, switching, rollback and cross-OS fingerprint behavior in real sessions. Typed connect/auth/tunnel failures, country-strict selection, browser-usable status, session proxy labels and proxy linking after sign-in have been added. Verify real HTTP 407, unopened/unhealthy proxy, direct consent, successful/failed switch, replacement session/cookies/task ownership and bundled Chromium UDP/WebRTC behavior. Keep password checks on authorized main/worker seams only.

Requirements A-FR-01–21, S-FR-01–06, P-FR-01–09, all A/S/P acceptance IDs and design §§13–16.

### R04 — Execute missing release evidence

- [ ] Implement and run the actual app drivers for `test/e2e/specs/browserDecisionTask.test.ts` (three skipped tests), `browserParallelTasks.test.ts` (two skipped) and `browserSignIn.test.ts` (one skipped). A green CI job still skips these acceptance cases. Include one child failing independently, 45-minute handoff clock behavior and full Stop cleanup.
- [ ] Run paired held-out evaluation of baseline, improved observation flow, eligible hosted Jev/Laya and custom routes in all six languages. Report sample size, shortlist recall, p50/p95, actual provider attempts, all-attempt cost per verified success, batch cost and the predeclared success-rate margin. Validate expected runtime/call reductions against the PRD targets and verify upgrade/rollback at the same source revision.
- [ ] Retain packaged-delivery process-tree evidence in operator/CI. Current AGENTS.md forbids running Forge package or make locally.

Requirements D-AC-01–12, A-AC-01–05, S-AC-01–02, P-AC-01–02, M-AC-01–03, C-AC-01–04, PRD §§8–10, design §§20–21. The focused and component passes recorded above establish their executed coverage. The six explicitly disabled app scenarios and qualification evidence remain open.

## Functional requirement cross-reference

| Specification area | Remaining tasks |
| --- | --- |
| D-FR-01–04 provider admission and identity | B03, B04, B06 |
| D-FR-05–10c task lifecycle and routing | B01, B02, B05–B07, R01–R02 |
| D-FR-11–15a observation and candidates | B08, B09, R02 |
| D-FR-16–21 action contract and field values | B03, B04, B09, R02 |
| D-FR-22–27 recovery, verification and effects | B02, B05, B06, R02 |
| A-FR-01–21 saved-account login and safety | B08–B10, R01, R03 |
| S-FR-01–06 site registry | B10, R03 |
| P-FR-01–09 proxy behavior | B01, R03 |
| M-FR-01–13 parallel execution | B01, B02, B07, R01 |
| C-FR-01–16 user control | B01, B02, B05, B07, R01 |
| PRD §7 and acceptance/qualification | B04, B10, R01–R04 |

Previous isolated cooldown failure did not recur in this focused run. Previous resume-dialog trigger, hosted request abort, terminal status persistence, field-helper revision keying, root notice routing, SELECT oversized-option omission and disabled/occluded input fixes are present. The open items above identify the remaining paths and the tests needed to close them.

---

**2026-11-17 closure pass (same day):** all ten defect groups B01–B10 are CLOSED — commits `f74b25b6c`(B01) → `c24957f91`(B02) → `3e58bb9e8`(B03) → `db13cb4a2`(B09) → `0bcba9d4f`(B04) → `e97a6672a`(B05) → `0ac647580`(B06) → `0ef77f9cf`(B07) → `0a146b654`(B08) → `b41dcedb0`(B10) → `bab782295`(R01 partial). Summary:

- **B01** child cleanup is scoped to the child's AUTHORITATIVE agent-task id via the new `stopAllForAgentTask`; a reported session_id is validated against its owner before stop or transfer (foreign ids untouched, evidence recorded), the no-id fallback stops only this task's sessions, the early Stop/Return-now branch cleans up its own task, cleanup is awaited before the result claims release, and an unscoped throw honestly reports `cleanup_skipped`. The conversation-wide sweep never fires for child cleanup.
- **B02** ONE task identity: `RunAgentRequest.controlTaskId` makes the batch row id own the control record (registration, gate hook, per-tool checks); the session-only Pause resolves the session's authoritative owner instead of sweeping every nonterminal task; pause/resume surface failures (ok:false/reason), Resume refuses a mismatched task/session pair and resolves its task like Pause.
- **B03** native decisions use `postNativeDecision` — the EXACT validated profile endpoint (absolute HTTPS, refused pre-request), Bearer ONLY with the explicitly selected credential, typed status failures; route admission refuses a null-profile native mode (never a chat fall-through) and alias native models.
- **B04** each probe VERIFIES its payload (structured parses to ok:true; forced returns the EXACT tool name with ok-true arguments; the chat probe is PLAIN text so text-only providers are probeable); the ladder starts with the BEST supported mode (tool-only providers start with the forced tool); forced-tool responses require the exact decision tool name; persisted capabilities carry the probing provider revision and apply only when it matches; the probe IPC is availability-gated and a throwing transport persists nothing.
- **B05** the verifier is consulted ONLY for tasks with NO explicit criteria — a failed explicit criterion is unverified, full stop; the verifier call carries an enforced desktop deadline capped by remaining active runtime, and a Pause+Resume during verification discards the verdict.
- **B06** decision-relevant settings (decisionRoute, acceleration, parallel agents, session caps, sign-in switch) bump the provider epoch so in-flight tasks see provider_config_changed; executeTask captures the epoch around the settings read and refuses admission when they race.
- **B07** the batch confirmation wait races the parent abort (a Stop refuses within milliseconds instead of leaving the card ten minutes); the preview prepopulates sites for account-only tasks from the site registry.
- **B08** the filler's Element/Node/HTMLInputElement checks are realm-safe (frame elements consult their own realm), setSelectionRange is guarded (email/tel may throw), the username-only branch uses the verified fill, and a lost submit focus CLEARS the credential and refuses (`submit_focus_lost`) instead of ok:true with populated fields.
- **B09** the worker REGISTERS the actual filled credential (bounded FIFO) and every redaction path redacts the exact value at any length/position — pattern checks alone could never catch an ordinary synthetic credential; sentinel-shaped tokens are secrets at any length (min-length gate fixed).
- **B10** the account editor loads and toggles the per-account AI opt-in (revert-on-failure, six languages); the credential card's save is serialized per user+site and the password+opt-in write is atomic (`updateCredentialWithOptIn`); the debug watch/logs are removed.
- **R01 partial**: strict child output validation (missing/unrecognized statuses are FAILED, never silently completed) and the reservation abort recheck (a Stop during the wait cannot start the lane it was meant to cancel).

Sweep at the closure HEAD: **693 tests passed across 58 main-process files**, **1,622 component tests across 183 files**, and the managedBrowser utility suite **159/159**. Still open (external/qualification): R01's agent pause-resume loop (headless runtime has no resume re-entry — deferred), R02's recall measurement and capability-budgeted candidate prep, R03's live-provider/WebRTC qualification, R04's real E2E drivers, held-out evaluation and packaged evidence (operator/CI).

CI run 44112455829 SUCCESS on all three jobs (Lint+unit 18m14s,
Package smoke 9m5s, Electron E2E 34m32s) at `6f3304843`.

**2026-11-18 continuation pass:** commit `dc31cfd76` closes four more
R01/R03 items. R01: the sub-agent job is RESUMABLE after a user pause
(the AIChatQueryLoop's onPauseWait blocks in-loop on the control gate —
no tokens spent while paused, held tool calls stay gated, and safe
work resumes when the gate reopens; a cancel while paused ends
cancelled; the persisted pause status stays waiting_user without
finishedAt); BROWSER_TASK_FOCUS_WINDOW is implemented (module
FOCUS_WINDOW → worker page.bringToFront() — the sanctioned EXPLICIT
user-requested focus; launches still never steal focus); Resume KEEPS
the task paused when the browser cannot resume. R03: the PRD's A-FR-12
is reconciled with Q-02 (registration out of scope for v1 —
registration_disabled; the Create-account card is deferred with the
future switch). Regressions: pause-before-round blocks then completes
on resume, cancel-while-paused ends cancelled, the paused window sends
zero requests and executes zero tool calls. Sweep: 695 tests across 58
main-process files, 1,622 component tests. Remaining open items are
external/qualification only: R01's per-provider concurrency/cost
qualification and sub-agent model selection, R02's recall measurement
and capability-budgeted candidate prep (held-out sets), R03's
live-provider/WebRTC qualification, R04's real E2E drivers, held-out
evaluation and packaged evidence (operator/CI).

CI run 44194449363 SUCCESS on all three jobs (Lint+unit 15m57s,
Package smoke 5m8s, Electron E2E 37m1s) at `8c2b61947`.
