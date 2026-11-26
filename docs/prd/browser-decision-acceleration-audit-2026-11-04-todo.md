# Browser decision acceleration — second implementation audit and TODO

Date: 2026-11-04, Asia/Shanghai. Worktree: `E:\project\aiFetchly-bda`. Branch: `feature/browser-decision-acceleration`. Audited HEAD: `c51349c5bc8e85ca1a98dcf6d495e94ba69bb56c`. Worktree was clean at audit start.

Specification: [PRD](browser-decision-acceleration-prd.md) and [technical design](browser-decision-acceleration-technical-design.md). Previous findings: [2026-11-03 audit](browser-decision-acceleration-audit-todo.md). This is a new report; it does not overwrite that report or treat its implementation-status notes as proof of acceptance.

**Verdict: NOT all requirements are implemented. The update makes substantial progress and restores TypeScript compilation, but production integration still has correctness defects and incomplete required flows.** In particular, passing unit tests do not establish that the new cards, controls, provider guard, persistence, or E2E fixtures are connected to the application.

> **Status update 2026-11-04 (implementation pass 3):** R01, R02, R15, R16,
> R04, R05, R03 (task ID unification), R12, R17, R22, R07, R20, and R11
> are implemented and committed. `tsc --noEmit` exits 0; the feature
> suites pass unbypassed (811/811 + components 56/56). Items remaining:
> R06 (AgentRuntime gate/deadline), R08 (lease transfer), R09 (generic
> adapter), R10 (card mounting), R13 (proxy restart cookie/URL), R14
> (SELECT options), R18 (planner/bindings), R19 (login control gate),
> R20 residual (transition confirmation), R21 (per-account opt-in),
> R23 (hosted/native), R24 (provider UX), R25 (E2E harness), R26
> (Vue/component env), R27 (qualification) — per-item status below.


All unchecked tasks below remain open. P0 = mandatory execution/safety invariant broken; P1 = required feature/correctness blocker; P2 = remaining qualification or validation/integration work. Findings identify source evidence and expected verification. Source inspection is distinguished from executed reproduction checks.

## 1. Verification actually performed

| Check | Result on this snapshot |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | PASS, no diagnostics. Previous 60-error compilation blocker is resolved. |
| Main Vitest: `browserDecision`, `browserLogin`, `browserAgents`, `managedBrowser` directories | PASS: 36 files, 396 tests. Mandatory global TypeScript gate ran successfully; `AIFETCHLY_SKIP_TSC` was not used. Only the redundant Vite checker plugin was disabled with `AIFETCHLY_SKIP_VITE_CHECKER=1`. |
| Full component suite, dedicated component config | FAIL: 180 files, 172 passed / 8 failed; 1,585 tests, 1,389 passed / 196 failed. Same shared localStorage/environment failures seen previously under Node 26.2.0. These are not all attributable to this feature. |
| `node node_modules/vue-tsc/bin/vue-tsc.js --noEmit --incremental false` | FAIL: `src/views/pages/search/components/EditSearchTaskDialog.vue:17:26`, TS7006, parameter `v` implicitly has `any`. Outside the BDA implementation diff. |
| Six-language key parity for `browserSignIn`, `browserSite`, `browserTasks` | PASS for en/zh/es/fr/de/ja. This checks key structure, not translation quality or runtime UI integration. |
| Seven additional temporary requirement-reproduction tests | All seven exposed a failing requirement assertion; details below. These were additional diagnostic tests, separate from the passing committed suites. |
| New E2E specs | Inspected; required HTTPS server, seed endpoints, and window hooks are absent from the repository. Not reported as executable/passing E2E. |
| Build, full main suite, external hosted/native servers, real proxy/Chromium fingerprint, performance trials | Not run / not established by this audit. |
| Local Forge packaging | Not run, per repository prohibition. Package/process-tree evidence remains operator/CI-only. |

Local logs: `%TEMP%\bda-r2-typecheck.log`, `bda-r2-main.log`, `bda-r2-components.log`, `bda-r2-vue-typecheck.log`, `bda-r2-reproductions.log`. The temporary test source is retained at `%TEMP%\bda-r2-reproductions.test.ts`; it was removed from the repository after execution. No implementation/test source changes are part of this report. Shell commands that print a redirected log may exit successfully even when the logged child test failed; the table uses actual test summaries.

The temporary reproductions imported production runner/client/batch code, injected deterministic collaborators, and asserted the PRD behavior:

| Reproduction | Expected | Actual |
| --- | --- | --- |
| Freeze client, change provider config version, then decide | Provider error; no completion request | Completion called; result `decided` (R01) |
| Pause while a CLICK decision is in flight, then resume | Discard held decision; observe/redecide | Old CLICK dispatched once (R04) |
| DONE after fresh observation returns null | Must not claim verified completion | Result `completed` using previous observation (R16) |
| EXTRACT with invented target reference | Reject before executor call | Executor called once with invented ref (R15) |
| NAVIGATE to unobserved different site | Reject before executor call | Executor called once with unobserved URL (R15) |
| Build chat prompt with a recovery subgoal | Include recovery subgoal | `subgoal` absent from serialized prompt (R17) |
| Start batch with already-aborted parent signal | No child runtime starts | Child runtime called once (R07) |

These seams establish runner/client behavior; they do not claim that the real worker would successfully execute an invented reference. The real executor may reject it later. The defect is that the runner fails its specified observation/candidate authorization boundary.

## 2. Confirmed bugs and incomplete implementation

### R01 — P0 — provider revision guard is not wired into the production client

> STATUS (pass 3): DONE — getConfigKey wired into the ChatCompletionDecisionClient ctor; each decision call re-checks the frozen provider config identity; a mid-task change returns provider_config_changed.

 Bind immutable provider/configuration identity to every inference and cancel/discard work on changes, including changes during an in-flight request.

