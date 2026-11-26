# Browser decision acceleration — third audit and consolidated TODO

Date: 2026-11-04 (Asia/Shanghai). Worktree: `E:\project\aiFetchly-bda`. Branch: `feature/browser-decision-acceleration`. Audited revision: `03335a3c21524421bfd6720c414b96113f94cf76`. Clean worktree at audit start.

Specifications: [PRD](browser-decision-acceleration-prd.md), [technical design](browser-decision-acceleration-technical-design.md). Previous report: [second audit](browser-decision-acceleration-audit-2026-11-04-todo.md). This new report preserves the previous reports and reassesses the implementation, including the latest pass-3/pass-4 changes.

**Verdict: requirements remain incomplete and blocking bugs still exist.** The latest changes resolve several individual reproductions, but related branches still violate the same invariants. This report groups findings into **24 issue families**, enumerates their similar occurrences together, and defines the tests needed to close each family. It does not claim that static review can prove the absence of every possible bug or establish external provider/deployment behavior.

Priority: P0 = basic execution or mandatory safety invariant is broken; P1 = required correctness/integration blocker; P2 = remaining validation/qualification. All checkboxes below are open. “Reproduced” means an additional deterministic test exercised production code with controlled collaborators; other findings are source evidence. Missing features and missing release evidence are identified separately from reproduced bugs.

## 1. Actual validation and reproduction evidence

| Check | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | PASS, exit 0. |
| Main tests: browserDecision, browserLogin, browserAgents, managedBrowser | PASS: 36 files / 396 tests; mandatory global TypeScript gate ran. No `AIFETCHLY_SKIP_TSC`. Only redundant Vite checker plugin disabled via `AIFETCHLY_SKIP_VITE_CHECKER=1`. |
| Full component config | FAIL, exit 1: 180 files, 172 passed / 8 failed; 1,585 tests, 1,389 passed / 196 failed. Shared Node 26 localStorage/setup failures; not established as 196 BDA regressions. |
| `vue-tsc --noEmit --incremental false` | FAIL, exit 2: `src/views/pages/search/components/EditSearchTaskDialog.vue:17:26`, TS7006 for parameter `v`; outside this feature's implementation changes. |
| Extra family-wide reproductions | 45 cases: **41 failing requirement assertions / 4 passing fixed-case controls**, across two temporary files; TypeScript gate passed. These are separate from the 396 passing committed tests. |
| Six-language key parity | PASS for browserSignIn, browserSite, browserTasks in en/zh/es/fr/de/ja. Does not prove mounted UI, translation quality, or complete settings/disclosure coverage. |
| E2E | Source-inspected; new specs still reference an absent HTTPS fixture/bridge. No passing E2E claim. |
| Build, actual headed Chrome/fingerprint/proxy, hosted/native server, performance qualification | Not run / not established by this audit. |
| Forge package/make | Not run: forbidden locally. Packaged process-tree gates remain operator/CI-only. |

Local evidence: `%TEMP%\bda-r3-typecheck.log`, `bda-r3-main.log`, `bda-r3-vue.log`, `bda-r3-components.log`, `bda-r3-all-reproductions.log`. Reproduction sources retained at `%TEMP%\bda-r3-reproductions.test.ts` and `bda-r3-reproductions-dom.test.ts`; temporary copies were removed from the repository. To repeat them, copy into the corresponding main/browserDecision and main/browserLogin test directories and use the main Vitest config. These artifacts are ephemeral local evidence, not committed failing tests. This task commits documentation only.

The extra checks cover all these similar occurrences:

| Family | Failing cases exercised |
| --- | --- |
| F01 protocol | Main → session worker and main → cache worker both emit version 1 instead of 2. |
| F02 element evaluation | Click, fill, select, hover, clear all fail using installed Puppeteer string-evaluation semantics. |
| F03 lease transfer | At global capacity; same-conversation account held by another session; loss of agent-task ownership. |
| F04 proxy credentials | Explicit proxy_id and auto both return resolved for an undecryptable password. |
| F05 lifecycle | Provider change during request; already-aborted request; late timed-out result; active runtime exhausted during inference; Stop and pause/resume after intent; pause before model; Stop during final verification. |
| F07 persistence/state | Initial observe exception leaves running; dispatch exception marks completed; known no-effect journaled confirmed; cursor hook unused; terminal active clock keeps increasing. |
| F08 references | Entry cap evicts references from both live unpinned and pinned observations. |
| F09 login/secret handling | Earlier decoy textbox, earlier unrelated username-only form, ambiguous forms, newly inserted password recipient, credential leaked via accessible name. |
| F10/F11 handoff/auth | login_required cannot observe origin; runner handoff reason rejected by worker schema; OTP-only page falsely authenticated. |
| F13 approval | Repeat limit, branch condition, and comma-containing SELECT payloads collide. |
| F14 contract | Oversized bare FILL accepted, chat native-confidence assertion accepted, unobserved same-site navigation dispatched. |

Passing controls: pre-request provider revision change is now rejected; FILL_LOGIN_FORM allowed in login_required by the policy helper; fill denied during handoff by that helper; uncontended lease transfer below capacity succeeds. Policy-helper success is not proof that both processes actually occupy the same state or that the worker calls the helper.

For F02, the test emulates the installed library's actual evaluation boundary with a JavaScript VM rather than a substring-based script mock. Source verification: `node_modules/puppeteer-core/lib/puppeteer/api/JSHandle.js` forwards the handle as an argument; `cdp/ExecutionContext.js` sends string sources through Runtime.evaluate, which does not bind those arguments. This is not claimed as a live Chromium run.

## 2. Open issue families — fix all listed variants together

### F01 — P0 — protocol migration updated responses but missed both request clients

> STATUS (pass 4): DONE — both request clients (ManagedBrowserWorkerClient and ManagedBrowserCacheWorkerClient) stamp MANAGED_BROWSER_PROTOCOL_VERSION instead of hardcoded 1. Outbound requests now match the v2 worker schema.

- [ ] Replace both hardcoded version-1 request envelopes with the shared protocol constant and validate actual outbound requests against receiving schemas.

