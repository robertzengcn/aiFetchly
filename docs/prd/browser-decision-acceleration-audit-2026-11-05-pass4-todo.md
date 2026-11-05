# Browser decision acceleration — fourth audit and consolidated TODO

Date: 2026-11-05 (Asia/Shanghai). Worktree: `E:\project\aiFetchly-bda`. Branch: `feature/browser-decision-acceleration`. Audited HEAD: `b541204f118ea66f2ef2de716252d7f7ec142761`; implementation update: `4ea471f78`. Compared to prior audit commit `513e8a906` and read against [PRD](browser-decision-acceleration-prd.md) and [technical design](browser-decision-acceleration-technical-design.md).

**Verdict: not all requirements are implemented, and blocking bugs remain.** There are **22 open issue families**, preserving F02/F03/F05–F24 for continuity; F01 and the original F04 defect are resolved. This file lists similar occurrences together, with concrete consequences and closure matrices. The most urgent new regression is invalid JavaScript in the observation collector. A pass-4 completion note for F10 is contradicted by current source and a failing test.

Scope: documentation-only review, no production fixes. An existing untracked `scripts/_tmp_f02a.py` was present before the audit and was left untouched. Previous report files were preserved. Detailed unchanged findings were rechecked against the narrow update diff and current source searches; reproduced failures are distinguished from missing functionality and unverified release evidence. This is not a guarantee that every possible runtime bug has been found.

P0 = execution blocker or mandatory safety invariant failure; P1 = required correctness/integration gap; P2 = qualification evidence. All unchecked tasks below remain open. Local deterministic tests use controlled collaborators, not a live production account or proxy.

## 1. Current validation and evidence

| Check | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | PASS, exit 0. |
| Committed browserDecision/browserLogin/browserAgents/managedBrowser tests | PASS: 36 files, 396 tests in the combined run; temporary audit cases are counted separately below. |
| Extra boundary regressions, final adapted harness | 50 tests: **34 fail / 16 pass**, two temporary files. Mandatory TypeScript gate ran; no AIFETCHLY_SKIP_TSC. Function arguments execute with an element object; strings retain browser expression semantics. |
| Renderer build: `node node_modules/vite/bin/vite.js build --config vite.render.config.mjs` | PASS, exit 0, with AIFETCHLY_SKIP_VITE_CHECKER=1. Independent tsc and vue-tsc results remain separate; passing bundles do not parse runtime strings. |
| `node node_modules/vue-tsc/bin/vue-tsc.js --noEmit --incremental false` | FAIL, exit 2: EditSearchTaskDialog.vue:17:26 TS7006 parameter v; outside this update. |
| Full component suite | FAIL: 180 files, 172 pass / 8 fail; 1,585 tests, 1,389 pass / 196 fail. Shared localStorage setup failures in Node 26; not established as 196 new BDA defects. |
| E2E / actual headed Chromium / SQLite upgrade / live proxy / hosted/native endpoint / performance qualification | Not executed; source gaps and missing evidence remain as detailed below. |
| Six-language translations | Locale files unchanged since previous key-parity check; no new claim of runtime/translation quality or mounted-flow success. |
| Local Forge package/make | Not run: forbidden by AGENTS.md; packaged delivery evidence belongs to operator/CI. |

Current logs: `%TEMP%/bda-r4-typecheck.log`, `bda-r4-main-and-reproductions.log`, `bda-r4-reproductions-final.log`, `bda-r4-components.log`, `bda-r4-vue.log`, `bda-r4-build.log`. Final reproduction sources are retained outside the repository as `%TEMP%/bda-r4-reproductions.test.ts` and `bda-r4-reproductions-dom.test.ts`; copy to main/browserDecision and main/browserLogin test directories to rerun with vite.main.config.mjs. Temporary repository copies were removed before committing. Artifacts are local and ephemeral.

The first combined run had five obsolete function mocks still interpreting newly converted functions as strings. Those were corrected and the final 50-case run above is authoritative; do not count those mock failures as production defects. Of the original 45 cases, 29 still fail and 16 pass. Five new checks fail: collector syntax, masked descriptor consistency, unmarked password-name leakage, removed-input acceptance, and equal-length copied-secret acceptance. The latter is explicitly a limit of length-only checking, not proof that the documented length comparison was implemented incorrectly.

