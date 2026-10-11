# Task completion policy — implementation audit and detailed TODO

Audit date: 2026-10-07. Audited branch: `worktree-task-completion-policy-v1-slice1`.

Audited application HEAD: `88cca0c88d51603cb11d979d1f49b78984616108` (clean before audit).
Worktree: `/Users/cengjianze/project/aiFetchly/.claude/worktrees/task-completion-policy-v1-slice1`.
This is a fresh review of the updated code, including the new Slice 2 commits. It supersedes older audit conclusions about this snapshot. Application code was not changed by this audit.

Specification: [PRD v3.0](scheduled-loop-premature-stop-recovery-advice.md), FR-01–24, NFR-01–12, AC-01–32; [technical design v2.0](scheduled-loop-premature-stop-recovery-technical-design.md), including delivery slices §16 and rollout §17.

## Verdict

**All requirements are not complete. The current code is not ready to enable task-completion recovery as the release behavior.**

There is substantial implemented foundation: entities, execution creation/deduplication, execution CAS, completion/evidence services, loop consult seams, scheduled finalization, control IPC, translations, components, and tests. Several earlier bugs have been fixed. However, the ordinary manual route has no required completion criteria and therefore cannot recover or verify the user's task; the scheduled route checks only after the maker loop has exited and cannot continue. Live budget spending, usable successor dispatch, outcome UI, and durable delivery also remain incomplete.

Checking a TODO box or testing an injected binding does not establish that the actual user submission reaches that behavior. Some defects below become exploitable once proper contracts/checker dispatch are connected; they must be fixed before that wiring is enabled.

Priority: **P1** = release blocker for the claimed live recovery paths or correctness of completion; **P2** = correctness defect to fix before the affected path ships. `Confirmed` means inspected current source and/or executed current methods. Deferred items are explicitly distinguished from defects in implemented code. All source line numbers below refer to the audited HEAD, not future edits.

## Verification performed

| Check | Fresh result | What it establishes / limitation |
| --- | --- | --- |
| Targeted completion-policy and integration service suite | **233 passed, 19 files** | Library and mocked integration behavior. Includes contract/controller/evidence/coordinator/control/progress/resolver/budget/types/registration plus engine enrollment/finalization/cancel, loop consult, scheduled runner and sink. |
| Execution, operation and scheduled-finalization database/module suites | **41 passed, 3 files** | Current persistence test cases pass; does not cover the failures reproduced below. |
| Full `yarn test:components` | **453 passed, 70 files** | Existing component gate passes, but task chunk tests manufacture events and stub the badge. |
| Six-language history/task translation parity | **7 passed, 1 file** | Keys exist and are nonempty. Does not prove outcome semantics or history reconstruction. |
| `yarn typecheck` | **Passed** | TypeScript compile check. |
| `yarn vue-typecheck` | **Passed** | Vue/TypeScript compile check. |
| `yarn build:e2e` | **Passed** | Fresh source-built Electron test artifacts. |
| Two new Playwright specs, one worker | **3 passed** | Delayed-stream Stop/recovery and Continue/Retry flag, payload and unknown-parent rejection. No real scheduled occurrence, successful successor, or checker-in-flight verification is asserted. |
| Real service composition probes | **Confirmed defects** | Null-contract manual task does not continue; repeated candidates spend only one continuation; finished task at cap becomes incomplete; promise observation and malformed checker output pass; duplicate IDs/unanchored criteria accepted; schema round-trip hash changes. |
| Real SQLite fault/interleaving probe | **Confirmed defects** | Ledger-release failure leaves a terminal execution with active ledger; another transaction's rollback undoes manual finalization that already returned `ok:true`. |
| Controlled-repository probes of actual transpiled methods | **Confirmed defects under controlled interleaving** | Operation claims both succeed; conflicting concurrent operation creation treated as existing; Continue allocates fresh zero-counter ledger. These operation/Continue probes are not claimed as real-provider or process-crash E2E tests. |

Runtime used: installed Node 22.19.0 after adding its directory to the test command's PATH. Initial invocations could not locate `node`; this was an environment issue, not an application failure. No native dependency rebuild was needed. Vite configuration warnings and a worktree renderer font allow-list warning occurred; tests still passed. The normal main-process config invocation for the translation test exited without a test summary, so it was rerun with a temporary config using the service suite's aliases and produced the explicit seven-test result above. This audit does not claim the full `yarn testmain`, all module tests, all E2Es, server checks, or production packaging passed.

Reproduce the targeted checks from this worktree:

```sh
export PATH=/Users/cengjianze/.nvm/versions/node/v22.19.0/bin:$PATH
yarn vitest run --config vitest.service.config.mjs \
  test/vitest/main/service/Task* test/vitest/main/service/aiTask* \
  test/vitest/main/service/aiMessageTaskRunStatusExtended.test.ts \
  test/vitest/main/service/AIChatQueryEngineEnrollment.test.ts \
  test/vitest/main/service/AIChatQueryEngineFinalize.test.ts \
  test/vitest/main/service/AIChatQueryEngineCancel.test.ts \
  test/vitest/main/service/AIChatQueryLoopConsult.test.ts \
  test/vitest/main/service/ScheduledAiMessageRunnerFinalize.test.ts \
  test/vitest/main/service/ScheduledLoopEventSinkPolicy.test.ts
NODE_OPTIONS='--import tsx' TS_NODE_PROJECT=tsconfig.json \
  node_modules/.bin/mocha --require tsconfig-paths/register \
  test/modules/AiTaskExecutionModule.test.ts \
  test/modules/AiTaskOperationModule.test.ts \
  test/modules/AiTaskExecutionScheduledFinalize.test.ts
yarn test:components
yarn typecheck
yarn vue-typecheck
yarn build:e2e
yarn playwright test test/e2e/specs/manual-cancel-during-checking.spec.ts \
  test/e2e/specs/scheduled-incomplete-recovery.spec.ts --workers=1
```

Probe scripts/logs were temporary audit aids under `/tmp`; they are not permanent regression tests. Each TODO below specifies the tests that should be committed with its fix.

## A. Release-blocking implementation TODOs

### T01 — Compile usable contracts on ordinary manual submissions [P1, confirmed]

- [x] Implement source-anchored contract generation and task enrollment for normal user messages.
- [x] Keep identity/Stop available before slow preparation/resolution; do not silently restore unchecked legacy behavior on resolution/contract failure.