Affected: `src/service/ManagedBrowserWorkerClient.ts:214`, `src/service/ManagedBrowserCacheWorkerClient.ts:322`. Both assemble `protocolVersion: 1` and cast through unknown. `src/config/managedBrowser.ts:19` is version 2; both managedBrowser and managedBrowserCache inbound schemas require 2. Worker ready/replies now use 2, but main requests still use 1. Actual requests therefore time out or accumulate worker protocol violations; this blocks real session start/actions and cache maintenance despite green unit tests.

Reproduced by invoking the real client request methods with captured postMessage payloads: both emitted 1. The previous T01 fix/report established compilation/worker response improvements, not complete bidirectional protocol compatibility.

Closure matrix: session ready/start/observe/actions/login/pin/pause/resume/stop; cache ready/scan/delete/evict/cancel/shutdown; malformed and mixed-version rejection; no false timeout/restart loops. Test client-produced messages with the actual worker parser instead of fake workers that accept any message. Requirements: D-FR-06/11/26, design §§7/20; previous R26/T01 claims need this qualification.

### F02 — P0 — the page-function argument bug persists throughout the ordinary executor

> STATUS (pass 4): DONE — all element-bound scripts in BrowserActionExecutor converted to real functions: readElementDescriptor (live revalidation), probeInputElementTypeFn (sensitive-field detection), clearElementValueFn (fill clearing), clearElementWithEventFn (CLEAR), extractElementDataFn (EXTRACT). Mock updated to identify by function name (stable across transpilation).

- [ ] Convert every element-bound script/probe into a real callable function with arguments; test the execution boundary with real Puppeteer or an exact semantic harness.

All related occurrences in `src/childprocess/managed-browser/BrowserActionExecutor.ts`:

1. withElement uses READ_ELEMENT_DESCRIPTOR_SCRIPT from BrowserObservationService, an IIFE ending `})()` with no `el` argument. With an element.evaluate string, `el` is undefined; the error is caught as null and click/fill/select/hover/clear are refused as stale.
2. probeInputType likewise calls an IIFE with no element; the catch returns null, creating a sensitive-field safety gap if descriptor handling alone is fixed.
3. FILL clearing and CLEAR use uninvoked string function expressions; they do not clear/dispatch the intended event with real library semantics.
4. doExtract uses an uninvoked element function string; it does not extract the element data.

The privileged LoginFormFiller function fix did not repair these sibling paths. Parameterized reproduction confirms all five targeted operations fail at live-descriptor validation. Page-level scripts already expressed as invoked, self-contained expressions must be distinguished from scripts that require handle arguments.

Closure matrix: nonempty FILL replaces rather than appends; CLEAR emits expected events; password/OTP/card/passkey probes refuse safely; live role/name matches and mismatches; detached/covered target; CLICK/HOVER/SELECT success; EXTRACT actual value. Never make a failed safety probe default to an ordinary textbox. Requirements: D-FR-15/16/26, A-FR-14, D-AC-04/06.

### F03 — P1 — lease transfer handles only some discriminated outcomes

- [ ] Implement an atomic transfer operation with rollback, checking every lease result and retaining root/task ownership.

`ManagedBrowserModule.bindAccountToSession():1654` acquires the account lease before releasing the public lease. At the global session cap, acquire returns global_limit_reached. That result is ignored, the public lease is released, and the record is marked authenticated/account-backed without an account lease. If another session in the same conversation already owns the account, acquire returns already_active for that other session; bind nevertheless changes the current record instead of rejecting/queuing. OwnerAgentTaskId is omitted during a successful transfer. The result is two apparent controllers or an unleased browser, not account exclusivity.

All three variants reproduced. The uncontended below-capacity path does work. Also validate release failure, different-owner conflict, same-session idempotency, cancellation during bind, and any attempted rebind of an account-backed session. Do not suppress bind failure and return signed_in (BrowserCredentialLoginService currently does).

Closure matrix: transfer at limits 1/3/5; no transient extra session counted; same/different conversation AND same/different task/session; correct token/key release; account queue; unchanged state on refusal; cleanup. Requirements: M-FR-06/07, A-FR-11, D-FR-08; previous R08/R09/R21.

### F04 — P0 — undecryptable selected proxies can fall back to direct

> STATUS (pass 4): DONE — both explicit proxy_id and auto branches check the resolved proxy for unresolvable mode and return failure status; undecryptable passwords can never become direct.

- [ ] Preserve failure through selector, session start, and switching: a proxy with unusable credentials must never become a direct connection.

`BrowserProxySelectionService.toResolvedProxy()` returns `{mode:'unresolvable'}` when decryption fails, but explicit and auto branches wrap that in `{status:'resolved', proxy}`. `ManagedBrowserModule.start()` assigns it as explicitProxy, then builds sessionProxy with an HTTP/HTTPS-or-direct ternary. Unresolvable takes the direct branch. The earlier account.proxy check does not protect an invalid explicitProxy, and public explicit/auto sessions have no linked-account guard.

Both explicit/auto selector paths reproduced as resolved instead of unresolvable. The later conversion to direct is verified in source at ManagedBrowserModule's effectiveProxy/sessionProxy construction. This can expose traffic outside the requested proxy.

Closure matrix: direct only when explicitly permitted; explicit/auto/account-default; decrypt failure, missing row, invalid protocol/host/port, failed basic check, 407/tunnel/connect, relaunch failure. Reject before cookies/session/network work and retain structured cause; never default unknown proxy variants to direct. Requirements: P-FR-01/03/04/08, P-AC-01/02.

### F05 — P0 — lifecycle validity is checked at one await boundary but not the next

- [ ] Centralize abort/provider/generation/deadline checks before and after every awaited stage and immediately before input/terminal success.

Similar confirmed variants:

1. DecisionClients checks config before completion, not after an in-flight response; changed-provider output is accepted. It also checks before a one-second retry delay but not again immediately after that delay. Production completion still resolves current settings dynamically instead of using an immutable route object.
2. An already-aborted signal still invokes complete(). A client that returns after its request AbortController deadline can yield an executable action because the runner checks only the outer task signal.
3. Active runtime is checked before inference, not after; an over-budget result still acts.
4. The new resume generation check covers pause/resume during decide, but not takeover before model admission or during persistActionIntent. Stop during that journal await also does not prevent dispatch.
5. Stop during the fresh DONE observation is overwritten by completed when the observation resolves. Similar finalization work must recheck cancellation too.