### Fix reassessment and complete sibling sweep

| Prior family | Current conclusion |
| --- | --- |
| F01 | Both request clients fixed; two capture tests pass. Full real-worker round trips still belong to F23. |
| F02 | All five element-operation controls now pass; new collector syntax regression and masked fingerprint mismatch remain. |
| F04 | Explicit and auto undecryptable proxies both reject correctly; other proxy work stays in F18. |
| F09 | Same-form autocomplete preference, inserted-recipient detection and marked-name masking pass; separate username-only branch, ambiguous forms, removed/equal-length recipients and unmarked secret surfaces remain. |
| F10 | Not fixed: WorkerSession still enters user_login_in_progress and OBSERVE still rejects login_required. The previous report's completion note is inaccurate. |
| F12 | Password update moved to Model, fixed; races, identity, cooldown/card cancellation and account setting UI remain. |
| F03/F05–F08/F11/F13–F24 | No relevant implementation fixes in this update. Reproductions and unchanged source evidence are detailed by family below; do not infer closure from a sibling helper fix. |

## 2. Consolidated issue families and related occurrences


### F01 — resolved original blocker — both request clients now use protocol v2

Verified in current source and two passing production-client request-capture tests: ManagedBrowserWorkerClient and ManagedBrowserCacheWorkerClient now stamp MANAGED_BROWSER_PROTOCOL_VERSION. The earlier hardcoded-version defect is closed. Retain real client→worker schema/round-trip tests across start/observe/actions/login/pin/stop and cache scan/delete/cancel/shutdown; the audit did not run actual Electron utility processes. This is a resolved defect, not an open TODO.

### F02 — P0 — new collector JavaScript syntax error; descriptor normalization still disagrees

- [ ] Remove TypeScript-only syntax from every string evaluated by Chromium; add actual JavaScript parse/execution tests for every page script and exercise buildObservation rather than returning fabricated records.
- [ ] Use a consistent safe semantic fingerprint for observation registration and live target validation, including credential masking, secret redaction and name length limits; preserve refusal of credential mutation.

**New regression:** src/childprocess/managed-browser/BrowserObservationService.ts:98 inserts `(htmlEl as HTMLInputElement)` three times into COLLECT_ELEMENTS_SCRIPT, a template string. TypeScript checks the enclosing string but never transpiles its contents. Real browser JavaScript throws `SyntaxError: Unexpected identifier 'as'`. A deterministic `new Function(COLLECT_ELEMENTS_SCRIPT)` reproduction fails with exactly that error. buildObservation catches the collector exception and returns an empty control list with a truncated notice. Thus all fresh observations lose interactive targets even though TypeScript and the renderer build pass. Remove the assertion from the runtime string or construct a properly serialized standalone page function; search every embedded script for the same class of error.

**Fixed subcases:** readElementDescriptor, probeInputElementTypeFn, clearElementValueFn, clearElementWithEventFn and extractElementDataFn are now real functions. Five click/fill/select/hover/clear boundary checks pass after adapting the harness to execute actual function arguments with an element node, while preserving Runtime.evaluate semantics for strings. Do not retain the previous string-IIFE bug as still open.

**Related new mismatch:** shapeElementRecord now stores a credential-marked field's name as `[credential]`; buildObservation registers that shaped name. readElementDescriptor still returns the raw accessible name (e.g. `Email`), and BrowserActionExecutor.withElement compares it literally to the masked registry name. A valid HOVER on an unchanged marked text field returns stale_page_reference in the added production-executor test. Ordinary name budgeting/redaction also differs between shaping and the raw live descriptor; cover long names, sensitive-looking labels and changed fields. Fix normalization without enabling ordinary credential writes or exposing secrets.

Closure matrix: JavaScript parse + DOM execution of all page/element scripts; collect→register→validate→act using the actual production seam; hidden/empty/credential/long-name controls; click/fill/select/hover/clear/extract; no swallowed collector failure represented as a usable snapshot. Requirements: D-FR-06/11–16, A-FR-15, design §§7/8/14/20.

