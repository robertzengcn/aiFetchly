# Browser decision acceleration: implementation audit and TODO

Audit date: 2026-11-03 (Asia/Shanghai). Worktree: `E:\project\aiFetchly-bda`, branch `feature/browser-decision-acceleration`.

Sources: [PRD](browser-decision-acceleration-prd.md), [technical design](browser-decision-acceleration-technical-design.md). Initial HEAD was `c3413ec61`; the initially dirty implementation was committed externally during this audit as `c6f637603`. Findings include those changes. This audit changes documentation only.

**Verdict: requirements are NOT all complete; this worktree is not release-ready.** Several foundations exist, but important execution, credential, control, persistence, provider, UI, and qualification paths remain incomplete. Commit subjects and passing mock tests do not establish acceptance. All checkboxes below intentionally remain open.

> **Status update 2026-11-03 (implementation pass):** T01–T15, T16 (core),
> T17 (route freeze), T18, T19, T20 (registry gate + seeding), T24, T25
> (switches), T26 (cards), T27, and T28 (typecheck + path fix + E2E spec
> files) are implemented and committed on
> `feature/browser-decision-acceleration`. The repo typechecks clean
> (tsc exit 0) and the affected suites pass without skip flags. Items NOT
> yet fully closed: T21 (recipes/two-step/cookie-first), T22 (proxy
> health/geography/UI), T23 (queues/root notices), T24 (resume semantics
> in agent transcripts), T25 (batch consent lease + rate limits), T26
> (settings panel section), T28 (E2E execution needs the fixture harness),
> T29 (qualification) — checkboxes below remain open with status notes.

Priority: P0 blocks basic operation or violates a mandatory safety property; P1 blocks a required feature/correctness contract; P2 covers remaining integration, maintainability, or qualification work. Evidence below is source inspection unless explicitly labelled as an executed check. Line references describe the audited snapshot.

## Executed checks and limitations

| Check | Actual result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | FAILED: 60 TypeScript diagnostics. See T01. |
| Direct Vitest main config, browserDecision/browserLogin/browserAgents directories | BLOCKED by mandatory global TypeScript gate; no tests executed in this normal run. |
| Same focused tests, diagnostic run with `AIFETCHLY_SKIP_TSC=1` and `AIFETCHLY_SKIP_VITE_CHECKER=1` | 11 files / 83 tests passed. This bypass is diagnostic only, not release evidence. |
| Managed-browser tests with the same diagnostic bypass | 23 files: 22 passed, 1 failed; 293 tests: 292 passed, 1 failed. Windows path assertion in `managedBrowserModule.test.ts:602`. |
| `node node_modules/vitest/vitest.mjs --config test/vitest/main/components/vitest.config.mjs run` | 179 files: 171 passed, 8 failed; 1577 tests: 1381 passed, 196 failed. Shared `localStorage`/environment failures under Node 26.2.0; causation by this feature is not established. |
| Yarn commands | `yarn` unavailable on PATH; installed local executables used instead. |
| Browser/Electron E2E, build, Vue typecheck, real proxy/fingerprint checks, performance evaluation | Not run; no passing claim. Fix compile gate and missing integration paths first. |
| Forge packaging | Deliberately not run. `yarn package`/`yarn make` forbidden locally; packaged process-tree evidence is an operator/CI gate. |

Raw command logs from this run are in `%TEMP%/bda-audit-typecheck.log`, `bda-audit-tests.log`, `bda-audit-diagnostic-tests.log`, `bda-audit-managed-tests.log`, and `bda-audit-components.log`. They are local ephemeral evidence, not committed artifacts. Commands redirected output and then printed it; shell wrapper exit success must not be mistaken for compiler/test success.

## Confirmed defects and blocking integration gaps

### T01 — P0: restore compilation and worker protocol compatibility

> STATUS: DONE — protocol constants unified (worker entry, cache worker, tests);
> WorkerLoginRecipe inferred from the schema; wire error codes extended; settings/proxy/test fixtures fixed; `tsc --noEmit` exits 0 repo-wide and the main gate runs unbypassed.


- [ ] Fix the 60 diagnostics and run the unbypassed main test gate again.

Evidence: `src/config/managedBrowser.ts:19` defines protocol 2, but `src/childprocess/managed-browser/index.ts` `baseMessage()` hardcodes protocol 1 for WORKER_READY, heartbeat, and errors. `managedBrowser.ts:36` requires the current protocol. A real worker's first ready event is incompatible with the main schema, preventing normal session boot. `WorkerSession.ts:1148` and cache worker base types still declare version 1 despite current-version values.

Other concrete compiler failures: missing `WorkerLoginRecipe` export imported by `WorkerSession.ts:12`; incorrect `ReturnType<typeof workerLoginRecipeSchema>` on a Zod object in `src/schemas/worker/managedBrowser.ts:557`; ACTION_RESULT step/observation type mismatches; nullable proxy password assigned to `Partial<ProxyEntity>` in `Proxy.model.ts:110`; missing concurrency settings in `ManagedBrowserSettingsModule.ts:90`; outdated safe-status fixtures, numeric lease keys, and missing observation IDs in tests.

Acceptance: one source of truth for worker/cache protocol versions; actual entrypoint ready/heartbeat/start/observe/action roundtrip tests (not only WorkerSession doubles); zero TypeScript errors; normal main tests execute without skip flags. Requirements: D-FR-06/11/26, design §§7/20.