Evidence: `src/service/ManagedBrowserAiToolService.ts:1069` constructs `ChatCompletionDecisionClient` with only the completion callback. Its third constructor argument, `getConfigKey`, is omitted. Calling `freezeRoute()` at line 1115 therefore does nothing useful: `DecisionClients.ts` checks changes only if `this.getConfigKey` exists. The callback constructs AiChatApi for every request, and `src/api/aiChatApi.ts` resolves the current provider again. A task can send later page data to a newly selected endpoint, including hosted mode, despite the supposedly frozen route. The first temporary reproduction confirms the missing guard. There is also no post-response revision check to reject an old provider's late proposal.

Fix/acceptance: resolve an immutable route/client/key in main at admission; subscribe to config changes; abort inference and reject late output; require explicit fresh admission/rebind. Test actual executeTask wiring with two fake endpoints and a mid-request/mid-retry setting change. No page data or key may cross provider boundaries. Requirements: D-FR-02/03, D-AC-01/07, design §5.2. Previous T17 remains open.

### R02 — P0 — worker step timeout is reported as known effect

> STATUS (pass 3): DONE — step timeout reports effect: "unknown"; the runner's processExecution treats it as a terminal unknown-effect stop (D-FR-26).

 Report timed-out dispatched worker steps as unknown and prevent subsequent mutation/replay until reconciled.

Evidence: `ManagedBrowserAiToolService.ts:1175` cancels the active worker request after its Promise.race deadline, then returns `effect: "known"`, `errorCode: "stop_timeout"`. The original runAuthorizedForRunner promise is not awaited to establish whether input occurred and may finish later. `BrowserTaskRunner.processExecution()` treats this as an ordinary known failure, permitting more decisions and potentially repeated input. This recreates the exact timeout/double-submit risk D-FR-26 forbids. The seam also ignores the caller's requested perStepWorkerTimeoutMs and uses the default route limit.

Fix/acceptance: delay a real/fake click until after dispatch, make the step deadline fire, assert unknown terminal outcome, no retry, preserved late result, and matching journal. Remaining task time must bound execution. Requirements: D-FR-09/26, D-AC-06/07, design §§7.3/12. Previous T07/T09 are only partially fixed.

### R03 — P1 — durable task IDs, journal writes, and terminal persistence disagree

> STATUS (pass 3): CORE DONE — the runner is constructed before admission; runner.taskId is the single identity from admission through journal to terminal. persistCursor/persistActionIntent/persistActionOutcome are wired. Unique index on taskId and optimistic cursor update remain.

 Use one task ID from admission through runner/control/journal/result; make pre-mutation journal persistence mandatory and update cursor/accounting on each phase.

Evidence: executeTask generates `admissionTaskId` at `ManagedBrowserAiToolService.ts:1095`; BrowserTaskRunner independently generates its private taskId. Hooks journal under the admission ID. After completion line 1259 replaces that reference with the runner ID and recordTerminal writes the different ID. BrowserTaskModel then attempts to save a new row with required session/conversation/provider fields missing, or otherwise leaves the original admission row unfinished; errors are swallowed. `persistCursor` is defined/passed but never invoked in BrowserTaskRunner. Action-intent write failures are swallowed before execution; all known results, even no-effect failures/policy stops, are journaled `confirmed` before result processing. BrowserTask.taskId has no unique index, no tool-call admission key, and no optimistic cursor update.

Fix/acceptance: actual SQLite tests for completed/failed/paused/restarted tasks, duplicate tool call, journal write failure before dispatch (zero mutation), crash after dispatch (unknown), counters/times, and terminal update of the original row. Requirements: D-FR-07/08/10, C-FR-14, design §6.2. Previous T19 is not complete.

### R04 — P1 — resume executes held decisions instead of discarding them

> STATUS (pass 3): DONE — the control service tracks a per-task resume generation; the runner captures the generation before decide and discards proposals if the generation incremented during inference.

 Track control/resume generations; discard proposals produced across takeover; observe and decide again before action.

Evidence: `BrowserTaskRunner.ts:282` waits for the gate after deciding, then executes the same decision at line 289 onward. It never records whether the gate closed during inference or refreshes the observation after reopening. A temporary test paused the task inside decide(), resumed it, and observed the old CLICK execute. Source comments claim held proposals are discarded but code only delays them. The initial observation is also outside the try/finally, and escaped execution exceptions can mark a still-running record completed in finally.

Fix/acceptance: pause during delayed inference, manually change the DOM, resume with instructions, assert old proposal is discarded and fresh observation precedes a new decision. Failed/cancelled exceptions must have truthful terminal control states. Requirements: C-FR-05–08/16, D-AC-07, C-AC-02. Previous T08 remains open.

### R05 — P1 — handoff waits use the wrong task clock and do not publish job waiting state

> STATUS (pass 3): CORE DONE — awaitHandoff receives the runner's actual taskId (not the admission ref); the control service clock is the runner's own. ToolJobRegistry user-wait and approval in-job wait remain.

 Connect handoff to the runner's actual task ID, ToolJobRegistry user-wait heartbeat, safe terminal detection, and an explicit gate resume.

Evidence: executeTask.awaitHandoff uses the separate admission ID (R03), while the runner clock uses its private ID. HandoffCoordinator.beginIntervention therefore stops a different clock. Coordinator catches requestHandoff failures and treats any state other than handoff/user_login_in_progress as resolved, including inappropriate non-ready states. Finally records the intervention but never resumes its waiting control record. Unlike credential-card waiting, this callback never calls ToolJobRegistry.setUserWait. Approval_required still ends the runner as partial instead of waiting in its job. A 45-minute wait therefore does not have the required protected clocks/polling semantics.

Fix/acceptance: deterministic long wait and expiry tests through the real job wrapper; exact resolved/expired/cancelled states; one task continues while another waits; user decision resumes only the correct task; consequential approval waits in-job. Requirements: D-FR-10a, C-FR-01–03/09/12, C-AC-01/03/04. Previous T14 incomplete.

### R06 — P1 — agent runtime still lacks the task-control gates and active-time deadline

- [ ] Thread the batch/control/runtime/session identity through AgentRuntime and enforce gates before model/tools, active-time limits, resume notes/instructions, and the pause cap.