### F03 — P1 — lease transfer handles only some discriminated outcomes

- [ ] Implement an atomic transfer operation with rollback, checking every lease result and retaining root/task ownership.

`ManagedBrowserModule.bindAccountToSession():1654` acquires the account lease before releasing the public lease. At the global session cap, acquire returns global_limit_reached. That result is ignored, the public lease is released, and the record is marked authenticated/account-backed without an account lease. If another session in the same conversation already owns the account, acquire returns already_active for that other session; bind nevertheless changes the current record instead of rejecting/queuing. OwnerAgentTaskId is omitted during a successful transfer. The result is two apparent controllers or an unleased browser, not account exclusivity.

All three variants reproduced. The uncontended below-capacity path does work. Also validate release failure, different-owner conflict, same-session idempotency, cancellation during bind, and any attempted rebind of an account-backed session. Do not suppress bind failure and return signed_in (BrowserCredentialLoginService currently does).

Closure matrix: transfer at limits 1/3/5; no transient extra session counted; same/different conversation AND same/different task/session; correct token/key release; account queue; unchanged state on refusal; cleanup. Requirements: M-FR-06/07, A-FR-11, D-FR-08; previous R08/R09/R21.

### F04 — resolved original blocker — undecryptable selected proxies are rejected

Both explicit proxy_id and auto now propagate mode=unresolvable as status=unresolvable before start can select a direct connection. Both production selector tests pass with a stored password whose decryption returns null. This closes the specific fail-open decryption bug. It does not close the separate consent, health-check, restart, geography, host/port validation and migration work in F18. Retain explicit/auto/account-default tests plus real no-direct network evidence for failed proxy startup/switching.

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

### F09 — P0 — login selection, recipient mutation and secret masking remain partial

- [ ] Apply deterministic username/recipe selection to username-only and password-bearing pages, reject ambiguous forms, validate every recipient and make safe cleanup cover changed/removed/replaced inputs.
- [ ] Mask secrets in all output surfaces, including unmarked password fields, copied text fields and raw page text; retain a sentinel test through the full worker→main→tool/transcript/log chain.

**Fixed and reproduced passing:** an earlier decoy textbox within the same password-bearing form no longer wins over autocomplete=username/email; a newly inserted input containing the password is detected and cleared; a credential-marked field's accessible name is masked. These three fixes must remain covered.

**Still reproduced with the actual production page function:**

1. The separate username-only branch still selects the first generic text/email/tel field from the first form, so an earlier unrelated search form receives the username and is submitted before the actual login form. The new autocomplete preference was added only to the password-bearing branch.
2. Multiple equally eligible login forms still reduce to candidates[0] without recipe-based disambiguation or refusal.
3. The new identity Map detects additions but loops only over inputs present afterwards. An input removed during the password event is never checked; submission still succeeds. An unused inputSet does not enforce set equality. Retain references to detached/replaced recipients for cleanup and abort on unexpected recipient-set change.
4. Another existing input containing an eight-character placeholder can be overwritten with the eight-character sentinel password during the password input event; length-only checks accept it and leave the copied secret. Equal-length changes are a limitation of the PRD's proposed length check, not a claim that lengths can prove value equality. A-AC-01/A-AC-04 still require the resulting copied secret not to escape or be accepted as safe: add local sentinel-aware output redaction/recipient checks or resolve the safety design explicitly; do not report that Map identity proves all tampering absent.
5. shapeElementRecord masks names only when isCredential=true. An unmarked inputType=password with the short sentinel in its accessible name still exposes that sentinel in the observation; new test fails. This includes password fields not marked by our filler. The collector still falls back to getAttribute('value'). Regex-only redaction is not a proof that a known password cannot appear in labels/title/body/error/URL/extraction/logs. The new masked-name/live-descriptor mismatch is tracked in F02.

Saved recipes still favor data-mb-obs ordinal stamps while matching name/id/autocomplete; unstable ordinals are not reusable field identities. Two-step transitions still rely on fixed 2.5-second sleeps and can resubmit the same page. Same-site-frame support, bounded ambiguity resolution, native-setter→keystroke fallback with focus checks, and guaranteed handoff for safety refusals remain incomplete.