### T02 — P0: execute the credential page scripts instead of returning functions

> STATUS: DONE — both page scripts are real functions passed to evaluate; a happy-dom suite (`loginFormFiller.dom.test.ts`) executes the production function against a live form and asserts values/stamps/secret non-disclosure.


- [ ] Replace the string-function evaluation in `src/childprocess/managed-browser/LoginFormFiller.ts` with an actual callable page function and serializable arguments; fix the outcome probe similarly.

`FILL_SCRIPT` is a string ending in an uninvoked `((input) => { ... })`, passed to `page.evaluate(FILL_SCRIPT, payload)`. `OUTCOME_PROBE_SCRIPT` is also an uninvoked function expression. Installed Puppeteer's `node_modules/puppeteer-core/lib/puppeteer/cdp/ExecutionContext.js:345` sends string input through `Runtime.evaluate` and does not pass the argument list. Thus the fill body never runs, and the returned serialized value is not the expected `{ok,...}`; dereferencing `fillResult.ok` can fail. Existing `loginFormFiller.test.ts` mocks scripts by substring and implements its own behavior, hiding this defect.

Acceptance: execute the real filler on a deterministic HTTPS login page with actual Puppeteer; assert DOM values, submitted request, outcome, and secret non-disclosure. Requirements: A-FR-08/15–19, A-AC-01/02/04.

### T03 — P0: revalidate the password target after synchronous page handlers

> STATUS: DONE — the filler revalidates type/enabled/readonly/visibility/hit-test/same-form (via form association) AFTER the username set; a handler toggle aborts with `password_field_mutated` and cleared fields; covered by the DOM suite.


- [ ] Revalidate type, same-form identity, attachment, visibility, enabled/read-only state, and hit testing immediately before the password setter; refuse and hand off on changes.

`LoginFormFiller.ts` checks the password field, then calls `setNativeValue(usernameInput, username)`, which synchronously dispatches page `input`/`change` handlers, then sets the password without revalidation. A page handler can toggle the password input to `type=text`, replace it, or change its form between check and use. The existing toggle test only supplies a mocked initial type.

Acceptance: real page tests in which username input handlers toggle/replace the password field must prove that the password never lands in the modified target. Requirement: A-FR-16, A-AC-04.

### T04 — P1: correct login readback/tamper detection

> STATUS: DONE — per-input (not summed) length comparison, prefilled-username success, per-field readback, clearing of ALL affected fields (touched + unexpected recipients); synthetic-Enter replaced by focus-checked requestSubmit; covered by the DOM suite. Keystroke fallback remains deferred (A-FR-19 fallback path).


- [ ] Compare each non-target input independently, account for existing target values, verify username length, and clear all affected fields before handoff on mismatch.

`LoginFormFiller.ts` compares only total input lengths and assumes the expected delta is `username.length + password.length`. A prefilled username makes a legitimate fill fail; equal-and-opposite changes to other fields evade the sum check. Only the chosen username/password are cleared; unexpected recipient fields retain data. Readback mismatch exits without clearing. Keystroke fallback/focus checks are absent, and a synthetic `KeyboardEvent('keydown', Enter)` does not implement trusted native Enter submission.

Acceptance: prefilled username, compensating non-target field changes, rerendered inputs, controlled forms, and Enter-based submission tests using the actual script. Requirements: A-FR-18/19.

### T05 — P1: require registration-specific authorization

> STATUS: DONE (stricter than asked) — register intent ALWAYS hands off to the user with `registration_not_confirmed`; v1 is login-only per PRD Q-02, so no automated registration path exists at all.


- [ ] Gate `intent: register` through explicit registration approval before releasing saved credentials or submitting a form.

`skillsRegistry.ts` registers `browser_sign_in` with `requiresConfirmation: false`; `BrowserCredentialLoginService.signIn()` follows the same saved-account path for login and registration. A single eligible saved account reaches `fillAndAssess()` without a registration approval/card. Registration mode also chooses the first visible password field without handling confirmation-password fields.

Acceptance: an agent cannot register using existing account data without a distinct user approval; registration card uses Create account wording and handles verification through handoff. Requirements: A-FR-12, design §13.7.

### T06 — P1: execute PRESS_KEY and provide observed SELECT options

> STATUS: PARTIAL — untargeted PRESS_KEY executes (Enter test added). SELECT option collection from the DOM is still open (checkbox below).


- [ ] Handle untargeted PRESS_KEY separately from element-targeted operations; populate option IDs/labels and map selected IDs to observed native values.

`BrowserTaskRunner.ts` validates PRESS_KEY, then unconditionally looks up `action.target_id` in candidates before calling `toRunnerAction()`. Valid PRESS_KEY has no target and therefore produces `target_not_in_observation` without sending Enter. `BrowserCandidateBuilder.ts` never populates `option_ids`; SELECT always fails the `unknown_option` check. Observation collection does not return native option records either.

Acceptance: fake search submits once via Enter, native select chooses an offered option, invented options are rejected. Requirements: D-FR-12/16/17, D-AC-04.

### T07 — P1: honor policy stops and unknown effects for every operation

> STATUS: DONE — GO_BACK/SCROLL/PRESS_KEY/targeted ops all share one post-execution processor (policy stops terminal, unknown effect terminal, uniform equivalent-failure accounting); parameterized tests added.


- [ ] Apply the same result/stop/error processing to GO_BACK, SCROLL, and all other operations before another decision.

