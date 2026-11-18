# Browser decision acceleration audit and TODO — November 18

Reviewed commit `efcd817e24c6769d1af821d277ca4981a7b8028a` in `E:/project/aiFetchly-bda` and the uncommitted agent pause/resume edits in the query loop, runtime and permission tests. During the review, an uncommitted `FOCUS_WINDOW` schema appeared and was inspected separately. The [PRD](browser-decision-acceleration-prd.md) and [technical design](browser-decision-acceleration-technical-design.md) define the requirements. The [November 17 audit](browser-decision-acceleration-audit-2026-11-17-todo.md) records the prior closure pass.

**Implementation and acceptance are still incomplete.** The latest commits remove the original broad child cleanup, fix the basic native request destination, reject false explicit completion criteria and add credential-aware redaction. Related branches still have defects. The first nine items below cover the source findings and four reproduced boundary failures. The remaining items cover unfinished product behavior and release evidence.

## Validation

| Check | Result |
| --- | --- |
| Focused main suites with the mandatory TypeScript precheck | **690 passed across 56 files**. Browser decision, login, agents, managed browser, agent permissions, account opt-in and proxy checks. This run includes the initial uncommitted agent pause/resume edits. |
| Full component suite | **1,622 passed across 183 files**. Node reported localStorage warnings. |
| Follow-up check after concurrent window-focus edits | An intermediate version failed TypeScript with TS2345 at `ManagedBrowserModule.ts:2292`. The first utility run stopped at that precheck. After the guard was removed, the managed-browser utility retry passed its TypeScript precheck and **all 159 tests across seven files**. The earlier main/component runs preceded the focus edits. |
| Additional checks against production modules with synthetic fixtures | **4 of 4 assertions failed**. Fresh capability data was immediately stale, a refused keep-open transfer still returned its reported session ID, a valid short synthetic credential survived redaction, and an exact option value survived observation shaping despite registration as a trusted secret. |
| Electron app acceptance | Six relevant tests remain marked `fixme`. Previous documentation records CI run 44112455829 at `6f3304843`. Current app E2E, live provider, and bundled Chromium behavior still need their own evidence. |
| Forge package/make | Environment-blocked for local execution by AGENTS.md. Use operator/CI artifacts for packaged evidence. |

Logs are in `%TEMP%/bda-nov18-main.log`, `bda-nov18-components.log`, `bda-nov18-boundaries.log`, `bda-nov18-final-typecheck.log`, `bda-nov18-utility.log` and `bda-nov18-utility-retry.log`. The additional tests were saved in `%TEMP%/bda-nov18-boundaries.test.ts` and removed from the worktree. These assertions used mocked ownership/settings seams and simple synthetic inputs. Source findings below have their own targeted test requirements.

## Defects to address together

### N01 — P0 — Resume can reopen the task gate after the browser refuses

- [ ] Resolve an authoritative task/session pair for Pause, Take control, Resume and Stop. Treat the two state changes as one operation with explicit failure outcomes. Keep the task gate closed whenever the browser is still under user control.
- [ ] Carry the mapping between the live session owner and the task control record through session cards, batch rows, notices, approval and handoff.

In `src/main-process/communication/managed-browser-ipc.ts`, the Resume handler around lines 321–366 records `resumed = false` when the worker call fails. If it resolves a task ID, it still closes the intervention, saves instructions, reopens the gate and returns `ok: true`. Pause and Stop still accept a caller-supplied pair without the Resume ownership check. Pause changes the control record before the browser operation, so a worker failure can leave the layers disagreeing. Stop swallows the worker failure. Task-only Pause/Resume skip the browser operation, and unknown or terminal task IDs can still return success because the result of the state transition is ignored.

`AgentRuntime.ts:237–249,602` registers the batch row ID as `controlTaskId`, but still passes its separate persisted agent ID as `ownerAgentId` for sessions. `ManagedBrowserAiToolService.requestHandoff` around lines 1154–1165 registers the persisted owner ID as the waiting control task. Session-only IPC also resolves the owner ID, and session task-label lookup uses that ID even though the label was registered against the control ID. This leaves the earlier mismatch in the handoff and session-card paths despite the batch model gate using the right ID.