Evidence: `AgentRuntime.ts:226` creates an independent agt-* ID and agent-v2-* conversation. It does not call AgentTaskControlService or waitUntilOpen and retains a wall-clock setTimeout(maxRuntimeMs) at line 521. Batch control records are `${batchId}:${index}`. Thus changing those records cannot pause the actual agent loop. Resume IPC still returns instructions to renderer instead of adding them to the transcript and swallows browser-resume failure before opening the gate. There is no 60-minute pause-cap timer, queued handoff coordinator UI, automatic unexpected-page-change pause, or AI-control title integration established here. Focus IPC still returns focus_not_supported_yet.

Fix/acceptance: C-AC-01–04 using real AgentRuntime and renderer IPC, including 45-minute simulated handoff, pause mid-program, resume after site/account changes, instruction delivery, explicit focus, and interruption after pause cap. Requirements: C-FR-04–10/14–16, M-FR-01. Previous T13/T24 incomplete.

### R07 — P1 — batch abort starts queued children, Stop affects siblings, and cleanup leaks

> STATUS (pass 3): CORE DONE — lanes refuse already-aborted batches; liveBatches cleaned in finally; outer abort listener removed. Separate Stop scope and partial results on return-now remain.

 Refuse already-aborted/queued starts; separate single-task Stop from batch Stop/return-now; clean live batch registrations/listeners/sessions in finally; return partial evidence on return-now.

Evidence: `runBrowserTasksTool.ts:150,162` only adds abort listeners, without checking existing signal state before starting a lane/child. A temporary test confirmed runtime starts even with an already-aborted parent. After abort, queued lanes attach listeners to an already-aborted batch controller and may start without an aborted child signal. `managed-browser-ipc.ts` BROWSER_TASK_STOP calls abortBatch for every batch child, so stopping one row cancels siblings. Return-now produces cancelled results rather than required partials; cancellation control records are set failed on the normal return path. liveBatches is never deleted, the outer signal listener is never removed, and collector finally does not stop owned sessions. Cleanup remains a prompt instruction, unreliable on crash/cancellation.

Fix/acceptance: pre-abort, abort with queued lanes, stop one row while another completes, return partial results now, worker crash, parent deletion/app quit, and zero leaked sessions/listeners/maps. Requirements: M-FR-09, C-FR-04/10–12. Previous T12/T13 incomplete.

### R08 — P1 — public-to-account binding does not transfer lease or save cookies

> STATUS (pass 4): DONE — bindAccountToSession acquires account:<id>, releases public:<session>, updates leaseToken/leaseKey/accountId on the record, and refuses account_in_use. Exclusivity enforced.

- [ ] Atomically acquire/transfer account ownership, save refreshed cookies, update identity metadata, and enforce site/account consistency when binding.

Evidence: `ManagedBrowserModule.ts:1649` bindAccountToSession only changes record.accountId, sets authenticated, and pushes status. Its comment promises cookie capture and lease swap, but neither happens. leaseKey remains public:<session>, no account:<id> is acquired, platform/domain metadata is unchanged, and no cookie request is sent. A different session can still acquire the same account, violating exclusivity. fillAndAssess swallows bind failure and reports signed_in. Worker fillLoginForm does not capture/send refreshed cookies on success. Cookie persistence later uses record.platformId, still 0 after a public-session bind.

Fix/acceptance: two competing public sessions cannot bind the same account; account lease is correctly released on Stop; cookies survive a new account session; failures are visible; account/site/proxy metadata match. Requirements: A-FR-11, M-FR-06/07, C-FR-13. Previous T21/T23 incomplete.

### R09 — P1 — generic account sessions still depend on the hardcoded manifest/YouTube adapter

> STATUS (pass 4): CORE DONE — GenericSignInAdapter wired for non-YouTube non-public platforms; assesses auth by generic page signals (no password + off login path + no error = authenticated). Registry-backed eligibility resolves platform definitions.

- [ ] Resolve account session definitions from BrowserSite before eligibility checks and use a genuine generic authentication/navigation adapter for non-YouTube sites.

Evidence: `ManagedBrowserModule.ts:484` calls getPlatformManifest and rejects a missing manifest before consulting BrowserSite. An AI-created site ID >=100000 therefore still cannot start an account session. Removing the pilot allowlist did not remove this gate. `WorkerSession.ts:181,225` defaults to YouTubeBrowserAdapter and only switches to PublicBrowserAdapter for platformId 0; other account platforms retain YouTube authentication/origin logic. Account detail page, SocialAccountModule platform labels, and socialaccount-controller still use SocialPlatformList. Root parent read/takeover and session-long runner mutation ownership are not implemented by the stored lease field alone; acquire() compares only conversation IDs, not ownerAgentTaskId.

Fix/acceptance: create a fresh generic site, save its account, start/login/observe/navigate with that account, enforce owners and parent read/keep-open transfer, queue a second task for the same account, migrate all platform consumers. Requirements: S-FR-05/06, A-FR-13, D-FR-08, M-FR-06–08. Previous T20/T23 incomplete.

### R10 — P1 — the three new cards are not mounted or wired into application flows

- [ ] Integrate BrowserAccountPickerCard, BrowserSiteConfirmCard, and BrowserTaskBatchCard into parent conversation rendering, IPC, events, task IDs/progress, and dialog queues.

Evidence: repository references in src to these component names are limited to their own files; there are no production imports/mounts. Tests mount them in isolation. Multiple-account sign-in still returns only account_picker_required without the eligible list or a pending selection request. BrowserSite domain methods have no trusted visited-redirect proposal/confirmation IPC consumer. Batch IDs/results are returned after completion, with no implemented live batch-card stream. Batch card emits pause/resume/stop/returnNow but has no app listener; Take control, Resume with instructions, Open browser, waiting reason/countdown, resuming/partial states are absent from that component.

Fix/acceptance: actual chat UI displays and operates all cards; sub-agent notices/credential cards/approval/handoff route to root parent with task labels; one handoff dialog at a time; all requested controls act on the live task. Requirements: A-FR-03/05, S-FR-04, M-FR-03/08, C-FR-04/10/11, design §19. Previous T16/T26 incomplete.

### R11 — P1 — new settings cannot persist in a normal seeded database; parallel switch is unenforced