`BrowserTaskRunner.ts` GO_BACK discards its execution result entirely (`void result`), including unknown effect and policy stops. SCROLL checks only `effect === unknown`, ignoring `stopCode` and failed step results. Both bypass the common action validator. This permits continued inference after an execution boundary that should stop/wait. Targeted actions use more complete handling, so current behavior depends on the selected operation.

Acceptance: parameterized tests for approval/handoff, known failure, cancellation, and unknown effect for every operation; unknown effects never cause another mutation. Requirements: D-FR-09/26, D-AC-06.

### T08 — P1: prevent late inference from acting after Pause or Stop

> STATUS: PARTIAL — the runner re-checks gate+abort after every awaited decision and discards held proposals (test: cancel-during-inference acts zero times). Remaining: abort propagation INTO the provider controller is timer-based only; authoritative task→session binding still open.


- [ ] Check the control gate and cancellation immediately before every execution and after each awaited decision; discard held proposals on resume and use a fresh observation.

`BrowserTaskRunner.run()` checks the gate only at the top of its loop, before inference. A pause/stop during `decide()` is not checked before `runActions()`. `AgentTaskControlService.cancel()` changes state but does not abort the provider controller. The IPC handler can close a session, but sessionId is optional and there is no authoritative task-to-session binding. Initial observation runs before the runner's try/finally; escaped failures can leave records incorrectly running/completed.

Acceptance: pause during a delayed model response executes zero new actions; resume discards that response; Stop aborts inference and worker execution and never reports completed on error. Requirements: C-FR-05/06/08, D-AC-07.

### T09 — P1: enforce actual route/request/worker deadlines

> STATUS: PARTIAL — per-attempt abortable timers capped by remaining active time bound provider calls; the authorized seam bounds each worker leaf with `cancelActiveRequest` on timeout. Route-freeze (T17) and remaining-active capping of in-flight work at the exact ceiling still open.


- [ ] Bound each provider attempt and worker leaf with abortable timers capped by remaining active time; propagate provider changes/cancellation through all awaited work.

`BrowserTaskLimits.ts` defines request and worker budgets, but the runner only includes `deadline_ms` in decision input; `DecisionClients.ts` does not enforce it, and the executeTask chat callback does not pass that deadline into the API request. Runtime is checked only between calls; an in-flight call may exceed the task ceiling. `perStepWorkerTimeoutMs` is not used by the runner seam. Route/provider revision is not frozen (T17).

Acceptance: delayed fake endpoints and worker calls terminate at exact boundaries; no late action; user waiting is excluded without resetting consumed budgets. Requirements: D-FR-09, PRD §8, design §12.

### T10 — P1: preserve proxy-switch page, cookies, ownership, and lineage

> STATUS: PARTIAL — the switch reopens the last page; the lineage cap was fixed earlier. Cookie export/import drain, health-check-before-switch, and lineage scope refinement remain open.


- [ ] Replace stop/start-only switching with serialized drain, cookie export/import, target validation/health check, relaunch, GET of last URL, and fresh observation/revision.

`ManagedBrowserModule.switchSessionProxy():1670` increments a shared counter, stops the old session, then calls `start()` with account/purpose/proxy/conversation only. It does not pass the last URL or transfer public-session cookies. Public sessions therefore restart at their default page with lost state. A bad target destroys the working session before selection fails. The counter key `${conversation}:${accountId}:${platformId}` combines independent public sessions and survives unrelated tasks rather than belonging to a task/lineage. A failed attempt also consumes the cap.

Acceptance: public and account sessions preserve intended cookies/URL and return usable fresh state; unrelated tasks have independent switch budgets; in-flight input is not interrupted blindly. Requirements: P-FR-02/05, P-AC-01.

### T11 — P1: decrypt proxy credentials at all authorized use boundaries

> STATUS: DONE — metadata-only updates preserve the stored credential (explicit empty clears); `ProxyModule.getProxiesByIds` decrypts for the check path in main only. Other network consumers still to audit.


- [ ] Preserve passwords on metadata-only updates and decrypt for existing proxy check/consumer paths without returning secrets to the LLM.

`ProxyModel.saveProxy()` always writes `pass: encryptForStorage(proxyData.pass ?? null)`, so an update that omits pass overwrites the stored credential. New records store ciphertext, but `ProxyModule.getProxiesByIds()` returns `proxy.pass` unchanged and `proxy-controller.ts:589` feeds it into ProxyParseItem for checking. Browser-specific paths decrypt; the existing checker path does not. This can break authenticated proxy checks after encryption/migration. `getProxyDetail()` also returns the stored representation unchanged.

Acceptance: metadata-only update keeps the password, explicit clear removes it, encrypted and legacy rows authenticate through both browser and proxy_check; inspect other network consumers for the same regression. Requirement: P-FR-08, P-AC-02.

### T12 — P1: preserve batch task inputs and honest child results

> STATUS: DONE — account_id/proxy_id/keep_open reach the child prompt; the collector honors the child's output.status (needs_user→partial, failed→failed).


- [ ] Forward account_id, proxy_id, and keep_open into authoritative task configuration; preserve child failed/needs_user outcomes rather than equating runtime completion with browser success.

`runBrowserTasksTool.ts` `buildTaskPrompt()` includes goal/start_url but ignores all three other fields. No separate context passes them to the runtime. The collector sets completed whenever `runtime.runSync().status` is completed, ignoring `result.output.status`; an agent that successfully returns `{status:'failed'}` or `{status:'needs_user'}` is presented as completed. Output bounds are not enforced by the casts in the collector.