Exercise session-only, task-only and paired input from both cards under worker refusal, late response, unknown or terminal task, sibling mismatch and signed-out state. Assert browser state, gate, renderer response, prompt lifecycle and intervention record together. D-FR-08, M-FR-07/08, C-FR-01/04–08/12/16.

### N02 — P0 — keep-open and child cleanup still have ownership gaps

- [ ] Return a session ID only after successful, authoritative keep-open transfer. Protect child sessions from parent writes before that transfer.
- [ ] Capture each child execution's ownership before work begins and verify cleanup on every success, crash, retry and cancellation.

Reproduced against `runBrowserTasksTool.ts:773–809`. The collector records `keep_open_transfer_refused:owner_mismatch`, then uses the original reported `session_id` as a fallback in its result. It also accepts a null child owner in the transfer check. The successful branch records an ID without changing the session's ownership, and the check is independent of the child's final status. A failed keep-open result can leave child sessions running. The non-keep-open mismatch path skips closing the child's actual sessions when the reported ID belongs elsewhere, while its test-only null-owner fallback can still call stop in production. A child that throws before returning its ID still leaves the collector without an owner for cleanup. A retry can replace the first child ID with the second. `ManagedBrowserModule.stopAllForAgentTask` suppresses individual stop failures, so a caller awaiting it cannot distinguish full cleanup from partial cleanup.

`ManagedBrowserAiToolService.ensureSession` at lines 355–383 allows the root conversation for both reads and mutating callers, without checking whether the child finished or a keep-open transfer took place. Keep root-scoped inspection available and require distinct authorization for mutation.

Cover foreign/missing/owned IDs, failed keep-open, a successful retained session and its remaining child sessions, launch/throw before a result, two attempts, and Stop/Return now while both siblings and a parent session are alive. Assert the parent receives only a validated retained ID, ownership actually changes, and each intended lease is released. M-FR-02/07/09, M-AC-01/02, D-FR-08.

### N03 — P1 — the new sub-agent pause wait leaves stale tool calls and clock errors

- [ ] Carry a pause generation from model request admission through tool execution. Reobserve and discard work generated before a takeover even when Pause and Resume both finish before the model responds.
- [ ] Freeze active time for explicit pause as well as dialog wait. Make the wait handle pre-aborted signals, cancellation, expiry and late resume with accurate terminal state.

The uncommitted `AIChatQueryLoop.ts:2544–2598` change keeps a job alive when Pause is already visible at a model boundary. It uses `continue` in an incrementing `for` loop after the wait, consuming a round even when no request occurred. There is no generation captured for in-flight sub-agent model responses. `AgentRuntime.ts:397–416` only checks the current control state before a tool, so a response arriving after the gate has reopened can execute pre-pause calls. The existing pause-during-request test leaves the task paused when the response returns.

`AgentRuntime.ts:565–584` freezes its local deadline only when the user-wait dependency reports true. An explicit Pause changes the task control record without setting that job flag, so the runtime clock can expire while the new loop waits. `AgentTaskControlService.getGate` around lines 249–280 does not handle an already-aborted signal before adding an event listener. The new loop maps all wait failures except the exact `task_cancelled` message into a paused result. AgentRuntime then returns a blocked result and persists `waiting_user` even when the gate was interrupted or the job has ended. Keep active time, cleanup, durable status and partial output consistent.

Test Pause→Resume before the in-flight response returns, Pause at the last permitted round, a wait longer than the remaining active budget, an already-aborted signal, Stop, expiry and application teardown. Verify one user's Resume cannot reopen a terminal wait. D-FR-07/09, C-FR-05–09/14, C-AC-02/03.

### N04 — P1 — capability testing invalidates its own results

- [ ] Persist verified capabilities under the provider, endpoint, model and revision actually probed. Avoid invalidating an unchanged route when only its probe results are saved.
- [ ] Provide separately verified chat, structured-output, forced-tool and native capabilities. Reject stale results across probes, settings changes and restarts.