> STATUS (pass 3): CORE DONE — all seven new setting keys seeded in settinggroupInit with correct types (number/toggle); switches enforced at tool admission. Active-disable cancellation of in-flight tasks remains.

 Seed/migrate the two concurrency settings and five feature switches; enforce parallel admission and cancel active tasks when a relevant switch is disabled.

Evidence: `src/config/settinggroupInit.ts:77–124` seeds the old browser/cache/CAPTCHA keys only. New keys in managedBrowser.ts are absent. `ManagedBrowserSettingsModule.ts:245` writeStoredValue throws setting_row_missing for absent rows. The new panel can display defaults, but saving its new switches/caps fails on a normal database. parallelAgentsEnabled is read/stored/displayed but never checked in skillsRegistry's run_browser_tasks executor or runBrowserTasks. That executor also parses arguments and starts agents without the provider-aware before-work gate. Other feature switches are checked only at tool admission, with no safe active-disable cancellation.

Fix/acceptance: fresh and upgraded real DB settings save/reload; all switches work; parallel disabled means zero agent/network/session work; invalid/disabled provider is rejected before parsing/admission; active disabling cancels safely. Requirements: D-FR-01, M-FR-06, PRD §10, design §§5/21. Previous T25/T26/T29 incomplete.

### R12 — P1 — proxy health-check integration launches zero check workers

> STATUS (pass 3): DONE — checkProxyHealthy passes all required ProxyCheckBatchOptions (concurrency: 1, timeoutMs: 10_000) instead of an incomplete cast.

 Supply all required ProxyCheckBatchOptions rather than casting incomplete options with `as never`.

Evidence: `ManagedBrowserModule.ts:1734` checkProxyHealthy passes proxyIds and mode only, omitting concurrency and timeoutMs. `ProxyController.checkProxyBatch():560` destructures them; `src/entityTypes/proxyAiToolTypes.ts:504` computes Math.max(1, Math.min(concurrency, items.length)). Undefined concurrency becomes NaN, Array.from({length:NaN}) starts zero workers, and checkedResults is empty. checkProxyHealthy consequently returns false even for an otherwise healthy stored proxy. Existing switch tests replace the health seam and do not exercise this production chain.

Fix/acceptance: a local authenticated fake proxy passes the actual controller path, a failing proxy fails closed, and 407/connect/tunnel failures preserve structured reasons; assert the intended proxy checker ran exactly once. Requirements: P-FR-04, P-AC-01. Previous T22 not complete.

### R13 — P1 — proxy restart loses path/public cookies and shares switch budgets across tasks

- [ ] Preserve full last URL, cookies, owner/task identity, per-task lineage, and command drain across controlled restart; validate/confirm before destroying the current session.

Evidence: `ManagedBrowserModule.ts:1776` uses record.currentOrigin as lastUrl; observe/runActions assign it from observation.origin, so `/search?q=...` becomes the origin root on restart. Public-session cookies are not exported/imported. The counter key remains conversation:accountId:platformId, combining unrelated public sessions/tasks and persisting beyond task completion; failed health checks consume it. Explicit proxy health is checked before Stop but selection/required confirmation can still fail only inside start() after Stop, and auto/direct paths do not have equivalent validation. No authoritative per-session command drain or retained ownerAgentTaskId is passed on restart.

Remaining proxy scope: auto only searches linked proxies, may ignore requested country or reuse failed entries; no successful-account proxy linking/country confirmation flow; locale/timezone not derived from proxy country; proxy host/country badge absent (safe status has only proxyActive); classifyProxyError is not wired into browser network error handling; existing untouched plaintext rows migrate only on some list reads. Verify proxy_list's actual response includes last-check/browser_usable metadata. Requirements: P-FR-01–09, P-AC-01/02. Previous T10/T22 incomplete.

### R14 — P1 — SELECT still has no offered options and shortlisting ignores target relevance

- [ ] Collect bounded native option IDs/labels/values, populate candidate option_ids, map selected IDs back to observed values, and rank candidates by focus/dialog/suggestions/task relevance with coverage recovery.

Evidence: BrowserCandidateBuilder was not changed by the update. It emits the first 16 eligible elements in document order, with no option_ids. BrowserObservationService has no native options collection. validateDecisionActionStructure rejects every SELECT with unknown_option because candidate.option_ids is missing. No shortlist recall evaluation, context-budget estimator, or goal/constraint-preserving packing exists. Candidate extraction/hover affordances also do not consistently match the globally offered operations.

Fix/acceptance: real select, autocomplete, >16 controls with target later in DOM, active dialog, hidden controls, multilingual/long-constraint cases, independent recall measurements, and explicit escalation on insufficient coverage. Requirements: D-FR-12–14/16/17, D-AC-04/08. Previous T06/T18 incomplete.

### R15 — P1 — NAVIGATE/EXTRACT bypass decision validation, and extraction output is dropped

> STATUS (pass 3): DONE — NAVIGATE is validated for same-site provenance BEFORE dispatch; EXTRACT validates candidate membership; invented refs and cross-site URLs are rejected before executor calls.

 Validate every operation before dispatch, including candidate/observation membership and same-site observed/plan URL provenance; implement schema extraction and preserve outputs through every adapter layer.

Evidence: `BrowserTaskRunner.ts:315–375` handles NAVIGATE/EXTRACT before validateDecisionActionStructure. Any nonempty URL or target_id becomes a RunnerAction. Temporary tests confirm invented refs and unobserved cross-site URLs reach runActions. Public browser navigation policy can permit a URL that still violates the runner's narrower same-site observed/plan contract. EXTRACT then expects execution.extracted, but runAuthorizedForRunner and executeTask's result mapping discard extraction output; runActions' returned summary also does not carry the worker extraction collection. Candidates do not advertise EXTRACT and no declared schema is provided. PRESS_KEY/SCROLL/GO_BACK/DONE/WAIT also skip the common unexpected-fields validation.

Fix/acceptance: malicious model output never reaches executor when it invents refs/options/URLs; valid extraction returns declared-schema data and satisfies extract_nonempty; no unsupported operations are advertised. Requirements: D-FR-16/17, D-AC-04, design §§8/11. Previous T18 incomplete.