These branches were individually reproduced. Current request timers are abort signals, not guarantees that late responses will be discarded. Worker leaf timeout now correctly reports unknown, an important resolved case; retain it while fixing request/recovery/verification sibling stages. Per-step requested budget and remaining task time are still not consistently used by the production seam.

Closure matrix: every stage × pre-abort/in-flight abort/pause/resume/provider change/deadline; reject stale generation and revision; abort backoff; observe after takeover; preserve budgets; no dispatch after invalidation; no success after Stop. Requirements: D-FR-02/09/26, C-FR-05–08/16, D-AC-01/06/07.

### F06 — P1 — handoff, approval, clocks and parent polling still do not form one lifecycle

- [ ] Implement a shared in-job wait state with schema-valid reason, correct task/job identity, active-clock freeze, heartbeat, user-only resolution, and truthful expiry/cancellation.

All related paths remain incomplete:

- Runner passes `challenge_handoff`, which is not in handoffReasonSchema; coordinator casts it with `as never`. A real BEGIN_HANDOFF is rejected (reproduced reason validation).
- HandoffCoordinator swallows requestHandoff failure, treats any non-handoff/non-user_login_in_progress state as resolved, and never reopens its waiting task gate in finally. After a genuine user resolution the runner can remain stuck at waitUntilOpen.
- Coordinator does not set ToolJobRegistry user-wait state; the parent poll's exclusion only works when its own job producer publishes waiting. The username-only credential card branch also misses this producer, unlike the no-account card branch.
- Approval_required is still a terminal partial runner result rather than an in-job wait preserving the pending step. The normal browser_request_handoff agent tool still immediately returns session status instead of blocking.
- AgentRuntime retains its wall-clock ten-minute timer and no control gates. The pause-cap method is not scheduled/called, and explicit pause does not open the intervention record it requires.

Closure matrix: approval approve/deny/expiry, login/CAPTCHA/OTP handoff, failed handoff request, 45-minute wait, pause cap, session stop/crash/expiry, cancelled parent, dialog resolution, other task completion; no hung gate or false resolved/failed success. Requirements: D-FR-10a, C-FR-01–03/09/10/12/16, C-AC-01/03/04.

### F07 — P1 — truthful persistence, effect accounting and terminal state remain inconsistent

- [ ] Require durable intent before mutation, persist all phases/counters/effects, and finalize every return/exception/cancel path consistently.

The single task ID correction is real and retained. Remaining siblings:

- persistCursor is supplied but never invoked. Intent/outcome persistence errors are swallowed in the production seam before execution.
- Known failed/no-effect steps and policy stops are journaled confirmed before processExecution; reproduced known stale failure produced confirmed.
- Initial observe is outside try/finally, so an exception leaves running; an execution exception reaches finally and marks completed. Both reproduced. Stop/abort/provider errors also need distinct terminal mapping.
- AgentTaskControlService.activeTimeMs keeps growing after completion (reproduced); setState allows inappropriate terminal overwrites. Maps/generation state and abort-rejected waiters need bounded retirement.
- BrowserTask lacks tool-call uniqueness/idempotent admission, unique task ID constraint/optimistic cursor update, full wait/accounting/verification metadata. recordCursor resets unspecified counters to zero.
- Worker challenge detection can return before emitting action outcome; ACTION_RESULT does not carry stopCode/extracted/per-step effect detail. Do not lose a dispatched action's evidence because a challenge appeared afterwards.
- Startup interruption is best-effort per IPC-handler registration rather than an explicitly completed one-time startup barrier.

Closure matrix: before/after-dispatch storage failure, known-no-effect/confirmed/unknown, challenge after action, worker exit, all terminal statuses/exceptions, restart while waiting, duplicate tool call, concurrent cursor update, accurate frozen active/wait times. Requirements: D-FR-07–11/26, C-FR-08/12/14, design §§6.2/12.

### F08 — P1 — reference retention and candidate coverage still break at shared limits

- [ ] Preserve whole live observations, including pinned ones, under entry/epoch pressure; make admission fail safely rather than evict pending refs silently.

PageReferenceRegistry.register() evicts the oldest individual entry once maxEntries=200, ignoring its observation's pinned/pending status. Two 120-element observations evict 40 references from the first observation even if pinned for approval. Both pinned/unpinned variants reproduced. Bucket refs are not removed by voidEntry; hard epoch bounds only drop unpinned committed buckets, so pinned epoch bookkeeping also needs bounded admission. Runner decisions are not explicitly pinned for their full pending lifetime.

BrowserObservationService slices the raw first 240 controls before visibility filtering, so many hidden controls can hide every relevant visible target. CandidateBuilder then takes the first 16 eligible controls with no focus/dialog/task relevance or coverage recovery. Duplicate e_nohandle refs can be offered as candidates without usable handles. These are related capacity/provenance failures, not solved by simply increasing a constant.

Closure matrix: two full observations, many pinned approvals/handoffs, exact entry/epoch/TTL boundaries, hidden controls preceding target, multiple dialogs/suggestions, target beyond shortlist, missing handles, reobserve during inference. Preserve whole snapshot identity and measure shortlist recall. Requirements: D-FR-12–15a, D-AC-04, design §§7.2/8.

### F09 — P0 — login recipient selection and secret masking miss related DOM changes

> STATUS (pass 4): CORE DONE — autocomplete=username/email preference; identity-aware tamper detection (element Set, not array indices — newly inserted inputs caught); credential fields redact accessible name in observations. Decoy form rejection and keystroke fallback remain.

- [ ] Apply recipient safety and secret redaction to every field-selection, mutation and output surface, not only the original password valueSummary.

Actual production page-function reproductions show:

1. A decoy textbox before autocomplete=username in the same form receives the username; autocomplete preference is not implemented.
2. On username-only pages, the first unrelated search form is filled/submitted before the real login form.
3. Multiple eligible login forms are silently reduced to the first instead of recipe/disambiguation.
4. A password event handler appending a new input containing the password is missed: before/after arrays are compared only over old input indices, so the new recipient remains populated and submission proceeds. Replacement/reordering/removal also require identity-aware checks, rather than array positions.
5. shapeElementRecord redacts a credential valueSummary but retains its name; collector's accessible-name fallback uses getAttribute('value'). A sentinel used as a password/credential accessible name survives JSON output (reproduced). Known secret values must not escape through labels/title/body/error/URL/extraction/log paths either.

Recipe forwarding is now fixed. Learned recipes still prefer data-mb-obs ordinal stamps, while matching checks name/id/autocomplete; ordinal stamps are not stable recipe identities. Two-step waits are fixed 2.5-second sleeps and can resubmit the same username page rather than confirming transition. Same-site-frame detection, bounded ambiguity resolution and keystroke/focus fallback remain absent. Safety refusals return unknown/failed in some branches instead of guaranteed handoff.

Closure matrix: decoy before real field/form, autocomplete/current/new-password, zero/one/many forms/passwords, show-password toggle, inserted/replaced/reordered/removed inputs, readback mismatch, frame origin, reused/invalid recipe, slow username→password transition; sentinel across ALL output channels. Requirements: A-FR-08/15–21, A-AC-01/03/04, D-FR-12.

### F10 — P1 — login_required semantics differ across main, worker, observation and resume

> STATUS (pass 4): CORE DONE — WorkerSession sets login_required (non-user-control) on LOGIN_REQUIRED; runtime ACTION_STATES includes login_required so OBSERVE/RUN_ACTIONS/FILL_LOGIN_FORM are allowed; VERIFY_MANUAL_LOGIN and RESUME_HANDOFF accept it. Worker fillLoginForm does not call the runtime guard (main-process guard is the enforcement boundary).

- [ ] Define and enforce one shared state/command matrix in both processes and cover full startup→login→handoff→resume journeys.

Main now stores LOGIN_REQUIRED as login_required, but WorkerSession.startSession still transitions login_required → user_login_in_progress before emitting it. The policy helper allows FILL_LOGIN_FORM in login_required and rejects user_login_in_progress, yet WorkerSession.fillLoginForm does not invoke that guard at all. Main fill now has a guard, but that is not a worker-enforced takeover boundary, nor does it abort in-flight login loops.

OBSERVE_STATES excludes login_required (reproduced), while BrowserCredentialLoginService requires observe to establish live HTTPS origin. At startup record.currentOrigin is null and LOGIN_REQUIRED carries no URL; observe refusal is swallowed, so first sign-in can fail insecure_page. Main policy now permits RESUME_HANDOFF in login_required, but WorkerSession.resumeFromHandoff rejects anything except handoff; verify branches require consistent treatment too.

Closure matrix: every relevant command against ready/running/login_required/user_login_in_progress/verifying_manual_login/handoff/challenge/stopped, with both actual worker and main state assertions. New login origin must be observed successfully; AI login must work without allowing manual takeover input. Requirements: A-FR-02/09/13, C-FR-01/05/07, D-FR-15.

### F11 — P1 — generic authentication, registry eligibility and cookie lifecycle remain disconnected

- [ ] Resolve generic sessions/cookie policy from BrowserSite end to end, require meaningful authentication evidence, and preserve account identity when binding.

GenericSignInAdapter exists, but ManagedBrowserModule.start still rejects missing hardcoded getPlatformManifest before checking BrowserSite. New high-ID sites cannot start account sessions. Cookie refresh also uses the static manifest. Generic assessment only checks no password/no login-looking path/no generic error; an OTP-only `/verify` page was reported authenticated by the actual adapter script (reproduced). It does not incorporate the challenge probe into that decision.

Successful fill does not capture/send refreshed cookies. Public→account bind still leaves worker platformDefinition platformId=0, so captureAndSendRefreshedCookies returns immediately; main platformId/labels/domain/allowed-site metadata also remain public. Binding an already account-backed record returns without a fresh cookie capture. Cookie-first sign-in is not attempted by BrowserCredentialLoginService. A signed_in result can therefore lack the promised persistent account session.

Closure matrix: new registered site, seeded sites/YouTube, login/OTP/CAPTCHA/password-free landing page, authenticated identity check, public→account transfer, current account success, cookies after manual/automated login, reopen/restart/proxy switch, no cross-site cookie release. Requirements: S-FR-05/06, A-FR-03/09/11/13, C-FR-13.

### F12 — P1 — account credential flows still have race, identity and opt-in gaps

> STATUS (pass 4): PARTIAL — updatePasswordForAccount delegates to Model layer; legacy domain check resolves through social_type_id; ai_use_enabled set on save. Concurrent attempt reservation, identity mix on username edit, per-account opt-in UI, and Model-layer cooldown writes remain.

- [ ] Atomically reserve login attempts, preserve account/username identity, expose per-account AI-use control, and make all card waits/cancellations abortable and correctly published.

Existing-account password update and legacy site-domain checks are improved. Similar remaining issues:

- inFlightAccounts.has() occurs before awaited isSignInCoolingDown(), then add(); two callers can both pass before either reserves the account.
- Cooldown records failures, not every automated attempt; new-account/one-time card paths bypass the chosen-account reservation. Define and enforce the PRD's account+site attempt window across paths.
- The password-only card still permits changing username, but updatePasswordForAccount updates only password; fill uses submitted.username while bind/failure recording use chosen.id. This can mix account identity.
- A null credential means multiple possible causes (missing password, domain refusal, decrypt failure), but every cause becomes a password card. Preserve distinct reasons.
- Already-aborted signals and post-consume aborts are not checked before fill; username-only card wait lacks job waiting producer. Cancel/Stop can open a handoff when the task should terminate.
- The account detail page still lacks per-account AI opt-in editing. Save now sets ai_use_enabled=true, but existing disabled accounts cannot be managed through that new UI control.
- Registration is safely forced to manual handoff, but the normative explicit approval/Create account workflow remains absent unless the product requirement is explicitly revised.