Reproduced using the real `ManagedBrowserSettingsModule.updatePreferences` with an in-memory settings seam. The probe handler captures `providerConfigKey()` at `managed-browser-ipc.ts:687–698`, then saves it in a `decisionRoute` patch. Every such patch bumps the epoch in `ManagedBrowserSettingsModule.ts:378–384,452–457`. The stored revision is therefore already old when `ManagedBrowserAiToolService.ts:1618–1634` compares it to the current revision. The settings panel can show success while the next task uses fallback formats.

The handler captures the revision after the awaited network probes and does not supply the configured decision-model override. A concurrent provider change can label results gathered from one route as belonging to another. The revision is a process-local counter, so equality to a persisted value can recur after restart. The improved probe checks parsing and true values, but the structured probe asks for the same literal result it validates. A provider that ignores the format can still satisfy it by following the prompt. The panel probes the chat transport and has no native-protocol verification.

Test save→admission, changed endpoint/model/key during each probe, process restart, a plain backend that ignores formatting, output-schema violations, tool-only and text-only routes, timeout, failed probe persistence and explicit native profile admission. D-FR-02/04/18, D-AC-01/08/11, PRD §7, design §§5.3–5.4/9.

### N05 — P1 — provider identity is frozen again after asynchronous admission

- [ ] Resolve one immutable route bundle before reading provider-dependent settings. Validate the original revision again after each admission await and before the first network request or mutation.
- [ ] Reconcile route write consistency and enforce the native destination boundary through transport completion.

`ManagedBrowserAiToolService.ts:1416–1442` reads provider mode before capturing the epoch. It checks the epoch after the settings read, then awaits further imports and, on the hosted path, a capability probe. Native, hosted and chat construction subsequently freeze a fresh epoch at lines 1490, 1540 and 1636. This can bless a bundle assembled from stale route state after a later change. The chat adapter also resolves its endpoint when making a request, so delayed setup must carry the admitted route through dispatch. `ManagedBrowserSettingsModule.updatePreferences` bumps before awaiting all writes. A task can capture a new revision while settings writes are incomplete. Audit the disable flags in the same bundle.

The new `NativeDecisionTransport.ts:44–63` fixes the initial URL and hosted credential mix-up. Fetch still uses default redirect following, so the initial HTTPS validation does not by itself enforce the final request destination. Refuse redirects or enforce the admitted origin policy across them. Validate native profile and key state before reading page data. Test a held capability probe, delayed settings commit, provider switch between route selection and client creation, in-flight disable, native redirects and late replies using a controlled transport. D-FR-01–04, D-AC-01/07/11/12, design §§5/9/12.

### N06 — P1 — batch confirmation leaves stale requests and still lacks a scoped grant

- [ ] Require confirmation for each production batch, retire the request and card when Stop fires, and grant routine tools only for the approved task IDs/sites and lifetime.
- [ ] Resolve account-only previews from credential-free metadata and tie the confirmation wait to the parent job.

`runBrowserTasksTool.ts:365–445` now races the wait against the abort event. A signal that fires during the awaited preview can already be aborted by the time the handler is attached. After registration, abort settles only the local promise. The registry entry and card remain until a renderer response or expiry. No sink still returns true. The preview calls `SocialAccountModule.getAccountDetail`, which returns a response with nested `data` and decrypts the stored password for its editor use. The preview reads `site_id` and `social_type_id` on the outer response, so account-only tasks can still show no site while unnecessarily loading a secret. A start Boolean never reaches the permission layer as a scoped grant, and the launched children still disable interactive permission prompts.

Test Stop during preview and after card display, renderer remount/unavailable, absent account metadata, invalid or reused confirmation, blank permission store, approved routine calls and consequent parent approval handoff. Verify a second batch or sibling cannot reuse the grant and a pending confirmation does not silently consume the parent poll allowance. M-FR-03–05, C-FR-09, design §17.2.

### N07 — P0 — trusted-secret coverage skips short values and raw observation fields

- [ ] Contain every credential length accepted by the IPC and worker schemas. Define when exact matching expires and how cleanup relates to the lifetime of the page/session.
- [ ] Keep exact SELECT and link identity behind worker-owned references and enforce one credential-safe boundary for all model/renderer-facing fields.