**Implemented (Slice 2 T01):** new structural compiler `src/service/aiTaskExecution/TaskCriteriaResolver.ts` (pure function, no LLM, no side effects) derives criteria from the actual user message: count/target → `record_count`, observation/report → `observation`, text deliverable → `qualitative`, operation/send → `operation_receipt`, conjunction ("Find 20 leads, save them, and draft an email") → one criterion per clause with distinct deterministic IDs (`crit-<kind>-<idx>`). Every criterion carries `sourceRefs` anchored to real character spans of the user message. The engine enrollment block (`AIChatQueryEngine.ts`) now freezes a contract for BOTH `task_best_effort` and `task_verified` routes (was: only the dead `task_verified` branch with `criteria:[]`), feeds `approvedSourceContents: { [savedUser.messageId]: request.message }` so `TaskCompletionContractService.freeze()` validates offsets against real content (T17's offset-validation gap closed at compile time), and wraps compile+freeze in its own try/catch: on failure the contract degrades to `null` but `startManual` STILL runs (identity registered, Stop available, controller can never verify — NFR-12 controlled degradation, not the old silent legacy bypass). The outer catch remains for true `startManual` failures. Ambiguous scope emits a qualitative fallback spanning the whole message so the controller has unmet work to continue on (AC-02/18); the fallback can never pass without a checker (stays unverified — AC-21, NFR-12). `hasApprovedTaskTemplate` stays `false` (template wiring is T15); the compiler handles `task_verified` identically so flipping the flag later just runs the same compiler with `mode:"verified"`. Tests: `TaskCriteriaResolver.test.ts` (16 unit tests — count/operation/observation/deliverable/conjunction/ambiguous/polite-prefix/deterministic-IDs/immutability), `AIChatQueryEngineEnrollment.test.ts` (12 tests — best-effort freezes real contract with derived `record_count {minimum:100}`; compile+freeze failure → null contract but enrollment not bypassed; freeze failure → same; conjunction 3 criteria; flag-off never compiles), `TaskCriteriaResolverRegression.test.ts` (7 tests — real resolver→compiler→freeze→evidence→controller: AC-01/17 54/100 → record_count → bounded continue → CONTINUATION_LIMIT; AC-02/18 promise response → continue; AC-20 text deliverable + checker PASS → verified_complete, without checker → incomplete; AC-21 ambiguous → never verified; sourceRef exactness; conjunction 3 criteria all unmet → incomplete). Slice 2 shadow mode: every new path is gated behind `isAiTaskCompletionPolicyV1Enabled()` DEFAULT OFF; flag-off is byte-identical to legacy (compiler never imported at runtime outside the flag-gated block). `record_count`/`operation_receipt`/`observation` providers return fail-closed "unknown" until T03 wires real data; qualitative checker dispatch returns "unknown" until T04 wires the real LLM — T01's regression asserts contract structure + bounded continuation, not verified completion.

**Evidence:** `src/service/AIChatQueryEngine.ts:1303` always supplies `hasApprovedTaskTemplate:false`. All recognized actionable requests therefore use `task_best_effort`. At `:1330–1341`, only `task_verified` freezes a contract, and that branch supplies `criteria:[]`, which the real freeze service rejects. Ordinary tasks have `contract:null`; the consult at `:1428–1440` supplies no fallback required criteria. `TaskCompletionController.ts:163–188` derives empty required/unmet sets, so neither verification nor semantic continuation can occur. Enrollment catch at engine `:1467` drops the binding and permits legacy execution.

**Observed:** real resolver/controller/evidence composition for “Save 100 qualifying contacts to campaign camp-1” followed by “I will save contacts now” returns `task_best_effort`, `finish(incomplete, NO_PROGRESS)`, and `remainingWork:[]`. A completed text deliverable also cannot verify through this null-contract path. The empty verified-contract branch is currently unreachable with the hardcoded resolver input; it is a further defect to fix when template support is connected.

**Required implementation:** validate the exact saved user source and approved references; derive count, observation/report, artifact/text and conjunction criteria; persist contract/policy and identity before action dispatch. Best-effort must retain objective/known criteria and explain uncertainty. Ambiguous scope must ask or remain explicitly unverified. Contract-generation failure must produce a controlled non-success/wait, not bypass enrollment.

**Regression:** real, minimally mocked engine → resolver → contract → evidence → loop composition for 54/100 contacts, first empty/promise response, complete tool-free text, and find+save+draft; no `/goal`, schedule, prior tool call, or task toggle. Assert bounded continuation, every required part, exact source links, no manual schedule row.

**Requirements:** FR-01/02/17/18/19/24; NFR-09/12; AC-01/02/17/18/20/21.

### T02 — Put scheduled recovery inside the shared running loop [P1, confirmed]

- [x] Freeze scheduled contracts and pass the trusted execution/budget/evidence binding into the maker loop.
- [x] Defer sink terminal delivery until loop recovery and durable finalization are complete.

**Evidence:** `ScheduledAiMessageRunner.ts:305–330` hardcodes `task_best_effort` and `contract:null`; `TaskExecutionCoordinator.ts:187–205` has no scheduled contract input. The binding goes to `ScheduledLoopEventSink`, whose consult has no evidence service/criteria. Its `:193–195` explicitly maps `continue` to incomplete because the loop has already gone. This makes successful and unfinished scheduled tasks unverified/incomplete rather than recovering them.

**Required implementation:** same upstream decision boundary as manual runs, frozen scheduled configuration, real evidence, same-occurrence continuation, atomic outcome/accounting afterward. Preserve recurring observation semantics: a retrieved external job still running can complete that observation occurrence.

**Regression:** actual scheduled occurrence with 54/100 → continuation → 100/100; first no-tool stop; external job running observation; one success count only after verified evidence, no second occurrence/user message during recovery.

**Requirements:** FR-02/05/07/12/20; AC-01–05/17/30/32.

### T03 — Use authoritative evidence, implement the missing data/artifact/checker connections [P1, confirmed]

- [x] Replace target-word matching with trusted fresh observation evidence and a separately verified report.
- [x] Wire record-count queries, artifact content/hash/baselines, real operation receipts and a bounded tool-free checker into production bindings.
- [x] Persist actual evidence rows, source revisions and scope before terminal delivery.

**Evidence:** `criteriaAdapters.ts:95–105` passes an observation if its target appears in assistant prose. Probe: “I will check production later” passes the required observation for target `production` with no retrieval. `RecordCountAdapter` at `:154–174` has no provider in the default production registry; `ArtifactAdapter` at `:235–243` is a stub. Engine evidence context at `AIChatQueryEngine.ts:1435–1439` provides only assistant content plus constant revision `slice2-unit4`; no trusted catalog/count/checker/abort wiring. The evidence store adapter at `:1403` always returns false, and no expected version is supplied, so evidence persistence is skipped. Finalization stores IDs, not those missing evidence rows.

**Required implementation:** evidence must come from task-specific Models/Modules or validated read-only filesystem/provider adapters, carry execution/cumulative scope and freshness/baselines, and establish the requested result. Generic tool success, maker text and a criterion ID are not external evidence. Bound/redact stored evidence and retain it across pauses/Continue.

**Regression:** promise and fabricated observation cannot pass; actual current observation can; unrelated old files/records cannot satisfy execution-local work; count 54 fails 100; all conjunction parts pass; complete text can pass without requiring tools; reload can resolve every returned evidence ID.

**Requirements:** FR-02/03/04/19/24; NFR-02/08; AC-01/03/04/11/20/32. Data/text/artifact evidence belongs to the Slice 2 release gate; calling a stub a later enhancement does not satisfy it.

### T04 — Validate qualitative checker output and make checking abortable [P1, confirmed]

- [x] Replace single-word/prefix parsing with the design's schema-validated per-criterion results and actual evidence references.
- [x] Bound checker time, propagate abort, recheck AI entitlement, reserve each actual attempt, and enforce at most one permitted retry.

**Evidence:** `criteriaAdapters.ts:282–299` asks for one word and accepts `startsWith("PASS")`; `:215` manufactures `referenceIds:[criterion.id]`. Probe: `PASS but this report is incomplete` passes content `not a report`. Supplied source-selector/evidence membership is not validated. `checkerDispatch(prompt)` has no abort parameter; the context signal is not used to cancel/wait-bound the dispatch. Catching an eventual AbortError does not itself abort a hanging request.

**Required implementation:** invalid/missing/invented/stale/wrong-execution references → unknown; checker cannot override deterministic failure or uncertain effects. Treat evidence as untrusted data, give the checker no mutation tools, pass cancellation/deadline through transport, validate entitlement before dispatch.

**Regression:** malformed PASS prefix, invalid JSON, absent/invented references, stale scope, prompt injection, timeout and Stop-in-flight; no late verified result and no further dispatch; valid references pass only allowed criteria.

**Requirements:** FR-04/06/08/22; NFR-02/04/08; AC-11/21/24.

### T05 — Enforce and persist execution-wide budgets at actual dispatch [P1, confirmed]

- [x] Add durable, generation-fenced reserve/reconcile/checkpoint operations before provider and tool dispatch.
- [x] Connect resolver, maker, checker, compaction, HTTP retry/fallback, tools, input/output tokens, active runtime and cumulative waits to that one ledger.

**Evidence:** engine `:1442–1443` connects only in-memory continuation reservation. `reserveProviderAttempt`, `reserveToolExecution`, token reconciliation, `addActiveRuntime` and `addWaitMs` have no current live execution callsites. `AiTaskExecution.model.ts:352–359` initializes consumed counters to zero; current implementation has no consumption writes. `resurrectFromLedger` reads these zeros. Library accessors and hard-cap clamping exist, but they do not enforce the real dispatch layers.

**Implemented (Slice 2 T05):** the engine enrollment seam (`AIChatQueryEngine.submitMessage`) constructs five closures from the coordinator's binding — `reserveProviderAttempt`, `reserveToolExecution`, `reconcileTokens` (now returns boolean: true=new, false=dedup), `addActiveRuntime`, and `persistBudget` (which delegates to `AiTaskExecutionModule.persistBudgetConsumption`, an atomic CAS-guarded increment fenced by `owner_generation` + `active_execution_id` + `status='active'`, returning `true`/`false` via `useStructuredResult=true` `.affected`). The loop wires these at four dispatch sites: provider gate before `streamChatCompletion` (fail-CLOSED — throws `RecoverableHistoryError("MODEL_ATTEMPT_LIMIT")` on `Exhausted` or persist-false), token+runtime reconciliation after the stream (in-memory mirror first, persist fire-and-forget with warn-on-failure — advisory, not a dispatch gate), and `reserveToolExecutionBudget` helper at both async and foreground tool entries (record-but-no-gate per D4 — `Exhausted` logged but proceeds; `Reserved` triggers `persistBudget({toolExecutions:1})`, fail-OPEN on false/error). Stable dedup IDs: `prov:${executionId}:${round}` for provider/token, `tool:${call.id}` for tools. `MODEL_ATTEMPT_LIMIT` added to `RecoverableHistoryErrorCode`. `LedgerSnapshot.executionStateVersion` added so the CAS-token bump is observable. Tests: `TaskRunBudget.test.ts` (boolean-return contract), `AiTaskExecutionModule.test.ts` (6 model-layer CAS tests: atomic increment, additive deltas, fail-closed on owner_generation mismatch, fail-closed on active_execution_id mismatch, fail-closed on status!=active, NaN/Infinity clamping), `AIChatQueryEngineEnrollment.test.ts` (closure wiring assertions), `AIChatQueryLoopBudgetGate.test.ts` (7 loop-integration tests: Exhausted → MODEL_ATTEMPT_LIMIT + stream not called; persist-false → MODEL_ATTEMPT_LIMIT + stream not called; Reserved+persist-true → stream called; AlreadyReserved → stream called without re-persisting providerAttempts; flag-off no-binding → stream called; policyAccepted=false → stream called; real TaskRunBudget happy path). Slice 2 shadow mode: every dispatch site checks `binding?.policyAccepted` first and skips when absent (byte-identical legacy — flag stays DEFAULT OFF, zero new gate call sites until Slice 3 wiring). Checker/compaction/HTTP-retry/fallback/cumulative-wait wiring is T06/T08/T10 scope; T05 delivers the durable ledger + the provider/tool/token/runtime dispatch seams.

**Required implementation:** atomic reservation identity per real attempt, persisted before dispatch; usage dedup/reconciliation and conservative estimates; time transitions including one-hour cumulative waits; fail closed if persistence/reservation fails. Existing per-run guards remain additional limits, not replacements for shared execution accounting. Persist no-progress/checker candidate state as well.

**Regression:** max 60 provider attempts including retries/compaction/fallback, max 50 manual tool attempts, max 6 checks and 2 per candidate, 128k accounted tokens, manual active 10 minutes/hard 30, cumulative wait one hour. Spend, pause, reconstruct coordinator, resume/Continue: exact consumed totals remain and exhausted work cannot dispatch.

**Requirements:** FR-08/10/23; AC-06/08/22/27/29.

### T06 — Give distinct candidates distinct continuation/reservation identities [P1, reproduced]

- [x] Generate an immutable identity for each distinct response/end candidate; retain it only when handling the same candidate again. *(commit f3e24cdc — `buildCandidateId` hashes the immutable candidate observation: executionId, boundary, bounded 2 KiB content, finishReason, pending flags, safetyRestriction. Replay of the same response (identical immutable state) retains the same ID; a genuinely different response gets a distinct ID and its own continuation allowance. Content is bounded to 2 KiB before hashing so a runaway stream cannot grow the ID unboundedly.)*
- [x] Deduplicate candidate handling as well as reservation; `AlreadyReserved` must not cause another dispatch of the same continuation. *(commit f3e24cdc — `mapDecisionToOutcome` now maps `AlreadyReserved` to break with `CANDIDATE_REPLAYED` instead of re-dispatching. `Reserved` still dispatches; `Exhausted` still surfaces `CONTINUATION_LIMIT`. Three reservation results map to three distinct honest outcomes. The T06a candidateId fix also closes the checker-ID hole the audit flagged: `beginCheckerCandidate(candidateId)` is a no-op on a replayed candidate (same ID), so the per-candidate checker window is NOT reset — the same unchanged checker candidate never exceeds two actual attempts.)*

**Evidence:** `TaskLoopConsult.ts:137` identifies candidates solely by execution and boundary. `TaskCompletionController.ts:228` derives `cont:${candidate.candidateId}`. Helper `:168–170` permits dispatch on AlreadyReserved. Loop round-cap handling `AIChatQueryLoop.ts:1632–1652` resets round counters on authorized continuation.

**Observed:** five repeated real consult/controller/budget compositions with an unmet criterion and default limits all return continue while consumed continuations remain **1**. This is currently masked by the missing real contracts in T01/T02; it becomes a live cap bypass when criteria are wired. Checker IDs also derive from the repeated candidate and reset local sequence: ensure new checks count actual attempts rather than reusing old reservation IDs.

**Regression:** distinct responses consume three continuations; fourth cannot dispatch. Replay of one candidate dispatches once. Same-boundary round-cap cycles cannot replenish budget; same unchanged checker candidate never exceeds two actual attempts.

**Requirements:** FR-08/23; AC-05/08/29.

### T07 — Allow already-evidenced completion at exhausted maker budgets [P1, reproduced]

- [x] Evaluate admissible local/already-collected evidence before rejecting additional maker dispatch.

**Evidence:** `TaskCompletionController.ts:117–135` returns incomplete for continuation/provider exhaustion before evidence evaluation. Probe: spend the sole continuation, supply a clean terminal with all required criteria passed → `incomplete/CONTINUATION_LIMIT`, remaining work empty. The provider limit has the same ordering problem.

**Required implementation:** no new maker/provider/checker work once its allowance is spent; local bounded deterministic evidence can still establish genuine completion. Remote checker work must have its own available reservation. Do not incorrectly label work completed on the final allowed attempt incomplete.

**Regression:** genuine completion at last continuation/provider attempt → verified; unfinished task → explicit non-success, no further dispatch.

**Requirements:** FR-06/08; design §7.2; AC-03/08.

### T08 — Make Continue share and atomically claim the authoritative lineage ledger [P1, confirmed]

- [x] Reuse the parent lineage ledger, remaining counters, baselines, progress and receipts; bump/fence its generation and permit one active successor.
- [x] Validate parent eligibility and ledger integrity in the trusted model/coordinator boundary.

**Evidence:** `AiTaskExecution.model.ts:331–363` always creates a fresh active ledger with zero counters; `:382–385` merely stores the old ID as `lineage_ledger_id`. Coordinator `:449–460` obtains generation from the new ledger. The parent ledger is neither claimed nor fenced. Two distinct successor submissions can therefore create active descendants with separate ownership. IPC `ai-chat-v2-ipc.ts:2072–2084` checks existence/lineage string but not active/completed/cancelled eligibility. Coordinator `:493–494` falls back to a new budget if the referenced ledger is missing.

**Required implementation:** shared generation-checked claim in one transaction, immutable parent outcome, one active successor, no fresh allowance except an explicitly disclosed Retry. A dangling ledger must fail closed. Cancelled work requires an explicit new request; completed/active parents cannot be indiscriminately continued. Contract/progress and original authority must remain linked.

**Regression:** distinct simultaneous Continue submissions → one active successor, same ledger and generation increment; exhausted parent retains exhausted limits; missing ledger denied; active/completed/cancelled parent handling; transport retry reuses same successor.

**Requirements:** FR-20/21/23/24; AC-25/27/29/32.

### T09 — Start and attach the actual successor after Continue/Retry [P1, confirmed]

- [x] Connect successful successor creation to the engine/conversation lease/stream with its trusted binding.
- [x] Update renderer to the returned successor identity and disclose Retry's new attempt/allowance.

**Evidence:** `ai-chat-v2-ipc.ts:2117–2128` creates a successor then immediately returns; it never dispatches the engine. `AiChatV2.vue:1617` and `:1639` only change badge status and keep the parent ID. These controls cannot perform the user's requested work.

**Regression:** valid parent + Continue → real provider dispatch, successor events and final outcome, original remaining limits; Retry → visibly new bounded attempt and receipt reconciliation before effects; no orphan active row if startup fails.

**Requirements:** FR-14/21/22; AC-16/27/28.

### T10 — Reject/reuse transport submissions before redispatch [P1, confirmed]

- [x] Return the accepted execution/status on reuse; reject changed-hash collisions; do not run the maker again.
- [x] Apply accepted-submission dedup to saved message and preprocessing identity as well as execution rows.

**Evidence:** engine `AIChatQueryEngine.ts:1451–1464` logs reused/conflict and removes consult binding, then continues to `loop.run()` at `:1720`. Execution database dedup alone therefore does not stop duplicate work or changed-scope dispatch. User saving/preprocessing precedes this outcome.

**Regression:** same accepted submission twice → one user message/execution/provider dispatch, no renewed budget or repeated effect; different request hash → `SUBMISSION_CONFLICT` before work. Include all routes, not only verified/template requests. Current mocked tests asserting no binding on reuse/conflict must instead assert no dispatch.

**Requirements:** FR-17/21; AC-26.

### T11 — Atomically finalize manual execution and release its fenced owner [P1, real SQLite reproduced]

- [x] Use the same serialized transaction boundary as other execution writes; commit the terminal outcome and ledger release together.

**Evidence:** `AiTaskExecution.model.ts:566–624` performs separate terminal CAS and ledger release without the creation/scheduled mutex or transaction. Real SQLite trigger failure on ledger update leaves `finalized=1`, outcome incomplete, ledger active. Retry returns ALREADY_FINALIZED and cannot repair the release. A second real probe opens the driver's shared QueryRunner transaction, calls manual finalize (`ok:true`), then rolls back that other transaction: manual finalized/version return to zero. The single terminal CAS is atomic, but the complete durable transaction is not.

**Required implementation:** serialize shared SQLite transaction ownership, conditional outcome+owner release in one committed transaction, no premature success publication, affected-row checks and safe retry. Do not depend on the source comment's hypothetical recovery pass; none currently repairs this state.

**Regression:** injected ledger release failure → complete rollback and retry succeeds; suspended scheduled/create transaction failing concurrently cannot roll back a manual outcome that reported committed success; exactly one competing finalizer wins.

**Requirements:** FR-12/20/24; NFR-10; AC-15/32.

### T12 — Make durable finalization a real terminal-delivery gate [P1, confirmed]

- [x] Stop swallowing finalization failures and dropping recovery ownership before durability.
- [x] Finalize or persist a recoverable interruption for all failed/cancelled/abort paths; carry outcome and final event identity into delivery.

**Evidence:** `AIChatQueryEngine.ts:2851–2864` logs finalization failure and returns; `:2575` deletes the binding; `:2577` still emits complete without task outcome/final identity. The failed result branch `:2702–2742` does not finalize the enrolled execution. Stop `:1813–1828` deletes binding and performs fire-and-forget cancellation; a write failure only logs. Replacement cancellation is similarly asynchronous and occurs only after new task creation. Existing assistant metadata at `:2553` does not carry task outcome.

**Required implementation:** assistant result/checkpoint → committed execution/outcome/accounting → one terminal delivery; failure must surface an explicit persistence error/non-success and retain repair control. Do not treat a generic complete event as evidence that an enrolled task is verified. Preserve distinct USER_CANCELLED/TASK_REPLACED semantics and generation fence all late callbacks; every terminal path must leave an honest durable record.

**Regression:** assistant/execution/ledger save failure produces no success publication; loop failure finalizes failed/interrupted; Stop/replacement write failures are recoverable; late success cannot overwrite cancellation/new task; repeated delivery has stable identity and consumer dedup.

**Requirements:** FR-05/10/12/14/24; NFR-10/11; AC-15/24/25/30/32.

### T13 — Emit task lifecycle/outcome events and reconstruct history [P1, confirmed]

- [x] Implement actual main-process task state emitters through event sink/preload/renderer.
- [x] Restore stored outcomes/progress/actions on history reload and filter stale/duplicate events by execution/generation/identity.

**Evidence:** engine emits `active` at manual enrollment (`AIChatQueryEngine.ts:~1991`) and successor enrollment (`:~1302`), and ONE `terminal` `task_execution_state` event AFTER durable finalization at each of the three `handleLoopResult` gates — complete (`:~3332`), cancelled (`:~3487`), failed (`:~3575`) — carrying the committed outcome + reasonCode so the badge reflects authoritative state, never a speculative pre-finalization value. Response-only turns (no `taskExecutionId`) never emit. The event sink forwards the chunk to the renderer (`ai-chat-v2-ipc.ts` `createEventSink` `case "task_execution_state"`). History reconstruction: `AiTaskExecutionModel.getLatestByConversation` (ordered by `createdAt DESC` on the Auditable base) + `AI_CHAT_V2_TASK_STATE_GET` IPC (AI-gate-first, parse-inside-try/catch so malformed renderer input never crashes the handler, `userSafeError` on module failure) + renderer `getChatV2TaskExecutionState` + `restoreActiveTaskExecution` on conversation switch (watcher `:2285`) and after `loadHistory` (`:3577`). Piece C dedup at `AiChatV2.vue:4815–4857` drops `staleOldExecution` (late chunk for a different executionId on the same conversation — a stale callback racing a Continue/Retry successor) and `duplicateTerminal` (a second terminal for an already-terminal execution — NFR-10 one terminal per execution, no flicker). Continue/Retry successors bypass the chunk path: `continueTaskExecution` adopts the successor id directly (`:1656`) and `attachChatV2SuccessorStream`'s `onTaskExecutionState` callback (`:1667`) updates the badge, so a successor chunk on the main stream is correctly dropped as stale.

**Regression:** `AIChatQueryEngineTaskStateEmit.test.ts` (8 tests) — active at enrollment; response_only no emit; flag-off no emit; terminal AFTER complete/cancelled/failed event with outcome+reasonCode; NFR-10 exactly one terminal per execution; full active+terminal lifecycle. `ai-chat-v2-task-state-get-ipc.test.ts` (7 tests) — AI-gate-first denial; invalid-JSON denial (no throw out of handler); missing-conversationId denial; null for response-only answers; row projection for finalized execution; undefined reasonCode/outcome for in-flight; userSafeError on throw (no `ai_task_execution`/`sqlite_locked` leak). `AiChatV2TaskStateReconstruction.test.ts` (5 tests) — no badge for response-only switch; terminal restoration with reasonCode tooltip; active in-flight restoration; stale-execution chunk dropped; terminal replay-once dropped.

**Requirements:** FR-13/14/22/24; NFR-10/11; AC-16/24/25/27/32.

### T14 — Render terminal outcomes honestly [P1, confirmed]

- [x] Pass semantic task outcome to the badge and select label/color/actions from that outcome.

**Evidence:** `TaskExecutionStatusBadge.vue` now takes an `outcome?: TaskOutcome` prop. At `status: "terminal"`, color + icon + label derive from the OUTCOME via `terminalOutcomeConfig` (only `verified_complete` → success-green + checkered flag + "completed"; `incomplete`/`failed`/`timeout` → error + alert icons + honest labels; `needs_user_input`/`blocked_by_policy` → warning; `cancelled` → default-grey). Absent outcome at terminal keeps the legacy green "completed" so older callers do not regress. Non-terminal status ignores outcome (no premature honest label while still in flight). `AiChatV2.vue:15` passes `:outcome="activeTaskExecution.outcome"` through to the badge. Six-language i18n keys `outcome_*` added to en/zh/es/fr/de/ja; AIChatHistoryI18n parity test passes (7/7).

**Regression:** `TaskExecutionStatusBadge.test.ts` (20 tests, +11 T14): green+completed for verified_complete; no-outcome backward-compat green; `it.each` over all 6 non-success outcomes asserts non-green + honest label fragment; the audit's named worst case (terminal incomplete + CONTINUATION_LIMIT) is never green "completed" and still surfaces the reason tooltip; non-terminal ignores outcome; missing-i18n-key humanized fallback does not leak the raw key path. Chunk-routing + reconstruction component test badge stubs now declare `outcome` + `data-outcome` so the prop threading is asserted end-to-end (reconstruction test asserts `data-outcome="incomplete"` on the restored terminal badge).

**Requirements:** FR-13/15/22; AC-16/21/27/32.

### T15 — Enforce goal ownership and preparation/approval lifecycle [P1, confirmed gap]

- [x] Freeze actual goal vs standalone owner and validate it at live decisions/finalization. *(commit e116fbed — enrollment detects active conversation goal → `completionOwner:"goal"` vs `"standalone"` (one semantic owner); commit 43cd896f — exported `assertOwnership` + `readCurrentLeaseGeneration` standalones wired into the engine consult closure (stale lease → `yield_owner` → loop break, no dispatch) and the finalization gate (stale lease → skip finalizeManual, no unconditional ledger release); missing ledger → fail-closed reject.)*
- [x] Enroll preparation stages and freeze executable contract only after actual approved scope, keeping one execution and spent limits. *(commit 6624bc78 — preparation route enrolls (completionOwner + null contract, never verifies executable work); `hasApprovedTaskTemplate = planState?.status === "approved"` threaded into the resolver so an approved plan → `task_verified` route → `mode:"verified"` freeze against linked actual messages; `awaiting_approval`/`pendingPermission` → preparation route with contract null.)*

**Evidence:** engine always enrolls `completionOwner:"standalone"` at `:1346`, while `goalAutoContinue` at `:1708` still uses any active conversation goal (`:483–484`). Response-only routes bypass policy entirely, allowing unrelated goals to retain legacy takeover. Preparation is skipped at `:1314`; the comment says it enrolls when the user re-sends after approval, which contradicts same-execution preparation. Existing lease-generation/assertOwnership library functions are not consulted by the engine/loop completion closures. Resume paths carry a binding but do not establish the missing contract/owner/approval state.

**Regression:** unrelated active goal + ordinary question → normal single answer; real goal iteration has exactly one semantic owner; plan draft stop waits, never verifies executable work; approved plan freezes against linked actual messages; permission/question/approval retains execution, policy, evidence, denied authority and remaining limits; actual Stop during checking aborts all work.

**Requirements:** FR-01/10/20/21/22; NFR-01/07; AC-06/07/14/22–25/31.

### T16 — Freeze accepted policy across flag rollback [P1, confirmed]

- [x] Use accepted execution policy for in-flight handling; runtime flag controls new enrollment, not unchecked fallback of accepted work.

**Evidence:** `AIChatQueryLoop.ts:1371`, `AIChatQueryEngine.ts:2798`, Stop `:1807`, and `ScheduledLoopEventSink.ts:127` recheck the mutable flag. Turning it off after enrollment skips consult/finalization/cancellation, and scheduled sink `:131–137` restores blind completed mapping.

**Regression:** flag-on acceptance, then flag-off midstream/check/wait → frozen handling or explicit incomplete/cancelled; never legacy verified/success conversion. Fresh flag-off submissions retain compatibility. Quiesce-before-downgrade behavior must be documented/tested.

**Requirements:** FR-01/05/12; NFR-12; design §17; AC-12/32.

## B. Additional correctness TODOs in current code

### T17 — Validate unique/source-anchored normalized contracts [P2, reproduced]

- [ ] Reject duplicate criterion IDs and empty source anchors; check offsets against actual approved message content.
- [ ] Normalize or reject unknown fields before hashing and return exactly the normalized schema representation.

**Evidence:** `aiTaskExecutionTypes.ts:108` uses an unrestricted criteria array; `:40` permits empty sourceRefs. Freeze at `TaskCompletionContractService.ts:71–83` only checks supplied reference membership/range direction; `:122–123` discards schema parse output. Probes accept two required `rec` IDs for different campaigns and a required criterion with no sourceRef. A criterion containing an extra JSON property freezes but schema load strips it, after which verifyHash returns false. Duplicate IDs let one passed criterion ID satisfy distinct required criteria despite another failure.

**Regression:** duplicate targets/IDs with only one passing rejected; empty/out-of-bounds/unapproved refs rejected; schema/JSON round trip retains valid hash, equivalent normalized contracts hash consistently. **FR-01/03/18/19; AC-11/20/21.**

### T18 — Broaden conservative task resolution beyond English imperative lists [P2, reproduced]

- [x] Distinguish definition questions from fresh-state questions and handle supported-language task/deliverable phrasing with structured analysis. *(commit T18: `TaskRequestResolver` fresh-state-question check — a question opening with a definition stem ("what is ...") that carries a fresh-state signal (status/latest/current/progress/now/update, or CJK 状态/最新/当前/进度/现在/更新) is classified task_best_effort BEFORE the definition check wins; "What is the latest deployment status?" / "最新的部署状态是什么？" enroll, "What is a deployment?" / "什么是部署？" remain response_only. CJK support: CJK polite prefixes (请/麻烦/帮我...), CJK leading action stems (保存/收集/发送...), CJK quantity markers (<N>个/件/名/条/位) as concrete-target signals, CJK polite imperative (SOV verb-final "...連絡先を保存してください"), CJK fullwidth ？. Latin-script imperatives for es/fr/de (guarda/enregistre/speichere). `TaskCriteriaResolver` agrees: CJK count pattern (`record_count` with minimum/targetId, CJK-aware slugifyTarget preserving CJK nouns), CJK operation pattern, CJK 和 conjunction splitting; "Create three launch tweets" compiles a structured qualitative criterion (not the fallback).)*

**Evidence:** resolver `TaskRequestResolver.ts:124–125` classifies matching definition prefixes before fresh-information analysis; fallback `:147` excludes unmatched wording. “What is the latest deployment status?”, “Create three launch tweets”, and “请保存100个合格联系人。” all currently return response_only and bypass enrollment. “What is a deployment?” should remain response-only.

**Regression:** paired ordinary definition/fresh-state cases, imperative and interrogative material tasks, conjunctions, all supported languages; ambiguous requests clarify or best-effort, never silently bypass actionable work. **FR-17/18/19; AC-19/20/21.** — ALL COVERED: `TaskRequestResolver.test.ts` 38/38 (T18a definition-vs-fresh-state 6 incl. paired controls; T18b supported-language 12 — en zh es fr de ja + interrogative + AC-21 CJK ambiguity control; T18c compiler agreement 3 — structured record_count, CJK conjunction 2 criteria, clean deliverable), `TaskCriteriaResolver.test.ts` + `TaskCriteriaResolverRegression.test.ts` 23/23, tsc clean, full service suite green except the pre-existing `HookDispatcher.skillRef` parallel-load flake (passes in isolation).

### T19 — Fix scheduled failure-streak accounting and validate linked records [P2, confirmed]

- [ ] Reset consecutive failure streak on verified success; preserve cancellation's no-increment/no-reset semantics.
- [ ] Validate execution ↔ run ↔ task ↔ schedule ↔ occurrence linkage and affected rows inside the finalization transaction.

**Evidence:** `AiTaskExecution.model.ts:795–802` only increments when failure is true; verified success does not reset streak, unlike `ScheduleTask.model.ts:869–870`. A failure, success, failure sequence can trigger premature repeated-failure termination. Model `:769–821` updates supplied run/schedule IDs without checking their link to execution or update counts; the supplied idempotency key is not validated.

**Regression:** streak 2 → verified success resets to 0 → next incomplete becomes 1; cancellation retains 2; unknown action increments once and pauses; nonexistent/mismatched run/schedule rejected with no partial update or wrong-schedule count. **FR-12/24; AC-04/05/10/15/32.**

### T20 — Preserve checkpoints/evidence and count real progress [P2, confirmed]

- [x] Merge final outcome into bounded schema-versioned execution checkpoint instead of replacing existing state. *(commit 32bc7151 — bounded `taskFinalizationCheckpointSchema` schemaVersion 1 + `buildFinalizationCheckpointFields`; `finalizeExecution`/`finalizeScheduledExecution` MERGE finalization facts under the stable `finalization` key into the EXISTING `execution_state_json`, preserving evidence rows, shadowDecision, baselines, contractHash; corrupt/non-object legacy preserved under `__legacy`.)*
- [x] Derive no-progress from relevant evidence revisions/results across text-only and alternating work, and persist it through resumes. *(commit f67cdd6e — per-(toolName,args) result fingerprint MAP replaces the single-previous-round comparison so A/B/A/B alternation with unchanged results increments the streak on every repeat; `recordAssistantTextRound` + `recordAssistantTextProgress` closure wires text-only goalTextStop rounds into the detector; discovery traffic stays skipped entirely; RESULT_NOISE_KEYS strip timestamps/random IDs. Persistence: the streak COUNTER persists in the ledger row via `resurrectFromLedger` so a post-resume consult landing before any fresh round is gated by the pre-pause streak; the fingerprint MAP is detection state and restarts empty, so the first post-resume round is a fresh sighting that resets — the persisted counter gates the resume-boundary consult, not fossilize the streak against observed work. 40/40 tests pass.)*

**Evidence:** model `:530–538` and `:665–673` replace state JSON with finalization fields, dropping prior evidence/baselines/progress. `TaskProgressTracker.ts:185–193` compares only adjacent tool fingerprints; changing arguments or alternating equally useless operations resets streak. Discovery traffic is skipped entirely; repeated text promises never update the streak. The engine constant evidence revision is not a source revision.

**Regression:** terminal/Continue retains baselines and source evidence; A/B/A/B unchanged-results traffic, repeated text promises, discovery-only rounds, timestamps/random IDs do not establish progress; genuinely relevant new evidence resets streak; changed error may inform next allowed action but does not renew allowance. **FR-03/09/10/24; AC-05/06/27/29.**

### T21 — Propagate actual finish reasons, terminal provenance and restrictions [P2, confirmed gap]

- [x] Build candidates from actual accumulator/transport diagnostics, not hardcoded trustworthy terminal flags. *(commit [T21a] — new `candidateDiagnostics.ts` pure helper derives provenance/streamTerminalSeen/safetyRestriction from the ACTUAL finishReason + content refusal probe via `deriveCandidateDiagnostics`: recognized provider terminals (stop/length/content_filter/tool_calls/function_call) → provider+seen; missing/unrecognized terminal → unknown+!seen; transport error → unknown+!seen; content_filter finish OR leading-text refusal opener → safetyRestriction=true (leading-text only, so legitimate "can't" mid-sentence is not flagged). Wired at ALL FOUR previously-hardcoded sites: `TaskLoopConsult.consultLoopEndCandidate` (loop consults — caller safetyRestriction floor OR'd with derived), engine fallback `finalizeManualAtCompleteGate`, scheduled sink fallback `consultPolicyOnComplete` — replacing the hardcoded "provider terminal, no restriction" stamps. 15/15 helper tests + 5 consult-seam tests pass.)*
- [x] Map length/truncation/filter/auth/quota/missing terminal distinctly and hold recoverable errors until controller decision. *(commit [T21b] — controller `decide()` independently maps `finishReason === "content_filter"` → blocked_by_policy CONTENT_RESTRICTED (defense-in-depth, NOT relying on the manually supplied safety boolean); `incompleteReasonCode` adds distinct branches AFTER the provenance/boundary/streak precedence (so synthetic/budget-cap/no-progress-streak still win): recoveryReason auth→AUTH_FAILURE, quota→QUOTA_EXHAUSTED, non_recoverable→NON_RECOVERABLE; finishReason length→OUTPUT_TRUNCATED (distinct from CONTINUATION_LIMIT and NO_PROGRESS), error→PROVIDER_ERROR; `recoveryReason` threaded through `DecideContext` from the engine's recovery layer. Recoverable reasons (network/timeout/rate_limit/overload/server_error/output_limit/context_overflow/media_overflow/model_unavailable) do NOT become permanent codes — they fall through to STREAM_INCOMPLETE/NO_PROGRESS, held for controller decision. Scheduled sink: `case "error"` now consults the controller when policyAccepted (`consultPolicyOnError` — holds for decision instead of first-wins blind `failed`), builds the candidate from transport diagnostics (hadTransportError → unknown+!seen), captures the `recovery_status` reason per turn and threads it as `DecideContext.recoveryReason`; controller failed decisions preserve the transport errorMessage; consult error → missing_outcome (AC-17). Flag-off/no-binding keeps blind `failed` byte-identical. 7 controller tests + 11 sink tests pass.)*

**Evidence:** `TaskLoopConsult.ts:137–147` and engine fallback `AIChatQueryEngine.ts:2804–2815` hardcode provider provenance, terminal seen and no safety restriction. Controller gates the safety boolean but does not independently handle finishReason content_filter. Scheduled sink `:146–150` first-wins error finalization remains separate from a recovery decision. A unit test's manually supplied terminal boolean is not proof of actual stream provenance.

**Regression:** real accumulator/loop synthetic/missing terminal, length with partial arguments, content_filter and refusal, permanent auth/quota errors, recoverable early error → distinct honest outcome, no fabricated calls/bypass and exactly one post-durability terminal event. **FR-05/06/16; NFR-06/10/11; AC-12/30.** 118/118 T21 tests pass (15 helper + 29 consult + 43 controller + 31 sink); tsc clean; full service suite 2751/2753 (2 pre-existing parallel-load flakes pass in isolation).

**Evidence:** `TaskLoopConsult.ts:137–147` and engine fallback `AIChatQueryEngine.ts:2804–2815` hardcode provider provenance, terminal seen and no safety restriction. Controller gates the safety boolean but does not independently handle finishReason content_filter. Scheduled sink `:146–150` first-wins error finalization remains separate from a recovery decision. A unit test's manually supplied terminal boolean is not proof of actual stream provenance.

**Regression:** real accumulator/loop synthetic/missing terminal, length with partial arguments, content_filter and refusal, permanent auth/quota errors, recoverable early error → distinct honest outcome, no fabricated calls/bypass and exactly one post-durability terminal event. **FR-05/06/16; NFR-06/10/11; AC-12/30.**

### T22 — Make operation claim/create scaffolding actually race-safe [P1 claim / P2 create; controlled interleaving reproduced]

- [ ] Replace read/check/save claim-generation handling with conditional atomic update and legal state transitions.
- [ ] Reload and validate the unique-key winner on concurrent create collision.

**Evidence:** `AiTaskOperation.model.ts:137–160` can let two generation-0 claimers both return success and save generation 1; `:116–117` catches uniqueness collision and returns alreadyExists without checking changed intent/execution/tool against the winner. Controlled actual-method probes reproduce both. Claimed timestamp and sequential changed-intent detection have been fixed; concurrency remains.

**Regression:** simultaneous claim → one winner; stale generation/illegal terminal regression rejected; concurrent same key + different intent → conflict; identical intent → receipt reuse. These are defects in landed operation scaffolding. Consequential action enrollment remains disabled/deferred until the full T23 guard exists. **FR-11; design §10.1/10.2; AC-09/10/28.**

## C. Unimplemented requirements and delivery/rollout gates

### T23 — Guard consequential effects and reconcile across executions [Slice 3, incomplete]

- [ ] Implement TaskOperationGuard at actual tool/effect dispatch with stable domain/target/intent/ordinal identity, native dedup/authorization, fenced claim → dispatch → receipt/unknown state machine.
- [ ] Query pending operations; reuse confirmed receipts; unknown action outcome blocks blind replay even in another run/conversation; only evidenced no-effect permits retry.
- [ ] Implement bounded background-job polling/backoff and distinguish job-start from requested job completion.
- [ ] Test lost send response, crash before receipt, uncertain operation, recurring authorized repeats, explicit Retry, changed conversations, duplicate dispatch and native status lookup limitations.

No universal exactly-once guarantee is implied. These are legitimate deferred Slice 3 items, but automatic recovery currently has no risk gate demonstrating that only read-only/data/text-safe work is enrolled. Do not enable automatic consequential recovery until the guard and fault tests pass. **FR-11/12/21/24; NFR-07; AC-09/10/28.**

### T24 — Implement restart interruption, repair and delivery reconciliation [missing; not only an effect feature]

- [ ] Consume unfinished executions/occurrences at startup: mark interrupted, preserve state/receipts/limits, fence stale callbacks and do not auto-replay actions.
- [ ] Reconcile stranded owners and committed outcomes pending delivery; use stable final identity/outbox or equivalent durable delivery dedup.
- [ ] Add restart/fault tests at reservation/dispatch/receipt, assistant-save/finalization, commit/notification boundaries for both origins.

`getUnfinalizedExecutions()` exists but has no startup recovery consumer. A persisted final_event_identity alone does not implement delivery. Restart/history correctness is required for ordinary Slice 2 tasks as well as Slice 3 effects; do not defer all manual interruption handling merely because receipt reconciliation is later. **FR-14/21/24; NFR-05/10; AC-13/16/27/28/32.**

### T25 — Complete diagnostics and external adapters [deferred owners]

- [ ] AI server `/Users/cengjianze/project/aifetchserver`: preserve provider/normalized/synthetic/error endings; optional capability-negotiated diagnostics IDs/provider/model/failover/usage/terminal origin; safe redacted logs and tests.
- [ ] Desktop: consume optional provenance/correlation while remaining compatible with absent metadata; never trust server finish_reason as task completion.
- [ ] Slice 4: legacy schedule-page and non-Chat-V2 adapters plus compatibility tests. Do not claim these paths covered by Chat V2 work.

The server repository was not modified or fully audited in this pass. Desktop correlation/provenance integration remains missing in this worktree; server completion cannot be inferred from its absence. **FR-16; NFR-06/11; technical design §16.**

### T26 — Replace mock-only acceptance claims with real flow tests and rollout evidence [incomplete]

- [ ] Add composed/real-module and fake-stream tests that avoid mocking away resolver/contracts/evidence/budget/finalization under test.
- [ ] Add actual scheduled recovery, successful valid-parent Continue/Retry, Stop during checker, permission/question/approval, reload and stale-event E2Es.
- [ ] Fault injection: reservation persistence, actual dispatch/receipt boundaries, finalization rollback, restart-before-delivery, zero duplicate effects and one schedule increment.
- [ ] Instrument manual/scheduled route/risk metrics, evidence completion/recovery/incomplete reasons, actual/estimated usage, latency/waits, conflicts and reconciliation; measure bounded read-only shadow baseline before rollout.
- [ ] Run broader main/module/E2E suites and lint gates for fixes, server tests for server changes, rollback tests, and document historical status preservation.

Current `AIChatQueryEngineEnrollment` tests mock resolver/coordinator; runner tests mock engine/controller outcomes; badge flow tests inject state and stub the real badge. `scheduled-incomplete-recovery.spec.ts` tests only IPC denial cases; `manual-cancel-during-checking.spec.ts` stops a delayed stream, never waits for a real checker or asserts execution database cancellation. Their passing results are valid for those limited scenarios, not proof of the named acceptance flows.

**Requirements:** FR-15 and PRD rollout §12; technical design §15/17/18; every AC assigned test layer.

### T27 — Reconcile the existing implementation TODO with actual coverage [documentation, incomplete]

- [ ] Update `TASK-COMPLETION-POLICY-TODO.md` after fixes/revalidation with implemented, live-wired, tested and deferred states separately.

Its opening still says Slice 1 only, no live callsites and all ACs failing live, while later entries mark all Slice 2 items complete. It also calls the emitter a later phase while checking the renderer/history requirement complete, and checks budget work complete while acknowledging missing persistence. These contradictory status claims should not be used as release evidence. Preserve old audit history but date/scope the current verdict and link this review.

## D. Complete requirement traceability at the audited HEAD

`Partial` = useful implementation exists but the complete requirement is not met. `Missing` = required behavior is absent or represented only by a stub/scaffold. `Deferred` = planned later slice/other owner; still not complete against the full PRD. `Supported` is deliberately scoped to inspected architecture rather than a guarantee of all possible runtime cases.

### Functional requirements

| Requirement | Status | Remaining work / evidence |
| --- | --- | --- |
| FR-01 Preserve objective/frozen policy | Partial | T01/T15/T16/T17: contract generation, approved-plan freeze and policy rollback. |
| FR-02 Execution-local completion | Partial | T01/T02/T03: actual count, observation/report, artifacts and scope. |
| FR-03 Authoritative evidence | Partial, unsafe observation adapter | T03/T17/T20: maker phrase is not retrieval, real evidence/baselines missing. |
| FR-04 Qualitative/unknown | Partial | T04/T07: schema/reference/timeout/abort and evidence-first budget handling. |
| FR-05 Application decision boundary | Partial | T01/T02/T12/T16/T21: real enrollment, scheduled upstream recovery, durable terminal gate. |
| FR-06 Distinct stop handling | Partial | T04/T07/T12/T21: actual restrictions/provenance and bounded abort. |
| FR-07 Evidence-based continuation | Partial | T01/T02/T03/T06: real unmet work, progress and reservation identities. |
| FR-08 Execution-wide budgets | Missing live enforcement/persistence | T05/T06/T07/T08. Tested in-memory budget is insufficient. |
| FR-09 Results-based stalls | Partial | T20: relevant progress, text/discovery/alternating traffic and persistence. |
| FR-10 Same-execution resume | Partial | T05/T12/T15/T20: binding carried, but limits/source/evidence/pause durability incomplete. |
| FR-11 Consequential actions | Deferred Slice 3; scaffolding bugs | T22/T23. |
| FR-12 Honest persisted outcomes/accounting | Partial | T02/T11/T12/T19/T21/T23. Scheduled transaction exists; manual/delivery/accounting gaps remain. |
| FR-13 Visible execution/outcomes | Missing live emitter; incorrect terminal badge | T13/T14. |
| FR-14 Actions/notifications | Partial | T09/T12/T13/T24: successor dispatch, safe Stop and durable one-time delivery. T09 landed — created successor dispatches the engine with the trusted binding + renderer adopts the successor identity and attaches the successor stream; T12/T13/T24 remain. |
| FR-15 i18n/UI tests | Partial | Six-language parity and components pass; T14/T26 honest labels and real flow coverage missing. |
| FR-16 Reasons/provenance | Partial — desktop side landed (T21) | T21: candidates derive provenance/streamTerminalSeen/safetyRestriction from actual finishReason/content diagnostics (candidateDiagnostics.ts) at all 4 consult sites; content_filter→CONTENT_RESTRICTED; length/error/auth/quota/non_recoverable→distinct codes; sink error consult holds for decision. T25 server-side optional metadata remains. |
| FR-17 Default manual protection | Partial | T01/T18: recognized tasks enroll without usable contracts; other task phrasing bypasses. |
| FR-18 Conservative intent | Partial | T01/T17/T18: structured multilingual analysis and actual source validation missing. |
| FR-19 Usable manual contracts | Missing live generation; library partial | T01/T03/T17. |
| FR-20 One execution/owner | Partial | T08/T15: shared lineage claim and actual goal ownership/fencing missing. |
| FR-21 Preparation/follow-ups | Partial | T08/T09/T10/T15/T23: preparation same execution, successor work, no replay. T09 landed — Continue claims lineage and dispatches the successor through the engine with the trusted binding; Retry mints a fresh bounded attempt on the retry channel; T10 dedup prevents replay of the same submission. T15/T23 remain. |
| FR-22 Honest manual UX | Partial | T04/T09/T12/T13/T14: actual checker Stop, outcome labels, running successor. T09 landed — the running successor's identity and task_execution_state chunks drive the badge (no parent-id dead-air); T04/T12/T13/T14 remain. |
| FR-23 Manual execution-wide limits | Missing live ledger enforcement | T05/T06/T08. |
| FR-24 Durable manual outcomes | Partial | Independent manual rows exist; T08/T11/T12/T20/T23/T24 remain. |

### Nonfunctional requirements

| Requirement | Status | Remaining work / evidence |
| --- | --- | --- |
| NFR-01 Single writer/priority/coalescing | Partial | Existing conversation coordinator preserved; T08/T12/T15 successor/owner races remain. |
| NFR-02 Bounded abortable verification | Partial | T03/T04/T05/T06: real checks have no propagated timeout/abort/complete dispatch accounting. |
| NFR-03 Model/Module DB architecture | Supported for inspected new persistence paths | Model/Module access and worker guards present, module tests pass; preserve this architecture in fixes. |
| NFR-04 AI enable gating/checker recheck | Partial | New successor IPC gates before parsing; real checker entitlement recheck not wired (T04). |
| NFR-05 Restart interruption/no replay | Missing | T24; effect reconciliation also T23. |
| NFR-06 Stream compatibility/optional metadata | Partial — T21 landed | Default-off compatibility seams exist; T21: finishReason/provenance/safetyRestriction derived from actual accumulator state + optional metadata (finishReason nullable, missing terminal → unknown); T25 server-side optional diagnostics remains unconnected. |
| NFR-07 Same workspace/policy/authority | Partial | Existing permission infrastructure retained; T15/T23 approved scope and receipts not complete. |
| NFR-08 Bounded/redacted untrusted evidence | Partial | Summary bounds exist; T03/T04 trusted scope/reference validation and checker isolation contract missing. |
| NFR-09 No toggle/goal/schedule/prior tool dependency | Partial | T01/T18: automatic seam exists but does not complete recovery coverage. |
| NFR-10 One durable terminal/fencing | Partial | T08/T11/T12/T13/T24. Stable stored identity alone does not implement delivery/dedup. |
| NFR-11 Separate response/task/goal/occurrence semantics | Partial | Types added; T12/T13/T14/T15/T21 serializers/UI do not carry distinctions throughout. |
| NFR-12 No unchecked resolution/rollback success | Not satisfied | T01/T16: catch/flag fallback to legacy behavior. |

### Acceptance criteria

This table assesses required end-to-end behavior against source and tests. `Not established` does not mean the current test suite fails; it means passing isolated/mocked tests do not demonstrate that acceptance criterion. Known contradictions are called out explicitly.

| AC | Current status | Required verification / TODO |
| --- | --- | --- |
| AC-01 54/100 then stop | Not satisfied | T01/T02/T03: actual count and same-execution continuation. |
| AC-02 First promise/no tool | Not satisfied | T01: no criteria means no recovery. |
| AC-03 All evidence passes | Partial library, cap defect | T03/T07: real evidence and no extra maker call. |
| AC-04 Running-job observation | Not satisfied | T02/T03: fresh observation/report, recurrence continues. |
| AC-05 No-progress traffic | Partial | T06/T20: relevant evidence stalls and bounded recovery. |
| AC-06 Permission grant retains state | Binding carry only; not established | T05/T15/T20: full remaining ledger/source/evidence preserved. |
| AC-07 Denial/input restriction | Existing controls; policy flow not established | T15/T26: persist denial/no workaround/wait behavior. |
| AC-08 Total budgets | Not satisfied | T05/T06/T07: actual dispatch/resume accounting and evidence completion at cap. |
| AC-09 Lost send response | Deferred Slice 3 | T22/T23: reconcile receipt, no resend. |
| AC-10 Unresolved send | Deferred Slice 3 | T23/T19: unknown prevents replay and pauses schedule once. |
| AC-11 Invented checker evidence | Not satisfied | T03/T04/T17: reject malformed/referenced false pass. |
| AC-12 Filter/error/truncation | Landed through unit + consult-seam tests (T21) | T21: content_filter finishReason → blocked_by_policy (controller derives independently of the safety boolean); refusal-opener content → safetyRestriction; length → OUTPUT_TRUNCATED; error → PROVIDER_ERROR; real accumulator diagnostics (missing terminal → unknown+!seen); consult-seam tests assert derivation from actual finishReason/content. T26 real-stream E2E remains. |
| AC-13 Restart/notification gap | Missing | T24/T23: interrupted checkpoints and delivery/effect dedup. |
| AC-14 Chat/goal ownership | Not satisfied | T15: no unrelated-goal takeover or stacked loops. |
| AC-15 Persistence failure | Not satisfied manual; scheduled tests partial | T11/T12/T19: no success event/count before committed linked result. |
| AC-16 History/all languages/actions | Not satisfied | T09/T13/T14/T24: persisted reconstruction and outcome-specific labels. |
| AC-17 Plain manual save100 | Not satisfied | T01/T03: automatic real verification/recovery, zero manual schedule accounting. |
| AC-18 Empty/“I will check” | Not satisfied | T01/T03: first no-tool task recovery. |
| AC-19 Question vs fresh task | Partial resolver; known missed questions | T18/T03. |
| AC-20 Text and multipart | Not satisfied | T01/T03/T17: tool-free text pass and every part required. |
| AC-21 Resolver/checker failure | Partial, unsafe checker/fallback | T01/T04/T17/T18: explicit unknown/clarification/unverified. |
| AC-22 Permission/question/approval resume | Not established | T05/T15: same execution and actual approved authority. |
| AC-23 Draft plan stop | Not established | T15: plan draft cannot satisfy executable objective. |
| AC-24 Stop during checker/recovery | Delayed-stream Stop passes; checking unproved | T04/T12/T26: actual in-flight checker abort and durable cancellation. |
| AC-25 Replacement fences owner | Partial; asynchronous fencing/state gaps | T08/T12/T13/T15: generation checks/no old goal/events. |
| AC-26 Same submission retry | DB dedup passes; engine violates no redispatch | T10. |
| AC-27 Continue remaining allowance | Partial — successor dispatch landed | T05/T08/T09/T20: shared ledger, one active running successor. T09 landed — Continue dispatches the engine with the trusted binding and the renderer attaches the successor stream; the successor identity is tracked, not the parent's. T05/T08/T20 remain for the remaining-allowance ledger enforcement + alternating-work accounting. |
| AC-28 Effect lost/restart/new run | Deferred Slice 3 | T22/T23/T24. |
| AC-29 Compaction/fallback/traffic totals | Not satisfied | T05/T06/T20. |
| AC-30 Recoverable pre-decision error | Landed (T21) | T21: recoverable recovery reasons (network/timeout/rate_limit/overload/server_error/output_limit/context_overflow/media_overflow/model_unavailable) do NOT become permanent codes — fall through to STREAM_INCOMPLETE/NO_PROGRESS; only auth/quota/non_recoverable map to distinct permanent codes; sink error consult holds for controller decision instead of blind failed; no fabricated recoveryReason when no recovery_status fired. T26 real-flow E2E remains. |
| AC-31 Unrelated active goal | Not satisfied | T15. |
| AC-32 Manual terminal/races/reload | Partial CAS foundation; known failures | T08/T11/T12/T13/T14/T19/T20/T24. |

## E. Fixed foundations retained from the update

Do not reopen the old blanket “no live callsites” finding: engine and loop consult/finalize/control seams now exist. Current execution creation is transactional, scoped submission uniqueness/dedup is implemented, execution finalization uses an atomic conditional terminal-row update, shadow decision writes are CAS-protected, hard-cap settings are clamped/persisted, claimed_at and sequential intent-conflict checks are present, deep-copy/hash helpers and actual evidence-ID result plumbing exist. Six-language keys, component tests and the three limited E2E cases pass.

Those improvements are real. T10 distinguishes engine redispatch from already-fixed database dedup; T11 distinguishes the atomic terminal-row CAS from still-nonatomic whole finalization; T22 distinguishes sequential intent checks from unresolved concurrent collision/claim races. Review each fix against these narrower findings.

## F. Recommended completion order and release exit criteria

1. Fix persistence/identity/budget fundamentals: T05/T06/T07/T08/T10/T11/T12/T16/T17/T19/T20. These are prerequisites for trusting recovery.
2. Complete both origins' usable contracts/evidence and shared running-loop behavior: T01/T02/T03/T04/T15/T18/T21.
3. Connect usable successor execution and honest lifecycle/history UI: T09/T13/T14/T24; ship matching six-language and real-flow tests.
4. Close T22/T23 before enrolling consequential recovery; keep later adapters/server diagnostics explicitly tracked in T25.
5. Run real composed/fault/E2E acceptance gates, establish shadow/rollout metrics, update coverage claims: T26/T27.

- [ ] Every Slice 2 release AC passes its assigned real integration/UI layer for **both manual and scheduled** paths.
- [ ] No enrolled nonverified outcome is shown, persisted, notified or counted as success.
- [ ] No hidden budget renewal; all dispatched work is durably reserved and monotonic through resume/Continue.
- [ ] Stop/replacement abort checker and recovery, fence old callbacks, and leave an honest durable result.
- [ ] History/restart correctly restore progress, remaining work and safe actions in all six languages.
- [ ] Consequential recovery remains gated until AC-09/10/13/28 and receipt/fault tests pass.
- [ ] Flag rollback cannot convert accepted unfinished work to unchecked success; historical completed rows are not retroactively relabeled verified.

Closing checklist boxes requires linking the fix commit and its actual regression result. This audit intentionally leaves application fixes to a subsequent implementation task.