Acceptance: tests assert exact account/proxy/keep-open routing and output.status handling, validate bounded structured output, and externalize large results with ToolResultModule access grants. Requirements: M-FR-02/03/05.

### T13 — P1: connect task control to the actual agent runtime and abort tree

> STATUS: PARTIAL — batch tasks have a live abort tree; Stop on a batch task id and Return-results-now abort children via IPC. AgentRuntime gate integration, root-conversation identity, session cleanup in a collector finally, and queued-lane abort checks remain open.


- [ ] Use one task identity across batch collector, AgentRuntime, jobs, sessions, and controls; connect pause/Stop/return-now to live model and worker cancellation.

The batch control ID is `${batchId}:${index}`, while AgentRuntime creates separate `agt-*` IDs and `agent-v2-*` conversations. `AgentRuntime.ts` contains no AgentTaskControlService gate integration and retains wall-clock `setTimeout(definition.maxRuntimeMs)`. IPC `BROWSER_TASK_STOP` only changes the control record and optionally stops a caller-supplied session. `cancelBatch()` changes map states but does not abort child controllers. Queued lanes start new children without first honoring an already-aborted parent. Sessions are cleaned up by prompt instructions, not a collector finally block.

Acceptance: Stop aborts running children, prevents queued starts, stops owned sessions, and releases leases; return-now produces partial results promptly; a 45-minute handoff does not hit a 10-minute agent timeout. Requirements: M-FR-09, C-FR-05/09/11/16.

### T14 — P1: wire blocking handoff and in-job approval waits

> STATUS: DONE (core) — the runner's handoff stops BLOCK in-job via awaitUserResolution (resolved→fresh observation, expired/cancelled→truthful terminals); user-wait time is excluded from budgets. Approval in-job polling and coordinator gate-resume still open.
- [ ] Connect HandoffCoordinator and approval waits to runner/agent execution, task state, and ToolJobRegistry heartbeat.

`awaitUserResolution()` in `browserAgents/HandoffCoordinator.ts` has no production callers found. Runner policy stops return terminal partial rather than preserving the pending step inside the job. Ordinary browser_request_handoff remains the existing nonblocking path. The coordinator itself swallows requestHandoff failure, interprets any non-handoff state as resolved, and never resumes the control gate after ending the intervention. Credential-card waiting marks ToolJobRegistry but does not integrate the task active clock or cancellation signal.

Acceptance: fake CAPTCHA pauses one child while another finishes; user verify resumes with fresh observation; failure/expiry/cancellation are distinguished; approvals wait inside the runner without duplicate actions. Requirements: D-FR-10a, C-FR-01–03/09, C-AC-01/03/04.

### T15 — P1: bind approvals to complete semantic actions

> STATUS: DONE (core) — select option values and navigation destinations are fingerprinted; context is bounded to navigation/URL. Full form-context extraction (which form the target sits in) remains open.
- [ ] Include distinguishing target/form/context and operation-specific values in approval fingerprints while retaining safe single-use behavior across equivalent observations.

`ManagedBrowserAiToolService.ts` `buildSemanticActionDescriptors()` always sets `context: null` and `optionId: null`; only FILL contributes a value digest. Two same-name/role controls in different forms can collide, as can changed SELECT values or other operation payloads. `consumeApprovalForProgram()` still requires exact pageRevision; add tests clarifying which fresh equivalent observations may reuse an approval and which page changes invalidate it. The helper's comments alone do not prove the PRD contract.

Acceptance: same semantic action with new opaque refs consumes once; changed form/control context, select value, navigation destination, or mutation payload requires a new approval; full-access never bypasses it. Requirements: D-FR-27, D-AC-05.

### T16 — P1: make account selection, saving, and cancellation usable

> STATUS: PARTIAL — username-only accounts get the password-only card; card cancel opens the handoff dialog; Stop while the card is open resolves it via the input signal. Account-picker UI, per-account AI opt-in surface, and picker tests remain open.


- [ ] Add the account picker and missing-password card path; offer per-account AI opt-in; connect card handoff to the existing handoff dialog; make waits abortable.

Multiple accounts return `account_picker_required` without an eligible account list or picker UI. One account without a password returns origin_mismatch instead of asking for its password. `getAccountsForSite()` filters on ai_use_enabled, but the account detail UI does not expose that new control. `saveSubmittedCredential()` sets it false, so saved card credentials cannot be reused automatically through this filter. Card cancellation resolves as handoff_required but the service does not open a handoff for that branch. A pending card can wait 10 minutes after Stop and later continue filling because BrowserSignInInput has no AbortSignal.

Acceptance: zero/one/many accounts, username-only account, save-and-reuse with explicit opt-in, I'll sign in myself, Stop while card open, and late submission tests. Requirements: A-FR-03/05/06/10, C-FR-09, PRD §7.

## Required features still incomplete

### T17 — P1: immutable provider routes, native profiles, and capability negotiation

> STATUS: PARTIAL — the chat client freezes the provider config key at admission and aborts with provider_config_changed on a mid-task change. Native (SystemOne) adapter, capability negotiation, JSON-Schema/tool ladder, and hosted discovery remain open.
- [ ] Implement the route bundle/resolver, selected-profile ownership, configuration revision cancellation, decision/sub-agent model overrides, native adapter, and capability/budget cache.