New updatePasswordForAccount reintroduces direct repository access in the Module rather than Model, violating the repository layering rule. Move that write alongside the existing Model methods.

Closure matrix: existing/new/legacy/username-only/one-time accounts; same-account concurrent calls; fresh/future/expired cooldown; password decrypt/domain refusal; username edit; opt-in true/false; Stop before/during/after card submit; manual handoff; encrypted update with no duplicate row. Requirements: A-FR-03–12, PRD §7, repository Model/Module rules.

### F13 — P1 — approval fingerprints bind leaf lists but omit other action semantics

- [ ] Hash canonical whole-program semantics and distinguishing live target context, while retaining permitted same-action reobservation and single-use behavior.

Else-branch inclusion, navigation URL and SELECT payload inclusion are improved. Remaining reproduced collisions: repeat maxIterations=1 vs 5, changed if condition, and SELECT values `['a,b','c']` vs `['a','b,c']` (join(',')). Repeat condition/depth/nesting and branch structure are flattened away; a flat action can collide with repeated/conditional execution. CLICK/FILL targets with identical role/name still lack form/section/context despite comments claiming form action is carried. Approval matching still compares exact pageRevision and needs a real approve/reobserve proof.

Closure matrix: all leaf payloads, then/else/repeat combinations, iteration/condition/branch changes, canonical arrays, same-label controls in different forms, changed observation refs with equivalent semantics, changed page/action, expiry/deny/reuse/full-access. Requirements: D-FR-27, D-AC-05.

### F14 — P1 — decision contract, options, provenance and extraction are incomplete

- [ ] Validate every operation through one strict contract, preserve outputs through the full worker→main→runner chain, and offer only actually supported affordances.

SELECT options are still not collected or populated in candidate.option_ids; valid SELECT is rejected unknown_option. Even after adding IDs, SELECT execution needs an explicit ID→observed value map. EXTRACT validation now rejects invented refs, but no declared schema/extraction affordance exists and extracted output is omitted from ACTION_RESULT schema/WorkerSession send/runAuthorizedForRunner/executeTask mapping. extract_nonempty cannot succeed through the production chain.

NAVIGATE now rejects different registrable domains but accepts fabricated same-site URLs not in an observed link or plan (reproduced); same-site alone is not provenance. Untargeted operations bypass the shared unexpected-field validation. normalizeWireResult accepts oversized bare FILL text through fallback parsing (reproduced) and preserves claimed native_distribution from chat responses (reproduced). getCapabilities returns empty operation lists and the runner never consults them. Completion criteria are not sent to the decision client.

Closure matrix: each of 14 operations × valid/invalid/unoffered/payload mismatch; envelope and bare output with identical bounds; option membership; observed/plan URL; extraction schema/output; honest chat uncertainty; negotiated provider formatting with bounded attempts. Requirements: D-FR-12/16–19/24, D-AC-04/08/09/11.

### F15 — P1 — recovery, planning, progress and budgets are not one bounded state machine

- [ ] Add the specified plan/value binding/helper/verifier paths and make recovery/progress use fresh state with the same gates/deadlines/accounting.

Recovery subgoal is now included in chat requests. Recovery still receives the old decisionInput and can produce refs that are consumed against a later fresh observation. recoverOnce calls decide with the outer signal directly, bypassing the normal request deadline; budgets/generation validity must cover recovery too. Pending recovery proposals need observation and control-generation identity from their creation. DONE failure increments recoveryCalls without actual recovery. Equivalent failures omit distinguishing context, and untargeted failure branches do not take the targeted bounded-recovery path.

Progress compares URL + first 200 visible-text characters; it misses successful field/checked state and criterion changes, skips untargeted actions, and only starts comparing after its first sampling interval. There is no bounded planner/distinct planning failure, trusted field binding, separately budgeted field helper/cache, runner sign-in step or optional independently budgeted provider verifier. Generated FILL text is used directly. Value/cache reuse must be keyed to full helper inputs and proven no-effect status.

Closure matrix: every action class; stale/no-progress/equivalent failures; long/multilingual goals; changed target/provider/control state; helper reuse/invalidation; planning failure; exact call/time/token boundaries without budget reset. Requirements: D-FR-05/20–25, A-FR-14, PRD §8, design §§8.3/11/12.

### F16 — P1 — browser agents lack authoritative ownership, scoped consent and runtime controls

- [ ] Thread rootConversationId and unique agentTaskId through runtime/tool/job/session state, enforce them, grant routine batch consent explicitly, and block consequential actions by policy rather than prompt.

AgentRuntime creates separate agt-* and agent-v2-* IDs; batch controls use batch:index. Runtime still has no AgentTaskControlService gates/active-time deadline. Session start forwards context.ownerAgentId as agentTaskId, but a definition ID is not a unique task run and the query-loop invocation does not establish the required root/task context. Session checks and lease reuse compare conversation only. Parent read/keep-open takeover, same-account queuing and root-labelled notices/dialogs are absent. No session-long runner ownership lease prevents legacy tools/another runner from interleaving between decisions.

Batch generic confirmation is not a scoped routine-action permission lease; children use allowInteractivePermissionPrompts=false, so missing grants become denied instead of the intended one-confirmation automation. The no-consequential-actions rule is a prompt, not an enforced child policy. Allowed tools omit browser_execute_task and the planned async-job tools. Provider concurrency, batch total token/cost caps, separately selected same-provider sub-agent model and fast_runner executor choice are not implemented.

Closure matrix: parent/sibling/foreign task read/write, keep-open transfer, duplicate account queue, persistent/session/batch permissions, consequential proposals, simultaneous starts at global/per-site/memory limits, blank public session navigating into a capped site, 429 and aggregate budget, all cleanup paths. Requirements: D-FR-08, M-FR-01–13, C-FR-04–09, design §17.

### F17 — P1 — batch Stop, return-now and result collection disagree

- [ ] Separate child Stop, whole-batch Stop and return partial results; authoritatively stop sessions and preserve bounded partial evidence on every terminal path.