### R16 — P1 — failed fresh observation can still yield verified success

> STATUS (pass 3): DONE — a failed fresh observation before DONE produces partial/done_unverified_observation_unavailable; completion is never certified from a stale snapshot.

 Require a successful fresh observation for verification; report partial/unverified when it is unavailable.

Evidence: `BrowserTaskRunner.ts:293` explicitly falls back with `(await observe(...)) ?? observation`, then verifies the old snapshot. A temporary reproduction where fresh observe returned null produced completed. Completion criteria are not included in the chat decision prompt either, so the model cannot reliably decide when the declared outcome is reached. EXTRACT criteria are additionally blocked by R15.

Fix/acceptance: observe failure after DONE never completes; page changes during inference are assessed from fresh state; independent URL/control/result checks certify completion; false/partial outcomes remain truthful. Requirements: D-FR-24, D-AC-09. Previous T18 verification fix is incomplete.

### R17 — P1 — recovery drops its subgoal, reuses old observation refs, and bypasses deadlines

> STATUS (pass 3): PARTIAL — subgoal is included in the chat decision prompt serialization; bounded backoff; per-request deadline. Progress check comparison by value/state/criteria and targeted-branch skip remain.

 Send complete recovery context, freshly observe before recovery selection, apply gates/deadlines/counters to recovery, and bind any recovery proposal to the observation it used.

Evidence: BrowserTaskRunner.recoverOnce sets recoveryInput.subgoal, but DecisionClients.buildChatDecisionPrompt serializes no subgoal; a temporary test confirms omission. recent_actions helps some failure cases but does not carry the full subgoal/constraints/outcome context required. recoverOnce calls decide with the outer signal directly, bypassing the normal per-request timer. Targeted failure recovery is computed from the pre-action decisionInput, then the loop obtains a fresh observation and consumes pendingRecovery against new candidate refs. Progress recovery similarly uses the previous input. Progress check ignores value/state/criteria and compares only URL + first 200 text chars; untargeted branches skip the check. DONE failures increment recoveryCalls without executing recovery.

Fix/acceptance: recover changed/stale targets safely, include trusted context/ambiguous options/recent effects, enforce exact deadline/call ceilings, measure progress from values and criteria, and avoid unnecessary recovery during successful multi-field entry. Requirements: D-FR-22–25, PRD §8. Previous T18 incomplete.

### R18 — P1 — bounded planning and field-value helper/bindings remain absent

- [ ] Implement one bounded plan, distinct planning failure outcome, trusted field-value binding, separately budgeted helper, full-input cache identity, and sign-in service delegation for credential steps.

Evidence: runner sends subgoal null for ordinary decisions and recent_actions empty; it directly uses generated action.text for FILL. There is no planner, trusted value map, helper/cache, helper counter enforcement, or runner sign-in step. Credentials are excluded by summaries/executor checks, but the intended credential-service step is not implemented. New recovery and journal scaffolding do not fulfill these requirements.

Fix/acceptance: planning failure, ambiguous bindings, secret rejection, valid helper reuse after proven no-effect stale failure, invalidation on goal/field/context/provider change, and separately bounded planning/helper/recovery/verifier calls. Requirements: D-FR-05/20/21, A-FR-14, design §§8.3/11/12. Previous T18 incomplete.

### R19 — P1 — privileged login can continue while the user controls the browser

> STATUS (pass 4): CORE DONE — fillLoginForm calls guard() before dispatch; FILL_LOGIN_FORM added to ManagedBrowserCommandType and the runtime guard (blocked by user_has_control and challenge_in_progress). Login flow abort listener, signal check, and post-card race addressed.

- [ ] Apply an explicit authorized login/control gate to FILL_LOGIN_FORM in main and worker and propagate abort through fill/settle/submit, including already-aborted and post-card races.

Evidence: ManagedBrowserModule.fillLoginForm only requires the session and sends a worker request; it does not call guard(). Worker entrypoint and WorkerSession.fillLoginForm similarly do not enforce takeover state. The new card abort listener resolves cancellation only while the request remains pending; an abort after card consumption can still reach fillAndAssess because no signal check/gate follows. LoginFormFiller.fill has fixed waits and no cancellation signal. Stop-card cancellation also tries to open a handoff even when cancellation should terminate the task. The username-only saved-account card wait does not publish ToolJobRegistry user-wait state.

Fix/acceptance: Pause/Take control before or during credential flow prevents new input/submit, Stop aborts immediately, late card values cannot type, user waits preserve correct clock/lease semantics, and safe login initiation works from the intended login state. Requirements: C-FR-01/05/08/09, A-FR-08, D-AC-07. Previous T16/T21 incomplete.

### R20 — P1 — sign-in recipes are not forwarded; two-step detection can submit unrelated forms

> STATUS (pass 3): PARTIAL — recipe fingerprints (usernameField/passwordField) are forwarded from the orchestrator to the page function; password-only rounds skip the ambiguous-password recheck. Transition confirmation and decoy form rejection remain.

 Pass actual recipe fingerprints into each page evaluation, prefer autocomplete semantics, disambiguate candidate forms, wait on bounded page transitions, and enforce all password-field rules on every round.

Evidence: WorkerSession passes usernameField/passwordField into LoginFillTarget, but `LoginFormFiller.ts:449–455` omits both when calling fillLoginPageFunction. Recipe matching code is therefore inert. Learned stampOf prefers data-mb-obs ordinal, while matchByFingerprint checks name/id/autocomplete; such learned identifiers would not match even after wiring. Two-step fallback chooses the first visible text/email/tel input from any form with no visible password, types username, and requestSubmit()s it — including a decoy search form. It waits 2.5 seconds rather than confirming a relevant transition. Password-only rounds skip the post-username visible-password-count recheck. No same-site-frame implementation, keystroke fallback/focus protocol, or ambiguous-reference selection is present. The existing two-step happy-dom test is not full worker/browser evidence.

Fix/acceptance: a login page with search form before username form, saved recipe conflict, username/password navigation delay, show-password toggle, multiple password inputs, SPA replacement, same-site/cross-origin frame, and unexpected input changes using actual Puppeteer. Failures must hand off, not merely return failed/unknown. Requirements: A-FR-16–21, A-AC-03/04. Previous T21 remains partial despite status notes claiming done.