`executeTask()` chooses hosted/chat once, but its callback creates AiChatApi and calls openAIChatCompletion() on every step; that method resolves current settings again (`aiChatApi.ts:2254`). A mid-task switch can redirect later page content to another provider, including hosted mode. There is no task-bound profile/revision or invalidation subscription. Hosted mode always returns unavailable regardless of actual server capability. HostedDecisionClient exists but is not called; there is no SystemOne/native implementation in the decision directory. Both getCapabilities methods return empty operation lists and are not used by the runner. Custom chat always forces json_object instead of negotiated JSON Schema/tool/strict JSON paths. Bare-action parsing also bypasses the stricter envelope text bounds, and the shared normalizer accepts a claimed native_distribution even from chat output.

Acceptance: mock endpoint ownership tests including mid-call edits, no key crossing or custom-to-hosted fallback, explicit unsupported-old-server behavior, native selected-head semantics, honest uncertainty, bounded total upstream retries. Requirements: D-FR-02–04/17–19, D-AC-01/08/11, design §§5/9/10. Server-side endpoint implementation/qualification needs separately supplied evidence; this audit does not establish external server state.

### T18 — P1: planning, trusted field bindings, recovery, verification, and operations

> STATUS: PARTIAL — NAVIGATE (same-site worker policy) and EXTRACT (refs into task result) execute; one bounded recovery per stop class with the failure reason as subgoal; 5-step chat progress check with no_progress escalation; DONE verifies FRESH state. Planner, trusted field bindings/helper cache, and recall measurement remain open.
- [ ] Add bounded planning, value binding/helper cache, real recovery, deterministic progress/equivalent-failure tracking, NAVIGATE and schema extraction, and fresh independent final verification.

Runner sends subgoal null and recent_actions empty. It directly uses model-generated FILL text; no planner, field helper, full-input cache, or separate counters exist. Three failures end the task instead of invoking recovery; repeated unverified DONE only increments recoveryCalls and repeats inference with unchanged input. NAVIGATE and EXTRACT are explicitly excluded, extracted stays empty, and extract_nonempty cannot succeed. Candidate builder takes the first 16 eligible controls, with no relevance/focus/dialog ranking or coverage recovery. DONE verifies the already-held observation instead of forcing fresh state. No chat progress check or no-progress recovery is implemented.

Acceptance: task-family tests for search/forms/options/navigation/pagination/extraction, ambiguous targets, long multilingual goals, helper reuse, three equivalent failures, no progress, and false DONE. Requirements: D-FR-05/13/14/16/20–25, D-AC-09, design §§8/10/11.

### T19 — P1: durable task cursor and mutation journal

> STATUS: DONE (core) — browser_tasks entity/model/module; admission (route + config key), phase/counters, intent-before-dispatch journal, terminal; startup marks non-terminal tasks interrupted; executeTask refuses to run without a durable cursor. Unique task admission binding and command lease remain open.
- [ ] Add BrowserTask entity/model/module, unique tool-call/task admission, versioned cursor, intent-before-input journal, metadata-only retention, interrupted-on-startup recovery, and final route/cost/time attribution.

Only an in-memory runner and task-control Map exist; no BrowserTask model/module/entity was found. Final results omit most attribution and time fields required by design §6.1. A crash loses pending intent/unknown-effect evidence and paused/waiting metadata. There is no session-long runner command lease preventing old tools from interleaving between decisions.

Acceptance: crash before/after dispatch, persistence failure before/after intent, duplicate admission, concurrent old-tool access, restart while paused/waiting, and no automatic mutation replay tests. Requirements: D-FR-07/08/10, C-FR-14, design §§6.2/12.

### T20 — P1: finish the site registry switch-over

> STATUS: PARTIAL — the pilot allowlist is REPLACED by registry-backed eligibility (start + listEligibleAccounts); getSite/listSites seed before reading. Still open: socialaccountdetail.vue platform consumers, domain-confirmation card flow, seed-failure surfacing.


- [ ] Replace the managed-browser pilot/manifest gate and account-platform consumers with BrowserSite-backed lookups through IPC; complete reviewed domain expansion.

BrowserSite entity/model/module and guarded upsert exist, but `ManagedBrowserModule.ts:481–500` still rejects non-pilot account platforms. `socialaccount/socialaccountdetail.vue:232,409` and `socialAccountModule.ts:15,130` still use SocialPlatformList. Domain proposal/apply methods have no confirmation-card flow or persisted user-confirmation/visited-redirect binding. `getSite()` and `listSites()` do not call ensureSeeded(), so first access through these methods can see an empty registry. Seeding failure is swallowed and its resolved promise prevents retry.

Acceptance: a newly registered generic site can own an account session; legacy IDs remain stable; account page/list filters use registry; domain expansion comes only from actual visited redirects plus explicit confirmation; seed failure is surfaced/retryable. Requirements: S-FR-01–06, S-AC-01/02.

### T21 — P1: finish sign-in lifecycle, recipes, cookies, and safety evidence

- [ ] Implement cookie-first assessment, two-step login, recipe matching/learning/fallback, generic authentication assessment, successful account binding/cookie save, cooldown across applicable paths, and sentinel non-disclosure.