Closure matrix: saved/invalid recipes; autocomplete username/current/new-password; username-only earlier form; zero/one/many forms/passwords; show-password toggle; inserted/replaced/reordered/removed/equal-length recipients; copied secret and detached-node cleanup; readback mismatch; same-site/cross-site frames; slow transitions; sentinel across all output surfaces. Requirements: A-FR-08/15–21, A-AC-01/03/04, D-FR-12.

### F10 — P1 — claimed login-state fix is not in the current worker/runtime source

- [ ] Implement one shared state/command matrix in both actual processes and verify complete startup→automated login→manual handoff→resume journeys.

The previous report now contains a pass-4 “CORE DONE” note stating WorkerSession stays login_required and OBSERVE permits that state. That note does not match audited HEAD: WorkerSession.ts:382–383 still calls transition(login_required), then transition(user_login_in_progress) before LOGIN_REQUIRED. ManagedBrowserRuntime's OBSERVE_STATES still excludes login_required. The added observation permission test still fails. Neither file changed in the latest implementation commit.

Main stores LOGIN_REQUIRED as login_required, so main and worker disagree immediately. BrowserCredentialLoginService catches failed observe, but needs a live HTTPS origin; startup currentOrigin is null and LOGIN_REQUIRED carries no URL. Initial automated login can therefore return insecure_page or fail to acquire usable state. ACTION_STATES including login_required is insufficient because OBSERVE has its own set and the worker is in another state.

WorkerSession.fillLoginForm still does not enforce the runtime command guard. A main-only pre-request guard does not protect an already accepted multi-round login against takeover. Main permits RESUME_HANDOFF in login_required; WorkerSession.resumeFromHandoff still expects handoff. The transition table allows login_required→user_login_in_progress only, so changing a single assignment would still require complete transition/verification treatment.

Closure matrix: each observe/action/login/verify/begin-handoff/resume/stop command × ready/running/login_required/user_login_in_progress/verifying_manual_login/handoff/challenge/stopped in main and real worker; Stop/takeover during every login round; origin observation before secret release. Requirements: A-FR-02/09/13, C-FR-01/05/07, D-FR-15.

### F11 — P1 — generic authentication, registry eligibility and cookie lifecycle remain disconnected

- [ ] Resolve generic sessions/cookie policy from BrowserSite end to end, require meaningful authentication evidence, and preserve account identity when binding.

GenericSignInAdapter exists, but ManagedBrowserModule.start still rejects missing hardcoded getPlatformManifest before checking BrowserSite. New high-ID sites cannot start account sessions. Cookie refresh also uses the static manifest. Generic assessment only checks no password/no login-looking path/no generic error; an OTP-only `/verify` page was reported authenticated by the actual adapter script (reproduced). It does not incorporate the challenge probe into that decision.

Successful fill does not capture/send refreshed cookies. Public→account bind still leaves worker platformDefinition platformId=0, so captureAndSendRefreshedCookies returns immediately; main platformId/labels/domain/allowed-site metadata also remain public. Binding an already account-backed record returns without a fresh cookie capture. Cookie-first sign-in is not attempted by BrowserCredentialLoginService. A signed_in result can therefore lack the promised persistent account session.

Closure matrix: new registered site, seeded sites/YouTube, login/OTP/CAPTCHA/password-free landing page, authenticated identity check, public→account transfer, current account success, cookies after manual/automated login, reopen/restart/proxy switch, no cross-site cookie release. Requirements: S-FR-05/06, A-FR-03/09/11/13, C-FR-13.

### F12 — P1 — account credential flows retain race, identity, cooldown and opt-in gaps

- [ ] Atomically reserve account+site attempts before any awaited check; apply cooldown/reservation to existing/new/one-time paths and cancel all card/fill work on Stop.
- [ ] Preserve the selected account identity if a card edits a username, expose per-account AI-use settings, and keep failure/storage operations in the proper Model layer.

The new updatePasswordForAccount now correctly delegates its encrypted write to SocialAccountModel.updatePassword. The earlier direct password repository write is closed. Legacy-domain lookup and save-time ai_use_enabled changes were already present before this update and are retained.

Remaining related paths:

- inFlightAccounts.has precedes awaited isSignInCoolingDown, then add; concurrent callers can both pass before either reserves the account.
- Cooldown records failures, not every automated attempt; new-account and one-time card paths bypass chosen-account reservation. Enforce the specified account+site attempt window consistently.
- The password-only card permits changing username; updatePasswordForAccount updates only password, fill uses submitted.username, but bind/failure recording use chosen.id. This can mix account identities and persist a password against the wrong username.
- Null credentials conflate domain refusal, decryption failure and missing password; all become a password card instead of distinct reasons.
- Pre-aborted and post-consume signals are not checked before fill; the username-only card wait lacks the job waiting producer. Stop/cancel may open handoff rather than terminate.
- Account detail has no per-account AI opt-in editing. Existing disabled accounts cannot be managed through the required setting even though save enables new accounts.
- Registration safely defaults to manual handoff, but the required confirmed Create account/card workflow is still absent unless the requirement is revised explicitly.

Audit remaining cooldown/failure repository operations separately; fixing the password method does not establish all data-access layering or transaction behavior.

Closure matrix: existing/new/legacy/password-only/one-time; concurrent attempts; fresh/future/expired cooldown; domain/decrypt refusal; username edit; AI opt-in on/off; Stop before/during/after card; encrypted password update without duplicate/mismatched identity. Requirements: A-FR-03–12, PRD §7, Model/Module rules.

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

checkProxyHealthy supplies concurrency/timeout correctly, and F04 decryption rejection is now fixed. Still unresolved: lastUrl is currentOrigin, losing path/query; public cookies are not transferred; account binding/cookie problems in F03/F11 carry into relaunch; the conversation:account:platform counter combines unrelated sessions/tasks, never expires per task and consumes failed checks. Only explicit proxy IDs get the new health check; selection/confirmation can still fail inside start after Stop. In-flight commands are not drained under a switch lease. New session ID/revision/fresh observation is not fully re-bound to active runner/task context.

Auto searches only linked proxies, may ignore country or pick failed entries; explicit/account default/direct transitions need consistent country/consent and account proxy persistence. Resolved proxy drops country/id metadata; launch does not derive locale/timezone from country. Safe session status has proxyActive only, not host/country/direct badge metadata. classifyProxyError is not wired to browser network errors. Proxy-list safe mapper/type omit browser_usable even though the model DTO adds it; verify last real check state rather than constant/default status. Untouched legacy passwords remain plaintext with lazy migration.

Validate nonempty hosts and finite integer ports in range before launch; toResolvedProxy currently performs only Number(row.port). Closure matrix: start and switch explicit/auto/direct; same/different country/account; healthy/dead/407/tunnel/decrypt failure; full URL/query/cookies; concurrent program; repeated/failed switch limits; public and bound-account lineage; locale/timezone/WebRTC/fingerprint and UI metadata. Requirements: P-FR-01–09, P-AC-01/02.

### F19 — P1 — site registry is not the authoritative source for all consumers/domain changes

- [ ] Replace remaining static platform lookups, finish trusted redirect-domain proposal/confirmation, and verify seeding/ID/upgrade/concurrency behavior.

SocialAccountModule platform labels, socialaccount-controller and socialaccountdetail.vue still use SocialPlatformList; ManagedBrowserModule/cookie policy still use static manifest. New high-ID sites therefore do not complete the promised account journey. BrowserSite upsert derives own domain safely, but proposeAdditionalDomains accepts supplied visitedDomains without an authoritative session redirect ledger, and applyAdditionalDomains has no confirmed proposal token/visited-domain binding. No app IPC/card consumer is wired. Do not expose those helpers directly without the trusted provenance/confirmation state machine.