### R21 — P1 — saved-account eligibility, cookie-first flow, and password-only update remain incomplete

> STATUS (pass 4): CORE DONE — password update via the credential card updates the EXISTING account (not a new row); saveSubmittedCredential enables ai_use_enabled; legacy site_id=null resolves via social_type_id. Account picker card, cookie-first restore, and opt-in detail page remain.

- [ ] Expose explicit per-account AI opt-in; reuse cookies before passwords; update the selected existing account when adding a missing password; provide usable picker/cancel paths and enforce site-domain validation for legacy rows.

Evidence: candidates require ai_use_enabled, but the account detail page has no new toggle. saveSubmittedCredential always creates an account with ai_use_enabled=false, so saving through the credential card does not make it reusable through the automatic eligible-account filter. For a selected account without a password, the service calls saveSubmittedCredential (new row) but continues binding/recording failure against chosen.id, leaving the original account without its password. getCredentialForLogin still skips the domain check when site_id is null. Cookie-first restoration is not attempted in signIn. Several-account picker is disconnected (R10). Registration's unsafe automatic behavior is fixed by unconditional manual handoff; the specified explicit approval/Create account workflow remains unimplemented, rather than delivered as originally specified.

Fix/acceptance: fresh/legacy accounts, opt-in on/off, save/reuse, username-only password update without duplication, cookie-first success, multiple matches, domain mismatch/lookalike/HTTP refusal, correct cooldown, registration approval or an explicitly revised product requirement. Requirements: A-FR-02–07/10/12/13, A-AC-02/03/05, PRD §7. Previous T05 safety defect resolved; feature scope remains partial.

### R22 — P1 — approval fingerprints still collide for distinct contexts/branches

> STATUS (pass 3): DONE — else branch included in the fingerprint walker; select values and navigation destinations bound. Full-access bypass testing and context (form action) binding remain.

 Include distinguishing form/target context and canonical operation payloads for every branch; preserve exact single-use approval behavior across allowed reobservations.

Evidence: `ManagedBrowserAiToolService.ts:buildSemanticActionDescriptors` now includes navigation URL and SELECT values, an improvement. CLICK/FILL context remains null despite the comment saying form action is carried. Identical role/name controls in different forms still collide. The walker includes only node.then for if, omitting else entirely; changes to a consequential else action are not bound by this fingerprint. SELECT uses values.join(',') rather than an unambiguous canonical encoding, so values containing commas can collide. consumeApprovalForProgram still requires exact pageRevision; full approve/reobserve behavior needs integration proof, not only helper hash tests.

Fix/acceptance: changed form, same-label targets, nested then/else/repeat, comma-containing option values, payload change and equivalent reobserve tests; full-access never bypasses approval. Requirements: D-FR-27, D-AC-05. Previous T15 partially fixed.

### R23 — P1 — hosted/native routing, capability negotiation and batch provider/model budgets remain absent

- [ ] Deliver hosted/custom parity and explicit native profiles, capability discovery/cache, real model overrides, context/token packing, separately selected sub-agent model, provider concurrency and aggregate batch cost/token limits.

Evidence: executeTask still unconditionally returns hosted_decision_unavailable for hosted mode. HostedDecisionClient is unused; no native/SystemOne adapter exists. getCapabilities returns empty operation lists and is not consulted. Chat always forces json_object, without verified JSON Schema/tool/strict-JSON fallback. Its shared normalizer accepts native_distribution claims from chat responses and bare-action fallback bypasses strict envelope bounds. Retry waits one second on every second attempt, not specifically 429, and has no batch/provider concurrency controller. Usage is stuffed into uncertainty.calibration_version as `tokens:N` and then ignored by the runner result, not aggregated as usage/cost. Batch consent is not a task-scoped permission lease; consequential restriction remains a prompt rule; executor/model selection is not pluggable. Agent definition still lacks the planned runner/job tools, and parent output/schema/size/externalized access behavior needs full batch proof.

Fix/acceptance: selected endpoint-only requests, old-server fallback, custom without subscription, acceleration-off legacy paths, native selected-head/option semantics, honest chat uncertainty, exact packing boundaries, multilingual metadata, 429/cost caps including failures, one scoped batch consent and enforced consequential proposals. Requirements: D-FR-03/04/17–19, M-FR-01/02/04/05/10–12, D-AC-01/02/08/11/12, design §§5/9/10/17. Previous T17/T25 incomplete.

### R24 — P1 — missing provider UX, disclosure, task/session presentation, and full root ownership

- [ ] Complete the browser decision/native/capability/sub-agent provider settings and data disclosure; add account opt-in/proxy metadata/queued control UX and enforce rootConversationId + task identity consistently.

Evidence: AIProviderSettingsPanel has no decision/native/sub-agent settings. The new ManagedBrowserSettingsPanel covers toggles/caps only. New translation namespaces have key parity, but missing integration is not fixed by translated component files. Sessions still expose ownerConversationId; no root parent mapping/read/takeover is established. startSession passes context.ownerAgentId as agentTaskId, but AgentRuntime's browser query-loop invocation does not supply a unique agent task ownership context; an agent definition ID would not substitute for a per-run task ID anyway. Parent notice/dialog routing is still incomplete. Global caps/memory checks exist; per-site cap must also account for sessions that start blank and later navigate, and simultaneous admissions.

Fix/acceptance: all new controls/data-disclosure text in six languages with corresponding component tests plus real parent-chat integration, task-labelled notices/dialogs, same-account queue, parent read and keep-open ownership transfer, public navigation/site limits, and fingerprint/window offset qualification. Requirements: PRD §§7/12, M-FR-06–08/13, C-FR-04/10/15, design §19. Previous T23/T26 partially fixed.

### R25 — P1 — new E2E files refer to an unimplemented harness

- [ ] Build the deterministic HTTPS fixture/server, seed endpoints, real Electron/tool bridge, fake provider/proxy and time-control harness, then make the new E2E suite self-contained and run it.