Filler requires username and password together in one form and ignores recipe field names/action; WorkerSession passes only recipe.steps[0]. `BrowserSiteModule.saveLoginRecipe()` has no sign-in caller. The sign-in success branch only marks the site verified/clears failure; it does not bind the account to a public session or invoke cookie persistence for that account. Filled stamps are returned but not registered with observation sanitization for persistent `[credential]` masking (including show-password changes). Generic success detection can confuse intermediate password-free pages with authentication and does not use full challenge assessment. The dedicated credential read skips site-domain enforcement when account.site_id is null; implement migration/domain fallback rather than treating legacy null as permission.

Acceptance: cookie-first, username-first, recipe mismatch, wrong password/cooldown, challenge/2FA, public-to-account bind, reopened-session cookies, same-site frame/decoy/toggle cases, and sentinel through observations/notices/transcripts/logs/results. Requirements: A-FR-02/07–11/13–21, C-FR-13, A-AC-01–05.

### T22 — P1: finish proxy selection, health, geography, and UI

- [ ] Health-check before switching, preserve structured browser network reasons, add consent for account country/direct moves, link successful account proxy, apply locale/timezone/WebRTC policy, and expose safe metadata/badge.

Selector trusts rows rather than running proxy_check; auto uses only linkedProxies and can fall back to another country or a previously failed proxy. Account-free auto has no linked pool to select from. classifyProxyError() is defined but not connected to launch/navigation error handling. ResolvedSessionProxy drops country_code/id; safe status only has proxyActive, insufficient for host/country badge. No proxy confirmation card/apply path exists. Encryption migration is lazy on list reads, leaving untouched legacy rows plaintext; plan an explicit migration with failure evidence. Verify proxy_list's safe response actually contains last health/browser_usable rather than relying on a model DTO.

Acceptance: healthy/unhealthy/407/tunnel/direct/country tests, failed proxies never direct-fallback, account persistence, bundled-Chromium WebRTC and fingerprint checks, and session card tests/translations. Requirements: P-FR-01–09, P-AC-01/02.

### T23 — P1: enforce agent/session ownership and scheduling

- [ ] Store rootConversationId plus agentTaskId on sessions; enforce owners for all browser tools, implement parent read/keep-open takeover, queue same-account tasks, and enforce configurable site/global caps atomically.

Current sessions check conversation ownership only. Lease service has ownerAgentTaskId but start() never supplies it. Children use separate agent conversations; no root-parent mapping for notices/cards or parent takeover is established. An account conflict throws account_in_use instead of queuing. Settings DTO adds maxConcurrentSessions/maxSessionsPerSite but the settings getter never reads/returns them, so the site comparison against undefined is ineffective and configurable limits cannot work. Public sessions starting blank can also avoid initial per-site counting before navigation.

Acceptance: non-owner rejection, parent reads, labelled parent notices, keep-open transfer, same-account queue, simultaneous starts at caps, public navigation site admission, memory failure cleanup. Requirements: D-FR-08, M-FR-06–09, M-AC-02/03.

### T24 — P1: complete resume semantics and control presentation

> STATUS: PARTIAL — PAUSE_REQUEST stops the in-flight program between actions with results preserved; the pause handler drives the real module path; the 60-minute pause cap marks tasks interrupted. Resume-to-agent-transcript delivery, queued handoff UI, and focus-window remain open.
- [ ] Implement worker PAUSE_REQUEST safe points; resume invalidation, allowed-site/account reassessment, transcript note and user instructions; pause cap; queued handoff UI; focus-window worker support; partial return-now; unexpected-page-change pause and window title.

`managed-browser-ipc.ts:185` resumes browser then gate, swallows browser errors, and merely returns instructions to renderer rather than appending them to agent history. Pause state is set even if handoff fails. Session binding is caller-supplied, not resolved from task. Focus returns focus_not_supported_yet. No PAUSE_REQUEST, BrowserTaskBatchCard, or handoff queue implementation was found. There is no 60-minute pause-cap timer. AgentTaskControlService keeps terminal records indefinitely and activeTimeMs continues growing after terminal transitions; finalize accounting and retire records.

Acceptance: all C-ACs with real task IDs, resume after manual navigation/account change, instruction delivery, pause during multi-action program, one dialog at a time, open browser only on user request, bounded record lifetime. Requirements: C-FR-01/04–12/14–16.

### T25 — P1: enforce batch consent, consequential-action restriction, and budgets

> STATUS: PARTIAL — per-feature kill switches (signIn/siteUpsert/proxySwitch/parallelAgents/browserDecision) enforced at tool entry with honest disabled outcomes. Batch-scoped consent lease, authoritative consequential-action policy in the child executor, sub-agent model selection, and rate limiting remain open.
- [ ] Implement task-scoped routine consent, an authoritative sub-agent consequential-action prohibition, pluggable executor, selected sub-agent model, provider rate limiting/backoff, and aggregate token/cost limits.

One generic batch confirmation exists, but no batch-scoped consent lease is passed into children; `allowInteractivePermissionPrompts:false` does not implement that grant. Consequential prohibition is primarily a prompt rule; use execution policy to return a proposal instead. Agent definition excludes resume/evaluate/clear as required but also lacks the proposed async-job tools and browser_execute_task. No batch executor selector/model setting or aggregate accounting/backoff is implemented.

Acceptance: routine child actions work after one scoped batch grant; consequential actions return proposals and never dispatch; 429 respects bounded concurrency; cost/token caps include failed children; fast_runner and llm_agent obey the same ownership/control contract. Requirements: M-FR-01/04/05/10–13, PRD §8.

### T26 — P1: finish settings, cards, translations, and UI tests