Two regressions were reproduced. The credential schemas accept a minimum length of one, while `ResultSanitizer.registerTrustedSecret` skips values shorter than three. A valid two-character synthetic value survived text sanitation. A separate test registered a longer synthetic value and passed it as an option value through the production `shapeElementRecord`. Its label was safe, but the exact value remained in the outbound `option_values` array. `BrowserObservationService.ts:324–365,501–545` also sends raw role/link data and the report URL retains its path. Those fields do not all pass through the exact-value text filter. The bounded FIFO can evict a still-relevant secret and retains plaintext string references after fill. The marker-pattern tests and normal title/body cases do not prove complete containment.

Add one synthetic fill-to-output fixture across body/title, attributes, option/link provenance, URL, notices, extraction, tool results, transcript/log and worker messages. Cover short permitted values, expiry while a page stays alive and repeated sign-in. Preserve normal option identity checks while keeping the credential out of every outbound channel. A-FR-06/08/15, A-AC-01, D-FR-12/17, design §§13–14.

### N08 — P1 — opt-in initialization and rollback also write to storage

- [ ] Separate loading and rollback from an explicit user toggle. Serialize writes for the current account and associate the response with the account that initiated it.
- [ ] Finish the registry-backed account selector and add mounted component tests.

`socialaccountdetail.vue:314–335,447–453` watches the same ref used by the checkbox, the initial async load and failure rollback. Loading an enabled account triggers an unnecessary write. On failure, inverting the watched value schedules a new write, which can invert it again if the error persists. A failed read sets false and can likewise trigger a write in a reused component. The checkbox is disabled during save but remains interactive before its initial read finishes. The earlier atomic password/opt-in backend update is present. The selector around lines 463–475 still reads the static platform list, and no matching mounted opt-in component test was found.

Test load true/false without writes, one toggle with one write, failed read without writes, persistent write failure with one rollback and visible error, rapid updates, route change and account creation for registry-backed custom sites. Q-01, PRD §7, S-FR-06, A-FR-03/06.

### N09 — P1 — late completion can still cross a verifier timeout or pause

- [ ] Validate abort, active time and gate state after final observation and after semantic verification before publishing completion.

The explicit-criterion verifier override from November 17 is fixed. In `BrowserTaskRunner.ts:621–700`, the semantic verifier gets a deadline signal, but the positive result checks only the enclosing signal and resume generation. A late result from a transport or callback that ignores the verifier's abort can still complete. During a Pause without an intervening Resume, the generation has not changed, so both deterministic verification on the awaited observation and an affirmative verifier result can finish while the task is paused. The baseline no-criteria URL-change fallback still certifies navigation without proving that the goal was achieved. Independent evidence and a strict semantic verdict remain necessary for such goals.

Test final observation and verifier replies after Stop, Pause, Pause→Resume, provider change and a child timeout. Include a callback that resolves after its abort signal and an unrelated navigation with no completion criterion. Require truthful partial or interrupted state and preserve evidence for completed work. D-FR-09/24, D-AC-07/09, C-FR-05/06/08, design §§11.4/12.

## Remaining product requirements

### Complete control, parallel execution and window behavior

- [ ] On resume, verify the live page against the authoritative allowed sites and the same account before reopening the gate. Persist the intervention time, resume note and user instructions in the correct agent transcript. The current runner domain comparison and appended subgoal are advisory.
- [ ] Queue handoff dialogs one at a time and show the waiting count. The in-progress Open browser work now has an IPC handler and a worker command. At the follow-up checkpoint no renderer API or preload reference called this channel. An intermediate focus guard passed `"PAUSE_REQUEST"` as a `ManagedBrowserCommandType` and failed TypeScript (TS2345). The concurrent edit removed that guard. Both module and worker focus methods still suppress failures, so the IPC can acknowledge success without raising a window. Complete the authorized UI path and distinguish missing/headless/closed windows from successful focus. Verify intentional focus, window title, tiling, unexpected-page auto-pause and background throttling with bundled Chromium.
- [ ] Enforce per-provider concurrency, bounded HTTP 429 handling and a batch-wide token/cost budget. Wire the separately selectable sub-agent model and pluggable fast-runner executor. Keep the existing parent result dedupe.
- [ ] Complete browser-child output validation at the batch boundary. The new check validates status, while the collector still casts other fields. Validate bounds, shape, retained session ID, and parent access to externalized results. Test all Stop/crash/Return-now and queue-expiry branches with the same ownership model as N01–N03.