Already-aborted queued starts and liveBatches/listener retirement are now fixed. Remaining siblings: BROWSER_TASK_STOP still calls abortBatch for any batch child, cancelling siblings. Return-now returns cancelled rather than partial evidence. On normal collection, all non-completed states become failed control records, including cancellation. Catch uses only parent signal, not child/batch abort, to classify exceptions. Sessions are stopped by agent prompt instructions, not collector finally, so crash/cancel can leak them. One collector cannot reliably clean sessions without the ownership mapping in F16.

Output arrays have no effective maxItems/bytes bounds; casting optional fields is not runtime output validation. An unrecognized/missing child output.status can fall through to completed. Externalized child output must be decoded/granted to parent, not treated as an ordinary inline object. Per-task progress/results are not streamed to a real batch card.

Closure matrix: cancel before/during/after each lane; one task Stop with siblings continuing; return-now after one success; crash; externalized/oversized/malformed output; keep_open transfer; parent deletion/app quit; zero open sessions/leases afterwards. Requirements: M-FR-02/03/05/09/11, C-FR-04/10–12.

### F18 — P1 — proxy restart and metadata flows lose user/session state

- [ ] Preserve full URL, cookies, task ownership and per-task switch lineage; prevalidate target/consent before stopping; keep geography/browser settings consistent.

checkProxyHealthy now supplies concurrency/timeout correctly. Still unresolved: lastUrl is currentOrigin, losing path/query; public cookies are not transferred; account binding/cookie problems in F03/F11 carry into relaunch; the conversation:account:platform counter combines unrelated sessions/tasks, never expires per task and consumes failed checks. Only explicit proxy IDs get the new health check; selection/confirmation can still fail inside start after Stop. In-flight commands are not drained under a switch lease. New session ID/revision/fresh observation is not fully re-bound to active runner/task context.

Auto searches only linked proxies, may ignore country or pick failed entries; explicit/account default/direct transitions need consistent country/consent and account proxy persistence. Resolved proxy drops country/id metadata; launch does not derive locale/timezone from country. Safe session status has proxyActive only, not host/country/direct badge metadata. classifyProxyError is not wired to browser network errors. Proxy-list safe mapper/type omit browser_usable even though the model DTO adds it; verify last real check state rather than constant/default status. Untouched legacy passwords remain plaintext with lazy migration.

Closure matrix: start and switch explicit/auto/direct; same/different country/account; healthy/dead/407/tunnel/decrypt failure; full URL/query/cookies; concurrent program; repeated/failed switch limits; public and bound-account lineage; locale/timezone/WebRTC/fingerprint and UI metadata. Requirements: P-FR-01–09, P-AC-01/02.

### F19 — P1 — site registry is not the authoritative source for all consumers/domain changes

- [ ] Replace remaining static platform lookups, finish trusted redirect-domain proposal/confirmation, and verify seeding/ID/upgrade/concurrency behavior.

SocialAccountModule platform labels, socialaccount-controller and socialaccountdetail.vue still use SocialPlatformList; ManagedBrowserModule/cookie policy still use static manifest. New high-ID sites therefore do not complete the promised account journey. BrowserSite upsert derives own domain safely, but proposeAdditionalDomains accepts supplied visitedDomains without an authoritative session redirect ledger, and applyAdditionalDomains has no confirmed proposal token/visited-domain binding. No app IPC/card consumer is wired. Do not expose those helpers directly without the trusted provenance/confirmation state machine.