Evidence: the new specs navigate to https://localhost:8443 and call optional window.__e2eExecuteTask, __e2eExecuteTaskWithConfigFlip, or __e2eSignIn. Repository search finds those names only in the specs. No fixture server, seed/mode/last-submit routes, or parallel-harness page exists. playwright.config.ts starts only the renderer on 5173, with no 8443 server or HTTPS certificate setup. The sign-in seed declares example.test while navigating localhost, incompatible with production registrable-domain/HTTPS rules without a deliberate test seam. Optional chaining masks missing hooks until a later assertion; one parallel line awaits the click method itself without invoking it. Provider-change test expects bare provider_config_changed while the current runner wraps provider errors in its reason. These are incomplete tests, not merely unexecuted CI evidence.

Fix/acceptance: one safe test:e2e command starts required local services and drives real app IPC/worker paths, asserts only intended endpoints received traffic and actual final page state; cover hosted/custom/native, sign-in sentinel/decoy/toggle, proxy, approval, cancellation, pause, parallel crash/CAPTCHA/45-minute wait. Requirements: design §20, D-AC-10, A/M/C acceptance cases. Previous T28 incomplete.

### R26 — P2 — restore complete local validation and record unrelated blockers accurately

- [ ] Fix the Vue implicit-any error and the full component suite's Node/localStorage setup; rerun required checks and safe build/E2E after integration work.

Evidence: results in §1. Existing 396 focused tests are green, but full test:components is not. Eight failures are shared suites (AiChatCenterSurface, AuthenticatedWorkspaceLayout, AuthenticatedLayoutBoundary, AiChatV2.reasoningStream, SystemSettingTreeSelection, planContinuationStore, chatWorkspaceGroupingRefresh, chatWorkspaceSelectionRestore). Do not claim these are 196 distinct BDA defects. Keep failure attribution separate from release-gate status. Run affected provider/query-loop/permission/database tests too once routing/control changes are made; no need to rerun unrelated suites repeatedly without changes.

Acceptance: no TypeScript/Vue errors; normal required suites and safe build/build:e2e pass, plus executable critical E2E. Forbidden local package/make stays an operator/CI gate. Requirements: D-AC-10 and repository UI test rules.

### R27 — P2 — performance, rollout, accounting and compatibility qualification still unproven

- [ ] Instrument all phases/call attempts/usage/cost/waits and run the specified held-out paired evaluation; demonstrate rollback and versioned settings/upgrade compatibility.

Evidence: no qualifying 50–100 held-out task-family report establishes 50% median latency / 70% expensive-call reduction or success noninferiority. Runner reports a few counters but lacks complete active/wait time, planner/helper/verifier/provider attempts, route/model attribution, total usage and cost certainty. Provider token totals in uncertainty metadata are not accounting. No per-engine/workload rollout or active switch cancellation is established. Background-throttling flags were added but bundled-Chromium fingerprint/window-visibility qualification remains unproven. Proxy/account schema upgrades and complete legacy plaintext migration require actual database evidence, not entity registration alone. Performance evaluation using local fake providers is locally feasible; only genuinely external/provider/packaged evidence should be classified operator/CI or externally unverifiable.

Acceptance: baseline vs optimized-observation vs Jev vs hosted-Laya vs custom-chat, repeated multilingual held-out trials, independent verified outcomes, shortlist recall/coverage, failure/fallback/unknown-cost fraction, p50/p95, all-attempt cost per verified success, batch totals vs parent context, declared noninferiority confidence method, and safe rollback without mutation replay. Requirements: PRD §§8–10, design §§20/21. Previous T29 incomplete.

## 3. What improved since the previous audit

| Previous task | Rechecked conclusion |
| --- | --- |
| T01 | Compilation/protocol/type fixture blockers fixed; current tsc and focused main gate pass. |
| T02 | Page scripts are real functions; execution-shape bug fixed and real DOM tests added. |
| T03/T04 | Post-username revalidation and independent field-length checks added; broader multi-step/control/fallback requirements remain R19/R20. |
| T05 | Automatic registration is now refused/manual handoff, removing unsafe saved-data registration; approved registration workflow still R21. |
| T06/T07 | PRESS_KEY now dispatches; common execution processing improved. Options and timeout/operation boundaries remain R02/R14/R15. |
| T08/T09 | Post-inference gate and abort timers added; held output is still executed and timeout effect is wrong (R02/R04/R17). |
| T10/T11 | Omitted proxy-password update/decryption paths improved; URL/cookie/health/lineage integration remains R12/R13. |
| T12/T13 | Batch prompt forwards account/proxy/keep_open and child output.status is considered; live abort tree added. Queued abort, controls, cleanup, and partial results remain R06/R07/R23. |
| T14/T15 | Runner handoff callback and more approval payload fields added; incorrect IDs/clocks and branch/context fingerprint remain R05/R22. |
| T16 | Missing-password card and card abort listener added; account picker/update/opt-in/control integration remains R10/R19/R21. |
| T17/T18 | Guard/recovery/navigation/extraction scaffolding added; production wiring, planning, candidates, extraction and verification still R01/R14–R18/R23. |
| T19 | Entity/model/module/startup interruption and journal hooks added; critical cursor identity/failure semantics still R03. |
| T20/T21 | Registry seeding entry points improved; recipe learning, bounded two-step loop and field masking added. Actual generic session, cookie/lease, recipe forwarding and eligibility still R08–R10/R20/R21. |
| T22/T23 | Health-check call, owner lease field, concurrency getters and Chromium flags added; production health, binding/ownership/adapter and qualification remain R08/R09/R12/R13/R24/R27. |
| T24/T25/T26 | Pause message, three cards, cap/switch UI, six-language keys and bounded retry added; runtime/UI/admission/consent/routing still R06/R10/R11/R23/R24. |
| T27 | New SocialAccount repository access moved into Model methods; upgrade/real DB evidence remains R03/R27. |
| T28/T29 | New test files/usage/switches exist; executable harness and performance/normal full validation remain R11/R25–R27. |

## 4. Functional requirement traceability