M-FR-01–13, C-FR-01–16, design §§17–19.

### Complete decision capability, action support and accounting

- [ ] Use the admitted route's operation capabilities and bounded token/size budget before offering candidates. The runner has no `getCapabilities()` consumer. Add operation-level compatibility tests with hosted, chat, native and older contract versions.
- [ ] Measure shortlist recall independently across focus/dialog/task relevance, bounded observation windows and difficult layouts. Verify real DOM races, exact SELECT and navigation identity, and stale versus unknown effect through the live worker path.
- [ ] Account for each provider attempt and model, including plan/helper/verification and unknown usage on an interrupted response. Verify coherent route options with live test endpoints and preserve per-action approval and cancellation.

D-FR-01–27 where referenced, D-AC-01–12, design §§5–12.

### Complete account, site and proxy acceptance

- [ ] Align the written A-FR-12 registration confirmation with the Q-02 login-only v1 scope and actual `registration_disabled` behavior. Confirm whether the Create account workflow is due for this release. Test login refusals, username-only flows, realm-safe nested/allowed frame behavior and password cleanup in real Chromium.
- [ ] Verify BrowserSite upgrade, authoritative account metadata and single-use redirect-domain approval in the app. Exercise legacy account/cookie rows and the custom-site editor path with the registry selector.
- [ ] Verify actual proxy check and controlled restart for linked, explicit, auto/country and direct choices. Exercise rollback, session replacement, cookies, ownership and consent, and test the bundled browser's WebRTC/UDP behavior. Measure exact states on real 407, tunnel and connectivity failures. Finish at-rest migration and all secondary consumer checks with missing and rotated keys.

A-FR-01–21, S-FR-01–06, P-FR-01–09, design §§13–16.

## Release evidence

- [ ] Implement and run the six skipped browser feature cases through the real Electron tool → IPC → worker → persistence → renderer journey. Three decision scenarios are in `browserDecisionTask.test.ts`, two parallel scenarios are in `browserParallelTasks.test.ts`, and one saved-account handoff scenario is in `browserSignIn.test.ts`. Include independent child failure, successful resume during a batch and lease cleanup after Stop.
- [ ] Run the PRD's paired held-out qualification across six languages with independent criteria, per-family outcomes, shortlist recall, p50/p95, provider-attempt counts, batch totals and all-attempt cost per verified success. Compare baseline and eligible hosted/native/custom configurations with a predeclared success margin.
- [ ] Tie packaged process-tree checks and rollout/rollback evidence to the audited revision in operator/CI. Re-run app and UI checks with the completed pause/resume and window-focus changes. Maintain six-language strings and the repository's component/E2E coverage on subsequent UI edits.

| Requirement group | Open evidence and implementation |
| --- | --- |
| D-FR-01–04 | N04–N05 and route capability qualification |
| D-FR-05–10c | N01–N03, N06, N09 and lifecycle/qualification |
| D-FR-11–15a | N07 and live observation/shortlist coverage |
| D-FR-16–21 | N04–N05, N07 and provider/operation compatibility |
| D-FR-22–27 | N03, N05, N09 and action/verification accounting |
| A-FR-01–21 | N07–N08 and credential/registry qualification |
| S-FR-01–06 | N06/N08 and upgrade/domain/editor journeys |
| P-FR-01–09 | Proxy runtime, migration and bundled-browser evidence |
| M-FR-01–13 | N01–N03, N06 and parallel workflow qualification |
| C-FR-01–16 | N01–N03, N06, N09 and live user-control flows |
| All acceptance families and PRD §§7–10 | Release evidence above and the targeted cases attached to each open item |

---