Seed failure is caught inside a memoized promise; a transient failure can leave the process permanently unseeded without a retry. High-ID allocation and domain deduplication need concurrent upsert transaction/unique-conflict tests. New Model/entity registration is not upgrade/backfill evidence. Existing database path/worker-access and Model-only data access rules still apply (verify all remaining credential/cooldown writes after F12's password-layering fix).

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

Committed tests pass without exposing the collector syntax error or the unchanged state-machine defect. The updated effect-test mock now recognizes function names; that is still not a production collect→register→act test. Request-version fixes also need client→real-parser tests rather than fake workers accepting arbitrary envelopes. The update added almost no family-specific regression coverage. Extend real Model/Module/SQLite and provider/permission/query-loop tests as required by each family.

The current rerun still has 196 component failures across eight shared suites with localStorage unavailable, and the Vue implicit-any error in EditSearchTaskDialog. Attribute these separately from BDA regressions. The safe renderer Vite build now passes (checker plugin disabled; independent tsc passes and independent vue-tsc fails). That build does not validate main/worker runtime strings or establish packaged delivery. build:e2e and critical E2E still need evidence. No local Forge package/make.

Closure matrix: real client→parser, actual page function/handle evaluation, fake provider endpoint ownership and traffic, final DOM state, sentinel traces, parallel crash/handoff/45-minute wait/Stop, full test:components and one-shot TS/Vue checks. Requirements: D-AC-10 and all A/S/P/M/C acceptance cases, design §20.

### F24 — P2 — performance, accounting, upgrade and rollout qualification remain incomplete

- [ ] Instrument all stages and upstream attempts, preserve bounded metadata/accounting, run the paired held-out evaluation and demonstrate rollback/upgrade/compatibility.

No evidence establishes the proposed 50% median task-time / 70% expensive-call targets without unacceptable success regression. Runner returns a few counters, not complete planner/helper/recovery/verifier attempts, active/user-wait time, route/model/token/cost certainty. Batch totals/parent-context size, failure costs and 429 behavior are not qualified. Global/per-engine/per-workload switches and active disabling/rollback are not complete. Background-throttling flags were added but fingerprint/WebRTC/window behavior against the bundled Chromium is unproven.

Closure matrix: baseline vs observation optimization vs Jev vs hosted Laya vs custom chat; 50–100 held-out task families with repeated multilingual trials, independent outcomes, shortlist recall, calibrated coverage, sample sizes/uncertainty, p50/p95, all-attempt cost per verified success, batch totals and parent context, declared success-rate margin/confidence method, upgraded DB/settings and backward compatibility. Local fake-provider qualification can run locally; external provider/deployment and packaged process-tree evidence are separate explicit gates. Requirements: PRD §§8–10, design §§20/21.

### Shared source locations for the remaining families

Use these together with the exact symbols and failure branches above; filenames are relative to this worktree.

| Families | Production paths to change/test together |
| --- | --- |
| F02/F08/F09/F14 | src/childprocess/managed-browser/BrowserObservationService.ts, BrowserActionExecutor.ts, PageReferenceRegistry.ts, LoginFormFiller.ts, ResultSanitizer.ts; src/service/browserDecision/CandidateBuilder.ts |
| F03/F10/F11/F18 | src/modules/ManagedBrowserModule.ts; src/service/ManagedBrowserLeaseService.ts; src/childprocess/managed-browser/WorkerSession.ts, ManagedBrowserRuntime.ts, adapters/GenericSignInAdapter.ts |
| F05–F07/F13–F15/F22 | src/service/browserDecision/BrowserTaskRunner.ts, DecisionClients.ts; src/service/ManagedBrowserAiToolService.ts; src/modules/BrowserTaskModule.ts; src/model/BrowserTask.model.ts; src/entity/BrowserTask.entity.ts |
| F06/F12/F16/F17/F20 | src/service/browserAgents/AgentTaskControlService.ts, HandoffCoordinator.ts; src/service/AgentRuntime.ts; src/service/agentTools/runBrowserTasksTool.ts; src/service/browserLogin/BrowserCredentialLoginService.ts; src/modules/socialAccountModule.ts; src/model/SocialAccount.model.ts |
| F18/F19 | src/service/browserProxy/BrowserProxySelectionService.ts; src/modules/browserProxy/ProxyCredentialCodec.ts; src/modules/BrowserSiteModule.ts; src/model/BrowserSite.model.ts; src/controller/socialaccount-controller.ts; src/views/pages/socialaccount/socialaccountdetail.vue |
| F20/F21/F22 | src/modules/ManagedBrowserSettingsModule.ts; src/views/components/settings/ManagedBrowserSettingsPanel.vue, AIProviderSettingsPanel.vue; src/views/components/aiChatV2/BrowserAccountPickerCard.vue, BrowserSiteConfirmCard.vue, BrowserTaskBatchCard.vue; task-control IPC and parent-chat consumers |
| F23/F24 | test/vitest/main/browserDecision, browserLogin, browserAgents, managedBrowser; test/vitest/main/components; test/e2e/specs/browserDecisionTask.test.ts, browserSignIn.test.ts, browserParallelTasks.test.ts; PRD §§8–10 qualification evidence |

## 3. Functional requirement and acceptance coverage

All functional IDs from the PRD are mapped below. Grouped integer ranges include every integer in the range; suffix IDs are explicit. Foundation = relevant source exists; it does not certify acceptance.

| Requirement IDs | Assessment / open family |
| --- | --- |
| D-FR-01 | Existing browser availability foundation; batch/active admission F20. |
| D-FR-02–04 | Pre-request revision guard improved; immutable route, late response, native/model/capabilities F05/F22. |
| D-FR-05–06 | Goal/criteria and loop present; real worker execution/planning F02/F14/F15. |
| D-FR-07–10 | Task ID/startup/journal foundations; ownership, cancellation, persistence/terminal correctness F05–F07/F16/F17. |
| D-FR-10a | In-job approval/handoff incomplete F06. |
| D-FR-10b | Compact final result foundation; output/cancel/attribution F05/F07/F14/F24. |
| D-FR-10c | Routing guidance present; advertised capability exceeds implementation F14/F15/F22. |
| D-FR-11 | Execute-and-observe foundation; outcome/lifecycle F07/F14. |
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
| P-FR-01–09 | Encryption/selection/health/restart foundation; decryption fail-open fixed; full state/consent/geography/metadata/migration F18. |
| M-FR-01–05 | Agent/fan-out/schema foundation; runtime tools/consent/policy/results F16/F17/F21. |
| M-FR-06–09 | Memory/caps/lease/abort foundation; all transfer/ownership/queue/root/cleanup paths F03/F16/F17/F20/F21. |
| M-FR-10–13 | Provider/batch budgets, sub-agent model/executor and browser/window qualification F16/F22/F24. |
| C-FR-01–03 | State/coordinator/user-resume foundation; actual matching state/wait semantics F06/F10/F16. |
| C-FR-04–08 | Pause/generation/IPC foundation; all async boundaries/runtime/user instructions/unknown results F05–F07/F10/F16/F21. |
| C-FR-09–12 | Job user-wait foundation; parent clocks/cap/queue/partial/interventions F06/F07/F17/F21. |
| C-FR-13–16 | Cookie/startup foundation; complete account/cursor/control/title/restart flows F07/F10–F12/F16/F21. |

Acceptance coverage remains open: D-AC-01–12 map to F02/F05–F08/F13–F16/F20/F22–F24; A-AC-01–05 to F03/F09–F12/F21/F23; S-AC-01–02 to F11/F19/F21/F23/F24; P-AC-01–02 to F18/F23/F24; M-AC-01–03 to F03/F16/F17/F21/F23; C-AC-01–04 to F05–F07/F10/F16/F17/F21/F23. No all-acceptance-pass claim is supported.

## 4. Recommended closure order

1. Fix F02 collector JavaScript and matching descriptors, then F09 secret/recipient safety; retain the now-passing F01/F04/function-boundary controls.
2. Fix all lifecycle and ownership variants together: F03/F05–F07/F10–F12/F16/F17, including after every await, actual worker commands and user-wait clocks.
3. Finish observation/contracts/planning/approvals, site/proxy consumers, mounted UI and provider parity: F08/F13–F15/F18–F22.
4. Establish real boundary/E2E/upgrade evidence, resolve full local checking failures, then complete qualification and operator-only gates: F23/F24.

Each family closes only when all listed sibling paths have production wiring and parameterized positive/negative tests. Preserve existing passing fixes, test actual string/function/protocol boundaries, update all six locales and UI tests for UI changes, and commit each completed logical unit. Status annotations alone cannot close a requirement. Missing local harness code is an implementation task; inaccessible packaged or external-provider evidence is a separate qualification limit.