> STATUS: PARTIAL — BrowserAccountPickerCard, BrowserSiteConfirmCard, and BrowserTaskBatchCard implemented with 7 component tests; browserSite/picker keys added in all six languages. Settings panel section, per-account AI-use toggle, proxy badge, and account-detail AI opt-in remain open.
- [ ] Add browser decision/provider/native/capability settings and disclosure, sub-agent model/session-cap settings, account picker, site confirmation, batch/control card, account AI-use toggle, proxy label/country/direct state, and complete six-language parity.

BrowserCredentialCard and browserSignIn/browserTasks translation namespaces exist. The required BrowserAccountPickerCard, BrowserSiteConfirmCard, and BrowserTaskBatchCard were not found; AIProviderSettingsPanel has no browserDecision/native/sub-agent settings. New namespace existence is not evidence the missing UI/behavior exists. Explain page-data disclosure and that usernames go to the active provider. Add tests for every changed/new surface and all loading/error/disabled/partial/user-wait states.

Acceptance: all required UI controls are usable end-to-end; English/Chinese/Spanish/French/German/Japanese translations and key parity; full component suite passes. Requirements: PRD §7/12, design §19, D-AC-10.

### T27 — P2: restore Model/Module boundaries and migration evidence

> STATUS: DONE (core) — the five new sign-in queries delegate to SocialAccountModel; module keeps opt-in filtering + FieldCipher. Legacy-fixture upgrade tests remain open.


- [ ] Move new repository queries from SocialAccountModule into SocialAccountModel; verify legacy account/site/opt-in/failure fields and proxy migration with real database fixtures.

`socialAccountModule.ts:367–502` adds direct repository/query-builder access instead of using Model methods. This violates the repository's requested data-access layering even though it runs in main. Site entity registration exists in dbEntities; that alone does not prove upgrades/backfills preserve legacy accounts or encrypted proxies. Add model/module tests under `test/modules/` as specified, including correct USERSDBPATH and worker DB-access rejection.

Acceptance: Model-only data access, main-only secret decryption, idempotent upgrades with legacy SQLite fixtures, no worker DB imports/access. Requirements: design §§13.6/15.1/16.4/20 and repository architecture rules.

### T28 — P1: deliver critical E2E and normal validation gates

> STATUS: PARTIAL — repo typechecks clean (tsc exit 0); Windows path assertion fixed; the three deterministic E2E specs exist (browserSignIn.test.ts, browserParallelTasks.test.ts, browserDecisionTask.test.ts) against a fixture harness; E2E EXECUTION requires the harness endpoints (seed/mode/harness pages) and is an operator/CI gate.


- [ ] Add deterministic browserDecisionTask, browserSignIn, and browserParallelTasks E2E equivalents; fix compile/component blockers; run required checks without skip flags.

Only the existing managedBrowser E2E file was found for this feature area; it does not establish the new decision/sign-in/parallel/control acceptance flows. New focused tests pass only after bypassing the compile gate and include page doubles that reproduce desired behavior rather than executing the production login script. Repair the Windows path assertion using path normalization. Component suite failures observed here involve Node 26 localStorage availability and eight shared suites; investigate environment/baseline separately before attributing them to BDA.

Acceptance: normal testmain and test:components pass; one-shot TypeScript and Vue checks pass; local fake-provider/site/proxy E2E asserts final state and endpoint ownership across hosted/custom/native/approval/cancellation/sign-in/proxy/parallel cases. Safe build/build:e2e pass. Packaged gates remain CI/operator-only.

### T29 — P2: qualify performance, instrumentation, rollout, and rollback

- [ ] Add per-phase timing/usage/attempt/cost accounting and the paired held-out evaluation; implement global/per-engine/workload and signIn/siteUpsert/proxySwitch/parallel feature switches with safe active cancellation.

No qualification dataset/report or browser decision instrumentation pipeline demonstrating the PRD targets was found. Runner counters cover only a subset of required calls, with no provider usage/cost attribution. Proposed feature switches signInEnabled/siteUpsertEnabled/proxySwitchEnabled/parallelAgentsEnabled are absent from production source. No evidence supports claiming 50% latency or 70% expensive-call reductions.

Acceptance: compare baseline, observation optimization, Jev, hosted Laya, custom-chat on 50–100 held-out task families with repeated multilingual trials, independent success, recall, uncertainty, p50/p95, all-attempt cost per verified success, and batch total cost/parent context. Predeclare noninferiority margin/confidence and collect more trials if unresolved. Demonstrate rollback without mutation replay and keep legacy custom-provider browser tools usable. Requirements: PRD §§8–10, design §21.

## Requirement traceability (all functional IDs)

“Foundation” means relevant code exists; it is not a claim of passed end-to-end acceptance. Grouped ranges include every suffix stated below. Open tasks above define the missing work.