Seed failure is caught inside a memoized promise; a transient failure can leave the process permanently unseeded without a retry. High-ID allocation and domain deduplication need concurrent upsert transaction/unique-conflict tests. New Model/entity registration is not upgrade/backfill evidence. Existing database path/worker-access and Model-only data access rules still apply (see F12's reintroduced direct write).

Closure matrix: fresh/legacy SQLite, preserved builtin IDs, concurrent create/dedupe/high-ID allocation, seed failure/retry, unknown site→account detail/filter→session, observed SSO domain plus user confirmation, prompt-injected unvisited domain denial. Requirements: S-FR-01–06, S-AC-01/02, design §§13.6/15.

### F20 — P1 — feature switches/admission are implemented only on selected paths

- [ ] Apply provider-aware before-parse/before-work admission to batch and all browser tools, enforce every feature switch and safe active-disable behavior.

New rows for caps and the five switches are now seeded; the earlier setting_row_missing source gap is fixed. parallelAgentsEnabled still is not checked by run_browser_tasks/runBrowserTasks, which parse and start agents without the browser provider-aware admission gate. Other switches are checked only when entering their tool, not when active work is pending/dispatching. Managed-browser disable/settings changes do not establish the required safe cancellation/rebind of live tasks. Feature UI default-on is not proof of effective write/read/upgrade behavior.

Closure matrix: each feature × hosted entitlement/custom enabled/custom invalid/AI disabled/browser disabled/feature disabled; before parsing/network/credentials/session/agent admission; mid-inference/mid-wait/mid-program disabling; acceleration off leaves existing custom-provider browser tools usable. Requirements: D-FR-01, D-AC-02/12, PRD §10, design §§5/21.

### F21 — P1 — cards/control UI exist in isolation but are not usable in chat

- [ ] Mount BrowserAccountPickerCard, BrowserSiteConfirmCard and BrowserTaskBatchCard in the parent chat and connect their events, live data, IPC and lifecycles.

No production component imports/mounts these three cards. Multiple-account login returns account_picker_required without a selection request/list flow. Domain confirmation is disconnected. Batch IDs/results become available only after execution, not as a connected live control card. The batch card lacks Take control, Resume with instructions, Open browser, waiting reason/countdown, resuming/partial states and a one-dialog queue. Existing emits have no app listeners.

Root parent labels/cards/notices, keep-open takeover and ownership mapping are incomplete. Resume IPC swallows browser errors, then opens the task gate and simply returns instructions to renderer rather than writing the transcript. Pause can set task paused even if browser takeover failed. sessionId is caller-supplied/optional instead of resolved from the task. Focus returns focus_not_supported_yet; window title/offset/automatic unexpected-change pause are not implemented/qualified. Account opt-in control and proxy host/country/direct presentation remain absent.

Closure matrix: zero/one/many account cards, domain approve/deny, running/waiting/paused/resuming/partial/stopped/failed/completed rows, all buttons and invalid states, live job/parent routing, one queued dialog, instructions actually consumed, task/session binding and user-only focus. Every changed UI needs tests and six-language text. Requirements: PRD §7, A-FR-03–05, S-FR-04, M-FR-08, C-FR-04/07/10–12/15/16, design §19.

### F22 — P1 — required hosted/native/provider configuration and model budgets are absent

- [ ] Deliver the selected-provider route bundle, hosted/native adapters/capabilities, model overrides, context packing and provider UX with clear data disclosure.

Hosted executeTask still always returns hosted_decision_unavailable, independent of actual endpoint support. HostedDecisionClient is unused; native/SystemOne adapter and explicit native profile/test/credential/model/limits are absent. AIProviderSettingsPanel has no decision/sub-agent/native capability UI. Capability methods return empty operations and are unused. Chat always forces json_object without verified schema/tool/strict JSON fallback. Model-specific token packing/overhead/options/multilingual estimation is absent. Ordinary browsing must not expose technical configuration internals, but advanced configuration and unavailable-route reasons must be usable.

Usage is stored as uncertainty.calibration_version='tokens:N' and discarded by runner accounting; that is not calibrated uncertainty, total usage, attempt cost, or per-provider concurrency. See F14's chat confidence acceptance and F16's missing batch model/budget controls.

Closure matrix: hosted old/new endpoint, unsubscribed valid custom, invalid custom, acceleration off, chat JSON schema/tool/plain JSON, explicit native vs inactive profile, same-endpoint real model overrides/alias resolution, budget exact boundaries and configuration changes, key isolation, page-data and username disclosure. Requirements: D-01–08, D-FR-02–04/17–19, D-AC-01/02/08/11/12, M-FR-10/12, PRD §§7/12.

### F23 — P1 — integration tests do not validate the real boundaries, and local release gates are not all green

- [ ] Supply a self-contained deterministic E2E harness and replace behavior-reimplementing mocks at protocol/evaluation/lifecycle seams; fix existing full-suite environment/Vue blockers.

The three new E2E specs still rely on localhost:8443, seed/mode/submit endpoints, parallel-harness and optional __e2eExecuteTask/__e2eSignIn hooks that exist only in the specs. playwright.config starts renderer 5173 only. Missing HTTPS certificates/domain mapping, example.test-vs-localhost identity, optional missing hooks, a non-invoked `.click` expression, and expected reason wrapping must all be fixed. These are implementation gaps, not merely operator execution gates.

Committed tests pass while fake workers ignore emitted protocol and element mocks interpret script substrings instead of the installed library contract. The update modified production paths but added almost no family-specific regression coverage. Extend real Model/Module/SQLite and provider/permission/query-loop tests as required by each family.

The 196 component failures are eight shared suites with localStorage unavailable; one Vue implicit-any error is in EditSearchTaskDialog. Resolve/attribute these separately, rather than claiming 196 new BDA bugs or a green full gate. Safe build/build:e2e and actual critical E2E still need evidence. No local Forge package/make.

Closure matrix: real client→parser, actual page function/handle evaluation, fake provider endpoint ownership and traffic, final DOM state, sentinel traces, parallel crash/handoff/45-minute wait/Stop, full test:components and one-shot TS/Vue checks. Requirements: D-AC-10 and all A/S/P/M/C acceptance cases, design §20.

### F24 — P2 — performance, accounting, upgrade and rollout qualification remain incomplete

- [ ] Instrument all stages and upstream attempts, preserve bounded metadata/accounting, run the paired held-out evaluation and demonstrate rollback/upgrade/compatibility.

No evidence establishes the proposed 50% median task-time / 70% expensive-call targets without unacceptable success regression. Runner returns a few counters, not complete planner/helper/recovery/verifier attempts, active/user-wait time, route/model/token/cost certainty. Batch totals/parent-context size, failure costs and 429 behavior are not qualified. Global/per-engine/per-workload switches and active disabling/rollback are not complete. Background-throttling flags were added but fingerprint/WebRTC/window behavior against the bundled Chromium is unproven.

Closure matrix: baseline vs observation optimization vs Jev vs hosted Laya vs custom chat; 50–100 held-out task families with repeated multilingual trials, independent outcomes, shortlist recall, calibrated coverage, sample sizes/uncertainty, p50/p95, all-attempt cost per verified success, batch totals and parent context, declared success-rate margin/confidence method, upgraded DB/settings and backward compatibility. Local fake-provider qualification can run locally; external provider/deployment and packaged process-tree evidence are separate explicit gates. Requirements: PRD §§8–10, design §§20/21.

## 3. Reassessment of previous findings

| Previous R IDs | Current result (do not close the whole family from one narrow fix) |
| --- | --- |
| R01 | Getter is now wired; pre-request change test passes. In-flight/retry/check-use gaps remain F05/F22. |
| R02 | Leaf timeout now unknown, fixed. Late decision/deadline/remaining-budget siblings remain F05. |
| R03 | Single runner/admission ID fixed. Cursor/journal/terminal/idempotency remain F07. |
| R04 | Resume during inference is now discarded. Before-model and post-intent takeover still fail F05. |
| R05/R06 | Correct task ID passed to handoff. Invalid reason, hung gate, job/runtime clocks and actual agent controls remain F06/F16/F21. |
| R07 | Already-aborted lanes and batch map/listener cleanup fixed. Child Stop/partial/catch/session cleanup remain F17. |
| R08 | Uncontended lease transfer works. Capacity/same-owner-other-session/task-owner variants fail F03; cookies F11. |
| R09 | GenericSignInAdapter added. Static manifest gate, generic false authentication, registry consumers remain F10/F11/F19. |
| R10 | Cards still unmounted: F21. |
| R11 | Settings rows now seeded. Batch/active switch enforcement still missing F20. |
| R12 | Proxy health options now supplied, fixed. Full fail-closed selection/relaunch family F04/F18. |
| R13/R14 | URL/cookies/lineage and options/coverage remain F08/F14/F18. |
| R15 | Invented EXTRACT ref and cross-site URL checks added. Unobserved same-site URL, contract/output chain remain F14. |
| R16 | Fresh-observe failure now yields partial, fixed. Stop while fresh observe runs still permits completed (F05). |
| R17/R18 | Recovery subgoal now sent. Freshness/deadlines/planner/helper/progress remain F15. |
| R19 | Main fill gate added. Worker/main state skew, in-flight/user-wait lifecycle remain F05/F06/F10/F12. |
| R20 | Recipe forwarding fixed. Stable recipe identity, decoys, DOM identity and transition handling remain F09. |
| R21 | Existing account password update, new-card AI flag and legacy domain check improved. Identity/race/UI/cookie cases and Model write layering remain F11/F12/F21. |
| R22 | Else leaves included, fixed. Context/condition/iteration/array encoding remain F13. |
| R23/R24 | Provider/native/model/ownership/control/settings UI still incomplete F16/F20–F22. |
| R25/R26/R27 | E2E harness/full validation/qualification still incomplete F23/F24. |

## 4. Functional requirement coverage

All functional IDs from the PRD are mapped below. Grouped integer ranges include every integer in the range; suffix IDs are explicit. Foundation = relevant source exists; it does not certify acceptance.

| Requirement IDs | Assessment / open family |
| --- | --- |
| D-FR-01 | Existing browser availability foundation; batch/active admission F20. |
| D-FR-02–04 | Pre-request revision guard improved; immutable route, late response, native/model/capabilities F05/F22. |
| D-FR-05–06 | Goal/criteria and loop present; real worker execution/planning F01/F02/F14/F15. |
| D-FR-07–10 | Task ID/startup/journal foundations; ownership, cancellation, persistence/terminal correctness F05–F07/F16/F17. |
| D-FR-10a | In-job approval/handoff incomplete F06. |
| D-FR-10b | Compact final result foundation; output/cancel/attribution F05/F07/F14/F24. |
| D-FR-10c | Routing guidance present; advertised capability exceeds implementation F14/F15/F22. |
| D-FR-11 | Execute-and-observe foundation; wire/outcome/lifecycle F01/F07/F14. |
| D-FR-12–15 | Observation and live-check foundations; real evaluation, options/ranking/coverage/secret handling F02/F08/F09/F14. |
| D-FR-15a | Epoch/pin foundation; cap/TTL/pending lifetime F08. |
| D-FR-16–19 | Widened type/client foundation; actual execution/strict contract/options/extraction/uncertainty/adapter parity F02/F14/F22. |
| D-FR-20–25 | Planner/bindings/helper/cache/recovery/progress/verifier incomplete F05/F15. |
| D-FR-26 | Leaf timeout fixed; all late/error/unknown/partial paths F05/F07. |
| D-FR-27 | Hash improved; full semantic scope F13. |
| A-FR-01–02 | Credential-free tool exists; actual login origin/state/control F05/F10/F12. |
| A-FR-03–07 | Card/secret IPC/domain foundation; cookie-first/picker/identity/opt-in/attempt/DB write gaps F11/F12/F21. |
| A-FR-08–11 | Worker fill/outcome/cooldown foundation; recipient safety/real state/bind/cookies F03/F09–F12. |
| A-FR-12 | Manual refusal prevents unsafe registration; specified confirmed Create account workflow incomplete F12. |
| A-FR-13–15 | Generic/runner sign-in/secret end-to-end evidence incomplete F02/F09/F11/F15/F23. |
| A-FR-16–21 | Page functions/revalidation/two-step foundation; all candidate/DOM/frame/recipe/transition safety cases F09/F10/F12. |
| S-FR-01–03 | Entity/model/upsert/seed foundation; real upgrade/concurrency evidence F19/F24. |
| S-FR-04–06 | Domain provenance/confirmation and authoritative consumer replacement F11/F19/F21. |
| P-FR-01–09 | Encryption/selection/health/restart foundation; fail-open credentials, full state/consent/geography/metadata/migration F04/F18. |
| M-FR-01–05 | Agent/fan-out/schema foundation; runtime tools/consent/policy/results F16/F17/F21. |
| M-FR-06–09 | Memory/caps/lease/abort foundation; all transfer/ownership/queue/root/cleanup paths F03/F16/F17/F20/F21. |
| M-FR-10–13 | Provider/batch budgets, sub-agent model/executor and browser/window qualification F16/F22/F24. |
| C-FR-01–03 | State/coordinator/user-resume foundation; actual matching state/wait semantics F06/F10/F16. |
| C-FR-04–08 | Pause/generation/IPC foundation; all async boundaries/runtime/user instructions/unknown results F05–F07/F10/F16/F21. |
| C-FR-09–12 | Job user-wait foundation; parent clocks/cap/queue/partial/interventions F06/F07/F17/F21. |
| C-FR-13–16 | Cookie/startup foundation; complete account/cursor/control/title/restart flows F07/F10–F12/F16/F21. |

Acceptance coverage remains open: D-AC-01–12 map to F01/F02/F05–F08/F13–F16/F20/F22–F24; A-AC-01–05 to F03/F09–F12/F21/F23; S-AC-01–02 to F11/F19/F21/F23/F24; P-AC-01–02 to F04/F18/F23/F24; M-AC-01–03 to F03/F16/F17/F21/F23; C-AC-01–04 to F05–F07/F10/F16/F17/F21/F23. No all-acceptance-pass claim is supported.

## 5. Closure rule and implementation order

1. Fix real protocol/evaluation/fail-closed/secret boundaries first (F01/F02/F04/F09), retaining the family-wide regression cases.
2. Make lifecycle/ownership/account/session state atomic and consistent (F03/F05–F07/F10–F12/F16/F17).
3. Complete contracts, planning, registry/proxy/UI/provider features (F08/F13–F15/F18–F22).
4. Run real boundary tests and full local gates, then qualification and genuinely external/operator gates (F23/F24).

For each family: fix **every listed sibling occurrence**, add parameterized negative and positive boundary tests, verify production wiring (not only helper behavior), update six-language UI text/tests where applicable, and commit the completed logical unit under repository rules. A status note or passing happy-path mock is insufficient to close the family. Missing local code/harness is an implementation task; only genuinely inaccessible deployment/provider/packaged evidence is externally unverified.