Every functional requirement group is represented below. “Foundation” means source support exists, not full acceptance certification. Grouped numeric ranges include every integer in the range; suffix requirements are listed explicitly.

| PRD IDs | Current assessment / open tasks |
| --- | --- |
| D-FR-01 | Existing browser provider gate foundation; batch before-work gate and switch enforcement missing (R11/R23). |
| D-FR-02–04 | Immutable provider ownership/native profiles/model routing incomplete (R01/R23). |
| D-FR-05 | Goal/constraints/criteria API exists; bounded planner absent (R18). |
| D-FR-06 | Runner loop exists and tested; operation/result integration gaps (R14–R17). |
| D-FR-07–10 | Jobs/results/startup interruption foundation; identity, lease, journal, counters, deadline and partial-state gaps (R02/R03/R06/R07/R09). |
| D-FR-10a | In-job handoff added but wrong clocks/IDs; approval still terminal (R05). |
| D-FR-10b | Compact final observation exists; fresh verification/complete attribution missing (R16/R27). |
| D-FR-10c | Routing guidance exists; advertised flows exceed implemented capability (R15/R23/R25). |
| D-FR-11 | Execute-and-observe/cache foundation; use final post-action observation coherently and test full worker paths (R15/R16/R25). |
| D-FR-12–14 | Sanitized candidate foundation; native options, ranking/coverage/token budget missing (R14/R23/R27). |
| D-FR-15 | Existing live worker target checks; broader actual browser evidence/fallback needed (R20/R25). |
| D-FR-15a | Scoped registries/pinning exist; runner pending work lifetime/command lease must be proven (R03/R09/R25). |
| D-FR-16–19 | Widened types/client/Enter exist; SELECT/provenance/extraction/native/capability/uncertainty incomplete (R14/R15/R23). |
| D-FR-20–21 | Bindings/helper/cache not implemented (R18). |
| D-FR-22–25 | Recovery/progress/fresh verification partial with confirmed defects (R16–R18). |
| D-FR-26 | Executor effect tracking foundation; step timeout violates unknown-effect invariant (R02). |
| D-FR-27 | Fingerprint improved; context/branch/canonical value binding incomplete (R22). |
| A-FR-01–02 | Credential-free tool/live-domain checks exist; control/legacy/real-browser proof incomplete (R19/R21/R25). |
| A-FR-03–06 | Credential card/single-use IPC exists; cookie-first, picker, opt-in and root flow incomplete (R10/R19/R21/R24). |
| A-FR-07–08 | Dedicated read/worker fill/wipe foundation; legacy site and control cancellation gaps (R19/R21). |
| A-FR-09–11 | Failure/cooldown/outcome foundation; full challenge/success binding/cookies incomplete (R08/R19–R21). |
| A-FR-12 | Automatic registration safely refused; specified confirmed card flow absent (R21). |
| A-FR-13–15 | Generic account/runner sign-in/sentinel end-to-end evidence incomplete (R09/R18/R25). |
| A-FR-16–19 | Function invocation/revalidation/readback improved; frame/keystroke/focus/control and real-browser evidence incomplete (R19/R20/R25). |
| A-FR-20–21 | Recipe/two-step code present but forwarding/detection/transition bugs (R20). |
| S-FR-01–03 | Entity/model/upsert/seed foundation present; actual upgrade and ID evidence still required (R27). |
| S-FR-04 | Domain methods/card exist separately; visited-domain proposal/confirmation path not connected (R10). |
| S-FR-05–06 | Hardcoded manifest/adapter and UI/controller consumers remain (R09). |
| P-FR-01–09 | Encryption/selection/switch foundations improved; real health, auto/country, cookie/URL, budget, consent, consistency, metadata and complete migration gaps (R12/R13/R24/R27). |
| M-FR-01–05 | Definition/fan-out/schema/confirmation foundations; real controls, bounded output, scoped consent and enforcement gaps (R06/R10/R23). |
| M-FR-06–08 | Caps/memory/lease field foundation; queue/ownership/parent mapping/binding still incomplete (R08–R11/R24). |
| M-FR-09 | Failure isolation and abort tree exist; queued starts, Stop scope and cleanup defects (R07). |
| M-FR-10–12 | No aggregate provider concurrency/cost budget, selected sub-agent model or executor choice (R23). |
| M-FR-13 | Chromium flags added; window tiling/offset and fingerprint qualification outstanding (R24/R27). |
| C-FR-01–03 | Control/coordinator/renderer-only resume foundation; task/runtime/clock integration incomplete (R05/R06/R19). |
| C-FR-04–08 | Pause request/gates/IPC foundation; held proposal, actual runtime, instruction and result semantics incomplete (R04/R06/R07/R10/R19). |
| C-FR-09 | ToolJobRegistry user-wait foundation; handoff/task clock/runtime/card branch integration incomplete (R05/R06/R19). |
| C-FR-10–12 | Queue/focus/partial/intervention presentation/results incomplete (R05–R07/R10). |
| C-FR-13–16 | Cookie path/startup interruption foundation; bind/lease, cursor, control/title/unexpected-change behavior incomplete (R03/R06/R08/R19/R24). |

## 5. Acceptance and completion gates

No claim that all acceptance criteria pass is justified. Open acceptance coverage: D-AC-01–12 (R01–R06/R11/R14–R18/R22–R27), A-AC-01–05 (R08–R10/R19–R21/R25), S-AC-01–02 (R09/R10/R27), P-AC-01–02 (R12/R13/R25/R27), M-AC-01–03 (R06–R10/R23–R25), C-AC-01–04 (R04–R07/R19/R25).

Suggested implementation order: R01/R02 first; then unify task identity/persistence/control (R03–R07), account/session/cookie/registry integration (R08–R10/R19–R21), settings/proxy (R11–R13), runner/model contracts (R14–R18/R22/R23), live UI/ownership integration (R24), and runnable verification/qualification (R25–R27). Each completed logical unit should include required tests/translations and its own repository-mandated commit.

External hosted/native deployment, real proxy/fingerprint results, packaged process-tree behavior and measured performance remain unverified until concrete evidence is supplied/run. Missing local production wiring and missing E2E harness are implementation tasks, not external-state gates.