| PRD IDs | Assessment and TODOs |
| --- | --- |
| D-FR-01 | Provider-aware BrowserAiAvailabilityService and existing browser gates present; batch admission still needs the same before-parse guarantee and full gate tests (T25/T28). |
| D-FR-02–04 | Partial provider plumbing; no immutable revision/route/native profile (T17). |
| D-FR-05 | Runner goal/criteria accepted; planner/bindings absent (T18). |
| D-FR-06 | Loop foundation exists; protocol/operation blockers (T01/T06/T07). |
| D-FR-07–08 | Partial async/context integration; persistence, lease, ownership/progress gaps (T19/T23/T25). |
| D-FR-09 | Partial counters/stops; deadline and late-response defects (T07–T09). |
| D-FR-10 | No durable interrupted cursor (T19). |
| D-FR-10a | Missing in-job approval/handoff continuation (T14). |
| D-FR-10b | Compact final observation exists; freshness/attribution incomplete (T18/T19). |
| D-FR-10c | New routing rows present in BuiltInToolCapabilitiesPromptSection; advertised capabilities exceed actual runner/sign-in/proxy behavior (T06/T10/T18). |
| D-FR-11 | Post-action observation/cache foundation exists; protocol/challenge/result paths need real validation (T01/T07/T28). |
| D-FR-12–14 | Partial candidates; options, credentials, relevance, budget/recall gaps (T06/T18/T21). |
| D-FR-15 | Existing worker target revalidation foundation; require real detached/covered/changed tests (T28). |
| D-FR-15a | Observation epochs and pin messages present; pending inference/job lifetime proof missing (T19/T28). |
| D-FR-16–17 | Widened contract exists; key/options/navigation/extraction/native gaps (T06/T17/T18). |
| D-FR-18–19 | Chat JSON foundation; negotiation, strict bare output and uncertainty gaps (T17). |
| D-FR-20–25 | Field/planning/recovery/progress/verification incomplete (T18). |
| D-FR-26 | Executor dispatch tracking exists; runner result handling/protocol still incomplete (T01/T07/T08). |
| D-FR-27 | Fingerprint helper and pinning present; context/value binding incomplete (T15). |
| A-FR-01 | Credential-free tool/schema exists; full worker suggestion/login flow evidence missing (T21/T28). |
| A-FR-02 | Live URL refresh and worker domain check present; legacy/null identity and real redirect tests needed (T03/T21). |
| A-FR-03–06 | Partial account/card/secure single-use IPC foundation; picker/opt-in/disclosure/cancel paths missing (T16/T26). |
| A-FR-07–08 | Dedicated credential read/fill request exists; domain, script execution and lifecycle defects (T02/T21). |
| A-FR-09–11 | Partial failure/cooldown; success binding/cookies and generic assessment missing (T14/T21). |
| A-FR-12 | Registration approval missing (T05). |
| A-FR-13–15 | Generic/account session integration, runner sign-in step, and sentinel evidence incomplete (T20/T21/T28). |
| A-FR-16–19 | Safety code exists but script invocation, revalidation and tamper defects block acceptance (T02–T04). |
| A-FR-20–21 | Recipe learning/fallback and two-step flow absent (T21). |
| S-FR-01–03 | Entity/model/module/upsert/seeding foundation present; upgrade/seed first-read tests outstanding (T20/T27). |
| S-FR-04 | Domain methods exist; reviewed visited-domain confirmation flow incomplete (T20/T26). |
| S-FR-05–06 | Pilot replacement and platform consumer migration incomplete (T20). |
| P-FR-01 | Explicit selection foundation; auto/country integration gaps (T22). |
| P-FR-02–06 | Switch/confirmation/health/caps/fingerprint incomplete (T10/T22). |
| P-FR-07–09 | Safe metadata/UI and at-rest/consumer migration incomplete (T11/T22/T26). |
| M-FR-01 | Definition exists; tool set/runtime/control integration incomplete (T13/T25). |
| M-FR-02–05 | Batch/schema/confirmation foundation; input/result/consent/policy defects (T12/T25). |
| M-FR-06–08 | Lease/memory/conversation ownership foundation; settings/queues/root routing incomplete (T23). |
| M-FR-09 | Child failure isolation exists; cancellation/cleanup/partial paths incomplete (T13). |
| M-FR-10–13 | Aggregate rate/cost/model/executor/window qualification incomplete (T25/T29). |
| C-FR-01–03 | Control/coordinator foundations exist but disconnected (T13/T14). |
| C-FR-04–08 | IPC foundation; actual gates/resume semantics and UI missing (T08/T13/T24/T26). |
| C-FR-09 | ToolJobRegistry user-wait foundation; runtime/card/parent wait integration incomplete (T09/T13/T14/T16). |
| C-FR-10–12 | Queue/focus/partial/intervention UI and collection incomplete (T13/T24/T26). |
| C-FR-13–16 | Manual cookie path needs account bind proof; restart/title/unexpected changes/shared runner control incomplete (T19/T21/T24). |

## Acceptance coverage and recommended order

No acceptance ID is certified fully passed by this audit. D-AC-01–12 map to T01/T06–T09/T14/T15/T17–T19/T26/T28/T29; A-AC-01–05 to T02–T05/T16/T21/T28; S-AC-01–02 to T20/T27/T28; P-AC-01–02 to T10/T11/T22/T28; M-AC-01–03 to T12/T13/T23/T25/T28; C-AC-01–04 to T08/T09/T13/T14/T24/T28.

1. Fix protocol/compilation and credential execution/safety (T01–T05).
2. Fix runner boundaries, cancellation, proxy and batch correctness (T06–T16).
3. Complete provider/state/registry/sign-in/ownership/control and UI integrations (T17–T27), with tests/translations in each logical unit.
4. Run normal checks, deterministic E2E, performance/rollback qualification and operator-only packaged gates (T28–T29).

Audit limitations: source review and local tests cannot prove external hosted/native server deployment, actual browser fingerprint/WebRTC compatibility, production account behavior, or performance targets. Those are explicit open evidence tasks, not inferred implementation successes. Production code was not changed or fixed in this documentation task.