**2026-11-18 closure pass:** all nine defect groups N01–N09 are CLOSED — commits `3393a62bf`(N01/N02) → `070fbf7a8`(N01 atomicity) → `7f6923caf`(N07) → `37b288abd`(N03) → `a377d0c8e`(N04) → `5bed238e6`(N05) → `cbbe7c67e`(N09) → `9abe32018`(N06) → `d81fc06eb`(N08) → `0c2800fa3`(focus path) → `9906b3d50`(preload). Summary:

- **N01** Pause runs the browser op FIRST and moves the control record only on success; Stop validates the task/session pair and surfaces a rejected worker stop; Resume surfaces the transition result (unknown/terminal tasks cannot resume) and records instructions before the gate reopens; sessions/handoff waits/labels now share the CONTROL task id (AgentRuntime passes controlTaskId as ownerAgentId and rides it on every result).
- **N02** child ownership is captured BEFORE work begins (the control task id), keep-open transfer is EXPLICIT (`transferSessionToConversation` reassigns ownership to the parent — a foreign/unknown-owner id is refused, never surfaced, and the child's own scope is still released), a FAILED keep-open releases the child's sessions, the non-keep-open mismatch no longer suppresses the real cleanup, root-conversation MUTATIONS require a completed transfer (`session_transfer_pending`) while root inspection stays open (takeover remains the transfer mechanism), and stopAllForAgentTask reports partial failures.
- **N03** the pause wait no longer consumes a loop round; the resume generation is captured at each model round top and the per-tool gate holds/discards pre-pause tool calls; the runtime clock freezes on an explicit pause (`isUserWaitState`); getGate rejects an already-aborted signal; an expired pause persists failed (never a resumable waiting_user).
- **N04** the probe captures the revision BEFORE probing; a capabilities-ONLY route patch does not bump the epoch (mode/model/profile changes still do); the configured decision-model override rides the probes; a concurrent change surfaces probe_invalidated_by_concurrent_change.
- **N05** the admission epoch is captured before any provider-dependent read, revalidated after the settings read and the hosted probe, and all three clients freeze the ADMISSION epoch; the settings bump commits before bumping; the native transport sets redirect: manual (a 3xx is refused).
- **N06** a parent Stop RETIRES the pending confirmation card (registry cancel); the account-only preview reads credential-free metadata (`getAccountSiteMetadata` — getAccountDetail decrypts and must not be loaded by the preview).
- **N07** `registerTrustedSecret` accepts every credential length (min 1 — the <3 skip let a two-character value survive); the observation shaper applies the trusted pass to role/hrefFull and OMITS credential-bearing SELECT options (kept-set ids/labels/values index-aligned with the ORIGINAL option index, so dispatch identity stays intact); registered credentials are cleared on session stop.
- **N08** the opt-in write path is an EXPLICIT checkbox handler (loaded gate, no-op on same-value, rollback without a re-write); the checkbox is inert until the initial read finishes; the account selector sources from the SITE REGISTRY via BROWSER_SITE_LIST (static fallback for legacy ids); mounted page tests cover load-without-write, one-toggle-one-write, and failed-write rollback; debug logs removed.
- **N09** completion is gated by the user-wait state and active budget after BOTH deterministic verification and the semantic verifier (a late reply from a callback that ignored its abort cannot complete); gated verifications end partial with verification_landed_while_paused.
- **Focus path**: the session card has an "Open browser" button, the view API exposes focusBrowserWindow, the worker reports an honest WORKER_ERROR for headless/closed windows, the module rethrows, the IPC maps failure to ok:false, and the channel is allowlisted in preload.

Sweep at the closure HEAD: **695 tests across 58 main-process files** (after the preload fix), **1,625 component tests across 184 files** (including the three mounted opt-in tests), and the managedBrowser utility suite green.

CI run 44331718503 SUCCESS on all three jobs (Lint+unit 19m41s,
Package smoke 6m6s, Electron E2E 40m40s) at `1d0079764`. Still open: qualification/release evidence only — R02's recall measurement, live-provider/WebRTC qualification, the six real E2E drivers, held-out evaluation and packaged evidence (operator/CI), and the scoped start-Boolean grant into the permission layer (deferred with the permission redesign).
