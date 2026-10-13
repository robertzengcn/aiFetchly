# Task completion policy — new implementation audit and TODO

Date: **2026-10-13** (Asia/Shanghai).
Worktree: `/Users/cengjianze/project/aiFetchly/.claude/worktrees/task-completion-policy-v1-slice1`.
Baseline HEAD: `4e139fcf65ad4cd85d3f78306d5c0fcd5b83b660`.

**Scope includes the 40 uncommitted files present at audit start**, not only the committed implementation. Their binary Git diff against HEAD had SHA-256 `4e98a291a7e07144a911fe3b44cb485339a6ceb2d8172f540b857b80d216322f`. Source lines below refer to those working files. Application code and existing TODO documents were not edited by this review.

Requirements: [shared completion PRD v3.0](scheduled-loop-premature-stop-recovery-advice.md), [technical design v2.0](scheduled-loop-premature-stop-recovery-technical-design.md), and the related query/goal/scheduled-loop contracts they reference. The Oct-7 audit and its subsequent checked-off implementation notes are historical evidence, not proof that a live flow now passes.

**Post-audit source reconciliation:** while this report was being handed back, merge `102ca0df5` and application commit `7073d40b3f4505e1fac8b9346980b371d6741807` landed. The application commit records the 40 working-file changes already included in this audit. The intervening merge additionally changes tool-result recovery/compaction, schedule-active checks and translations. Its relevant loop/runner/factory/IPC delta was reviewed; it does not resolve B01–B21. Most reviewed dirty files have identical contents; loop/runner line numbers can shift after the merge. Findings retain the original snapshot line references. Fresh post-merge full service tests passed **2,823 tests, 6 skipped, 263 passing files and 1 skipped file** with two workers; component tests passed **476 tests in 71 files**, and `yarn typecheck` passed. This later green run is distinct from the initial four failures and their serial rerun. Original module/IPC/E2E/Vue results below belong to the pre-merge snapshot and are not relabeled as post-merge checks.

## Verdict

**The complete PRD is not implemented, and confirmed bugs remain.** Many substantial fixes have landed since the previous audit. Both origins now have contracts and running-loop bindings; Continue/Retry dispatches work; task events and outcome-aware badges exist; manual finalization is transactional; Continue shares a ledger; contract schema/hash validation and operation row CAS have improved.

However, ordinary manual tasks still cannot become verified through the normal best-effort route; contract compilation can omit requested work; evidence providers can use unrelated records; finalization failure can still publish intended success; live terminal state can be lost by renderer listener cleanup; and operation recovery can authorize a repeated confirmed/uncertain effect. Execution-wide budgets remain incomplete at actual dispatch. These are release blockers for the proposed completion guarantee.

This is a requirements and correctness review, not a claim that every possible bug was discovered. `P1` means block enabling the affected recovery flow; `P2` means fix before claiming the affected requirement complete. Confidence is calibrated 1–10. Static findings have concrete triggers; reproduced findings identify their test method. Operation probes use controlled dependencies unless explicitly marked real SQLite; no email or other external effect was sent.

## Fresh verification

| Check | Result | Limits of the evidence |
| --- | --- | --- |
| Entire service suite, `vitest.service.config.mjs`, 4 workers | **2,811 passed, 4 failed, 6 skipped; 259 passing / 3 failing / 1 skipped files** | The initial broad run is not green. See B22. |
| Serial rerun of the three failing files | **51 passed, 3 files** | All four initial failures disappeared without application edits; retain a test reliability TODO rather than declaring a proven product regression. |
| Execution / operation / scheduled-finalization / rollout-metrics module tests | **96 passed, 4 files** | Current database test cases pass; fault probes expose missing cases. |
| Full component suite | **474 passed, 71 files** | Mocked emitter/API behavior does not prove real event ordering. |
| Changed task state/successor/metrics IPC, chat API and six-language parity tests | **39 passed, 5 files** | Run with temporary config using service aliases; source/test files unchanged. |
| `yarn typecheck` and `yarn vue-typecheck` | **Passed** | Types alone do not establish task completion or durable delivery. |
| `yarn build:e2e` | **Passed** | Fresh source-built test artifacts. |
| Existing two task-policy Playwright specs | **3 passed** | Delayed provider-stream Stop and rejected recovery requests; no real checker-in-flight, scheduled occurrence recovery or successful successor flow. |
| Real compiler/controller/evidence/adapters composition | **Defects reproduced** | Dropped conjunction, unsupported evidence citation, third qualitative criterion starvation, missing-input misclassification. |
| Real provider factory with controlled model inputs | **1 probe test passed, demonstrating wrong-target evidence** | Target never reaches count lookup; deployment observation uses unrelated contact. |
| Real current TypeORM/better-sqlite3 model methods, in-memory SQLite | **Defects reproduced** | Budget/claim succeeds inside another transaction then rolls back; negative delta restores token allowance. |
| Real current operation guard, controlled atomic dependencies | **Defects reproduced** | Retry ordinal 2 allowed after ordinal 1 accepted/unknown; concurrent same-intent guards both allowed. |

The serial rerun does not erase the initial broad-run failures. No full `yarn testmain`, full module suite, all E2Es, production package, server tests or actual external-provider fault test is claimed. Runtime was installed Node 22.19.0. Vite config warnings and a renderer font serving allow-list warning appeared; the listed completed checks still passed. Temporary probes/logs are under `/tmp`, not committed regression tests.

Representative reproduction commands from this worktree:

```sh
export PATH=/Users/cengjianze/.nvm/versions/node/v22.19.0/bin:$PATH
yarn vitest run --config vitest.service.config.mjs --maxWorkers=4
yarn vitest run --config vitest.service.config.mjs --maxWorkers=1 \
  test/vitest/main/service/ToolExecutor.searchRecovery.test.ts \
  test/vitest/main/service/ToolResultPreparationService.test.ts \
  test/vitest/main/service/StreamEventProcessorToolResults.test.ts
NODE_OPTIONS='--import tsx' TS_NODE_PROJECT=tsconfig.json \
  node_modules/.bin/mocha --require tsconfig-paths/register \
  test/modules/AiTaskExecutionModule.test.ts \
  test/modules/AiTaskOperationModule.test.ts \
  test/modules/AiTaskExecutionScheduledFinalize.test.ts \
  test/modules/AiTaskRolloutMetricsModule.test.ts
yarn test:components --maxWorkers=4
yarn typecheck
yarn vue-typecheck
yarn build:e2e
yarn playwright test test/e2e/specs/manual-cancel-during-checking.spec.ts \
  test/e2e/specs/scheduled-incomplete-recovery.spec.ts --workers=1
```

## A. Confirmed bugs and implementation gaps

### B01 — Ordinary complete manual tasks remain unverified [P1; confidence 10/10]

- [ ] Allow trusted, complete derived contracts to establish verified completion without requiring an approved plan/template.

**Location:** `src/service/AIChatQueryEngine.ts:1643–1649, 1728–1736`; `src/service/aiTaskExecution/TaskCompletionController.ts:183`.

**Trigger:** manually submit a clear count/text/observation task with no approved plan, then satisfy all derived required criteria. Resolver returns task_best_effort; contract remains best_effort; controller only returns verified_complete for task_verified. Even valid evidence for every requirement produces incomplete, defeating normal manual Completed behavior. An approved plan is now recognized; the finding is specifically the ordinary no-plan path.

**Fix:** validate coverage/source/scope in the main process and permit evidence-backed verification when every admissible required criterion passes. A best-effort request lacking a usable complete contract must stay unverified; do not simply relabel all best-effort work successful.

**Regression:** typed “save 100 qualifying contacts” and complete tool-free deliverable both verify from valid evidence without slash command/schedule/plan; ambiguous/zero-criteria cases remain unverified. **FR-04/17/19/22; AC-03/17/20/21.**

### B02 — Contract compiler drops requested clauses, qualifiers and report semantics [P1; confidence 10/10; reproduced]

- [ ] Preserve every requested outcome and qualifier, or add a required whole-request fallback/clarification when a clause cannot be compiled safely.

**Location:** `src/service/aiTaskExecution/TaskCriteriaResolver.ts:525–532` and its count/observation parsers.

**Observed:** “Write a blog post and a tweet about our launch” compiles only `Deliverable: blog post`, with no ambiguity. Real controller/evidence/checker composition verifies blog-only content on a verified contract. “Save 100 qualifying contacts…” loses qualification in its description; “Check deployment status and report it to me” creates another observation for `it-to-me` rather than a report condition. The isolated verified-contract probe demonstrates the compiler defect even though B01 currently masks verified success for ordinary best-effort requests.

**Fix:** carry the governing verb through noun conjunctions; retain the complete topic/filters; distinguish retrieval, report, draft, start and completion. Source offsets must cover the material original requirements. Never declare coverage complete merely because one clause matched.

**Regression:** omit tweet, launch topic, qualification, or report → cannot pass; complete all parts → pass; unknown clause → required fallback/clarification. **FR-01/02/03/18/19; AC-11/20/21.**

### B03 — Evidence counts and observations are not target/execution scoped [P1; confidence 10/10; factory probe]

- [ ] Resolve criteria through trusted domain adapters with target, qualification, uniqueness, execution attribution and approved cumulative/lineage scope.

**Location:** `src/service/aiTaskExecution/EvidenceProviderFactory.ts:142–155, 186–217`.

**Observed:** provider ignores `targetId`, counts all ContactInfo rows since execution creation, or SearchResult rows using execution schedule ID. It does not validate campaign, record kind or which operation produced the rows. A concurrent extraction can satisfy another request's 100 contacts. `observationProvider("production-deployment")` returns an arbitrary fresh ContactInfo row. Timestamp freshness alone proves neither deployment retrieval nor ownership. `lineage` uses the successor creation window and can exclude valid ancestor progress.

**Fix:** persist domain/job/result linkage and query it; do not substitute a schedule ID for the required search/domain task identity. Observation needs actual target result/revision and requested report. Continue uses approved baseline/lineage, not a fresh arbitrary time window.

**Regression:** wrong-campaign/foreign concurrent rows, wrong kind and unrelated fresh contact never pass; genuine campaign results, fresh deployment observation/report and ancestor progress do. **FR-02/03/10/24; AC-01/04/11/17/27.**

### B04 — Checker cites criterion IDs instead of actual supporting evidence [P1; confidence 10/10; reproduced]

- [ ] Collect admissible evidence before checking and validate verdict references against that supplied evidence set.

**Location:** `src/service/aiTaskExecution/criteriaAdapters.ts:567, 643–645`; `src/service/aiTaskExecution/TaskEvidenceService.ts` evidence generation order.

**Trigger:** JSON pass cites only the criterion ID. That ID is advertised as the admissible evidence identity and accepted, even though no supporting evidence row exists yet. Source selectors, actual revisions and execution membership are not validated. The old PASS-prefix bug is fixed; JSON shape validation alone does not implement the trust boundary.

**Fix:** create bounded text evidence for tool-free deliverables and authoritative source evidence for external facts, then provide IDs/excerpts/revisions to checker. Validate exact membership/scope/freshness; unsupported references become unknown. Checker cannot override deterministic failure or uncertain effects.

**Regression:** criterion-ID-only, nonexistent, stale and wrong-execution citations rejected; real bounded text evidence can verify requested prose without requiring tools. **FR-03/04; NFR-08; AC-11/20/21.**

### B05 — Three qualitative criteria starve the third within the two-check cap [P2; confidence 10/10; reproduced]

- [ ] Evaluate all qualitative criteria in one bounded candidate check, or preserve valid verdicts while respecting the candidate/run attempt limits.

**Location:** `TaskCompletionController.ts:329–339`, `TaskEvidenceService.checkCandidate`, `TaskRunBudget.reserveCheckerAttempt`.

**Observed:** “Write a blog post, draft an email, compose a tweet,” all delivered; checker always passes. First two criteria use both allowed candidate attempts; third remains unknown. Next candidate starts at the first again, burning the six-check run allowance without verifying the third.

**Regression:** three complete outputs verify with one schema-validated batch check and at most one retry, no needless maker continuation; failed one remains unmet. **FR-04/08; AC-03/08/20.**

### B06 — Durable outcome winner is ignored on failure, stale lease and cancellation race [P1; confidence 10/10]

- [ ] Publish only the committed winning outcome; surface persistence failure explicitly and retain recovery control.

**Location:** `AIChatQueryEngine.ts:3802, 3809–3810, 3819, 3825`; delivery `:3358–3390, 3458`.

**Trigger:** checker decides verified; finalize throws/returns non-ok, ownership is stale, or Stop finalized cancelled first. Gate still returns intended verified outcome. ALREADY_FINALIZED does not load the stored winner. Caller emits verified completion/task state and notification, then removes active binding. Thus stored cancelled/nonterminal and live green verified can disagree.

**Fix:** read/return authoritative stored outcome for idempotent finalization; reject stale generation; no success delivery on transaction error. A failed persistence gate must be a visible recoverable/non-success condition, not intended success plus an error reason.

**Regression:** real engine+module injected finalization failure; Stop-vs-complete and newer owner races; terminal stream/history/notification all match the committed winner. **FR-05/12/22/24; NFR-10/11; AC-15/24/25/32.**

### B07 — Scheduled delivery/notification still occurs before scheduled transaction [P1; confidence 9/10]

- [ ] Buffer scheduled terminal delivery and suppress engine notification until runner commits execution and occurrence accounting.

**Location:** `AIChatQueryEngine.ts:3337, 3358, 3458`; `ScheduledAiMessageRunner.ts:601–651, 967`.

**Trigger:** scheduled engine skips manual finalize, emits complete and notifies; runner finalizes after engine submission/sink capture resolves. If the scheduled transaction fails, terminal content/notification already escaped. New sink/controller wiring does not move the engine notification behind durability.

**Regression:** scheduled transaction failure → no final success delivery/notification/count; successful transaction → one delivery using committed identity/preferences. **FR-12/14; NFR-10; AC-15/32.**

### B08 — Actual stream listener cleanup loses terminal task state [P1; confidence 10/10]

- [ ] Deliver authoritative terminal task state before stream cleanup, or consume its outcome atomically from the terminal completion payload.

**Location:** `AIChatQueryEngine.ts:3358–3390`; `ai-chat-v2-ipc.ts:743`; `src/views/api/aiChatV2.ts:253–293, 417–444`.

**Trigger:** engine emits complete, then task_execution_state terminal. Complete handler synchronously removes both listeners. Component's completion callback does not consume taskOutcome, so following state is lost and badge remains active/checking until reload. Current component fixtures emit task state before complete, reversing production order.

**Regression:** real API bridge/component with exact engine order; correct outcome/actions appear without reload and listeners clean up once. Cover manual and successor. **FR-13/14/22; AC-16/27/32.**

### B09 — Second manual execution is rejected as a stale event [P1; confidence 10/10]

- [ ] Bind renderer acceptance to current submission/turn/generation and allow a legitimate new execution to replace the old one.

**Location:** `src/views/components/aiChatV2/AiChatV2.vue:4776–4779`, `onSend`.

**Trigger:** task A finishes; task B starts in the same conversation. Existing state retains A; handler drops every event with a different execution ID, so B's active/terminal chunks are ignored and actions point at A. Simply removing the check would allow late A events to overwrite B.

**Regression:** two sequential tasks and replacement task; accept B, reject late A, preserve outcome when switching/reloading. **NFR-10; AC-25/32.**

### B10 — Successor listeners attach late and discard work output [P1; confidence 10/10]

- [ ] Register/correlate successor stream before dispatch, render response/tool segments, and consume final content/outcome.

**Location:** `AiChatV2.vue:1647–1671, 1695–1717`; `src/views/api/aiChatV2.ts:382–474`; successor dispatch `ai-chat-v2-ipc.ts:2243`.

**Trigger:** component awaits creation, then attaches, while IPC already dispatched engine. Helper ignores tokens/tool output/final content and filters conversation only, ignoring executionId; component completion is a no-op. An early successor result is lost; late parent completion can detach successor listener. Dispatch exists now; usable output attachment remains broken.

**Regression:** valid-parent Continue/Retry through real bridge with immediate first chunk, visible result/tools, terminal badge, correct new attempt disclosure; late parent complete cannot close successor. **FR-13/14/21/22; AC-25/27/32.**

### B11 — Submission reuse aborts the accepted original run [P1; confidence 9/10]

- [ ] Perform accepted-submission lookup/return before replacing active turn or aborting its controller.

**Location:** `AIChatQueryEngine.ts:2229–2239, 2356`.

**Trigger:** transport resubmits the same accepted submission while original is active. Reuse short-circuit prevents a new maker dispatch, but occurs after aborting original and registering retry. Original work is cancelled instead of returning current status. The earlier duplicate-dispatch bug is fixed; this ordering bug remains.

**Regression:** held-open original stream, duplicate submission → original continues, one message/execution/provider dispatch, retry receives accepted status; changed hash rejected before mutation. **FR-21; AC-26.**

### B12 — Goal ownership remains metadata, not the enforced semantic owner [P1; confidence 10/10]

- [ ] Determine actual request-to-goal linkage and route exclusively through that owner; ordinary tasks retain standalone ownership.

**Location:** `AIChatQueryEngine.ts:1770–1774, 1929`; `TaskCompletionController.DecideContext`.

**Trigger:** any same-conversation active goal makes new actionable work owner goal, even if unrelated. Consult still calls standalone controller with no owner/goal yield semantics. Response-only goal guard improved, but unrelated actionable tasks inherit goal and actual goal makers still enter standalone verification/recovery.

**Regression:** active unrelated goal + new task → independent objective/budget; explicit goal maker → one owner and internal iteration end, no stacked nudges/standalone goal completion. **FR-20; NFR-01/07; AC-14/25/31.**

### B13 — Shared budget enforcement remains incomplete at real dispatch [P1; confidence 10/10]

- [ ] Fail closed before tool dispatch on exhausted/failed reservation and enforce remaining tokens/active time/waits across all paths.
- [ ] Count actual HTTP retry/fallback/checker/compaction attempts, persist continuation/checker/no-progress spending, and reserve conservative token estimates before dispatch.
- [ ] Use unique attempt identities across retries, round-cap resets and repeated runOnce/resume calls; await durable accounting before releasing the owner.

**Location:** `AIChatQueryLoop.ts:1434–1461, 1842–1876, 2115–2135, 2259–2296, 4126, 4690`; engine binding `:1958–2000`; checker reserve `TaskCompletionController.ts:329–334`; provider transport retries `src/api/aiChatApi.ts:2332–2461`.

**Evidence:** tool gate explicitly logs exhaustion/ledger failure then invokes tool; it is called before actual dispatch, so “already in flight” comment does not justify fail-open behavior. Provider IDs are `prov:execution:round`; round resets and repeated attempts can reuse IDs and token reconciliation dedup while dispatching new work. Transport retry/fallback and checker calls spend no shared provider attempt through that interface. Continuation/checker/progress mirrors do not persist those deltas; no cumulative wait accounting or whole-task timer gate exists. Token/runtime persist is fire-and-forget and failures only log; runtime includes provider stream only, omitting long tools/checking/preparation. Controller checks continuation/provider/stall allowances, not a complete token/tool/time/wait dispatch barrier.

**Fix:** one durable reservation authority, generation/cap/identity checks and actual transport attempt hook; retain stricter existing guards. A cap is not an accounting hint. Local already-collected evidence may still verify at cap, but no new unfunded work may execute.

**Regression:** zero tools → no execute; persist false/error → no dispatch; 60 wire attempts including retries/checker/compaction, 50 manual tool attempts, 128k estimates+usage, 10-minute active cap/30-minute hard max, one-hour cumulative waits; pause/restart/Continue preserves every spent counter. **FR-08/10/23; AC-06/08/22/27/29.**

### B14 — Durable budget/operation gates join an unrelated shared transaction [P1; confidence 10/10; real SQLite]

- [ ] Serialize durable dispatch gates under a common transaction coordinator and return success only after their own committed boundary.

**Location:** `src/model/AiTaskExecution.model.ts:850–881`; `src/model/AiTaskOperation.model.ts:386–405`.

**Observed:** create/finalize uses a transaction/mutex, but budget increments and operation claims bypass it. With current TypeORM/better-sqlite3 shared QueryRunner, an outer transaction is opened; budget persist returns true, claim returns ok; unrelated rollback restores attempts 0 and operation pending/generation 0. Work could dispatch based on a reservation that was never durably committed.

**Regression:** suspend another execution transaction, reserve/claim concurrently, force rollback; no prematurely successful gate and no lost committed reservation/claim. Extend transaction serialization to every relevant writer, not just finalizers. **FR-08/11; NFR-10; AC-08/15/28.**

### B15 — Negative persisted deltas restore allowance [P2; confidence 10/10; real SQLite]

- [ ] Schema-validate finite nonnegative integer increments at module/model boundary; implement streak reset separately from monotonic counters.

**Location:** `AiTaskExecution.model.ts:849–874`; test `test/modules/AiTaskExecutionModule.test.ts:1364–1395`.

**Observed:** stored tokens 10 plus delta -7 returns true and stores 3. No SQL cap/identity validation complements in-memory dedup. The test still described as hostile-delta coverage now supplies valid positive numbers, so it cannot catch this regression.

**Regression:** negative/NaN/Infinity/unsafe integer rejected with unchanged ledger; duplicate reservation ID changes nothing; compare-and-reserve cannot overrun frozen limits. **FR-08/23; AC-08/27/29.**

### B16 — Confirmed/unknown retry occurrence can be followed by another dispatch [P1; confidence 10/10; guard probe]

- [ ] Inspect all same-intent occurrences before preparing any retry, not only stable ordinal zero.

**Location:** `TaskOperationGuard.ts:247–248, 265–323, 305–308`.

**Observed:** ordinal zero failed/no effect → ordinal one accepted or unknown → prepare reads only zero failed, ignores own unresolved one, counts rows, creates and claims ordinal two. Both cases return allowed. Confirmed retry should reuse its receipt; unknown retry should block pending reconciliation.

**Regression:** initial no-effect → retry accepted/unknown → third prepare never dispatches; definitive no-effect evidence for every earlier attempt is required before a new ordinal. **FR-11/12/24; AC-09/10/28.**

### B17 — Cross-execution intent fence has a check/create race [P1; confidence 10/10; controlled concurrency]

- [ ] Atomically claim a shared domain-intent fence with execution-specific receipt history beneath it.

**Location:** `TaskOperationGuard.ts:241–249, 339–375`.

**Observed:** concurrent e1/e2 same-intent preparations both see no unresolved row, then create distinct execution keys and win separate atomic claims. Per-row CAS is fixed but cannot serialize distinct keys.

**Regression:** concurrent equivalent send intent in different executions/conversations → one winner; other reuses/conflicts/reconciles safely. **FR-11/24; NFR-07; AC-09/10/28.**

### B18 — Send fence target changes with authorization attempt [P1; confidence 9/10]

- [ ] Separate stable authorized domain effect identity from batch/message authorization provenance.

**Location:** `AIChatQueryLoop.ts:1537–1558`; intent hash `TaskOperationGuard.ts:228–232`.

**Trigger:** actual guard target is outbound_batch:newBatchId or outbound_direct:newSourceMessageId. Equivalent new attempt/conversation changes both target and intent hash, so earlier unknown send cannot match lookup. Native recipient dedup may mitigate some effects but does not satisfy this generic uncertainty fence.

**Regression:** uncertain send then equivalent authorized request with new batch/message/conversation remains blocked pending reconciliation; legitimate explicit recurring actions retain existing domain dedup/authority. **FR-11/21/24; AC-10/28.**

### B19 — Receipt mapping/completion and background-job semantics remain unfinished [P1; confidence 10/10]

- [ ] Map compiler criteria to trusted operation identity/native receipt; support accepted-to-completed reconciliation and correct requested start vs finish semantics.

**Location:** `EvidenceProviderFactory.ts:169–173`; `AiTaskOperation.model.ts:19–25`; deferred reconciliation `AIChatQueryLoop.ts:1584–1585`; operation compilation in `TaskCriteriaResolver`.

**Evidence:** compiler target free-text slug differs from guard outbound_batch/message target, so evidence lookup misses send receipt. Every compiled operation requires completed, including “start”; guard settles accepted and FSM has no transition into completed. Reading only stored state cannot verify final job completion.

**Regression:** actual send receipt satisfies correctly linked criterion; accepted start satisfies explicit start request but not finish request; bounded read-only native polling completes requested job; unknown never becomes complete by assertion. **FR-02/03/11/19; AC-09/10/28; design §10.3.**

### B20 — Missing input misclassified as safety block; checker deadline is not a race [P2; confidence 10/10]

- [ ] Distinguish authoritative safety restriction from input/service/capability blockers.
- [ ] Check already-aborted signals and race abort/deadline against checker dispatch, even when a provider fails to honor cancellation.

**Location:** `candidateDiagnostics.ts:78–85, 104–107`; `criteriaAdapters.ts:375–387`.

**Observed:** “I cannot continue until you choose a campaign” sets safetyRestriction true and becomes CONTENT_RESTRICTED instead of needing input. Checker timer aborts controller but still directly awaits dispatch; a nonresponsive dispatch can retain the gate indefinitely.

**Regression:** genuine refusal blocks; missing campaign waits/clarifies; service failure distinct; already-aborted/hanging checker returns promptly without late success or further maker/tool work. **FR-06/10/22; NFR-02; AC-07/12/21/24.**

### B21 — Artifact verification is unbounded and cannot verify changed artifacts [P2; confidence 9/10]

- [ ] Capture source baseline before action and use bounded asynchronous artifact reads and trusted content predicates.

**Location:** `criteriaAdapters.ts:467, 472–477, 482–483`.

**Trigger:** synchronous whole-file read has no byte limit; arbitrary regex checks also run on main thread. Large artifact/pathological check blocks Stop/deadline handling. Changed predicate always unknown because no baseline is supplied.

**Regression:** oversized file fails/returns unknown promptly, no main-process blocking; actual unchanged vs changed baseline; bounded valid content; unapproved/foreign artifact never passes. **FR-02/03/19; NFR-02/08; AC-03/11/20/24.**

### B22 — Broad test run is flaky and release-gate claims are overstated [P2; confidence 10/10 for observed results]

- [ ] Diagnose parallel-suite timing/isolation and add real flow regressions for the actual event/durability/guard defects above.

**Observed initial failures:** two search-recovery tests timed out at 5 seconds; 1,000-row output epoch-fence test timed out; stream tool-result externalization assertion found no saved message (`StreamEventProcessorToolResults.test.ts:175`). All 51 tests in those files passed serially without edits. This establishes a repeatability/load/isolation concern, not a proven new application bug in those services.

**Required tests:** actual 54/100 manual+scheduled recovery; complete multi-output contract; successful valid-parent Continue/Retry with visible output; real checker-in-flight Stop and durable cancellation; same-submission while original active; history/progress/actions; actual main→preload→API→component event ordering; effect receipt/crash/transaction fault cases. Current E2Es do not exercise those flows. Checked unit tests that encode fail-open dispatch, reversed emitter order or intended success on persistence failure must be corrected, not used as completion evidence.

**Requirements:** FR-15; all assigned AC layers; rollout §12/§17. Preserve initial failure and rerun evidence separately in CI/reporting.

## B. Remaining feature/reliability TODOs

### G01 — Finish lifecycle/progress/approval and early Stop handling

- [ ] Register durable accepted identity and abort handle before slow attachment/history/outbound/resolution work (`AIChatQueryEngine.ts:1507–1660`; active turn only `:2233`). Stop must work during acceptance.
- [ ] Emit verifying, continuing and waiting states from actual owned phases; current engine emits active/terminal only. Translate all new text and test actual streaming.
- [ ] Restore progress, unmet conditions, remaining limits and safe actions on reload; latest state IPC (`ai-chat-v2-ipc.ts:2086–2095`) returns only status/outcome/reason.
- [ ] Verify actual plan/question/permission approval stays in the same execution, freezes original plus approved scope before effects, persists denial and does not inherit scheduled send authority.
- [ ] On enrolled consult exception, produce controlled unverified/failure rather than return null and run legacy nudges (`AIChatQueryLoop.ts:1408–1416`).

**FR-01/05/10/13/14/17/21/22/24; AC-06/07/16/18/22–25/27.** These are incomplete behavior, not missing label keys.

### G02 — Drain restart recovery and implement durable delivery identity

- [ ] Await a bounded recovery barrier before scheduler/effect startup (`src/background.ts:1276–1277` currently launches without awaiting).
- [ ] Drain/chunk/schedule the recovery overflow, rather than slice first 200 and leave rest until another startup (`TaskExecutionRestartRecovery.ts:126–129`). Preserve interrupted semantics/checkpoints and do not replay uncertain effects.
- [ ] Carry stored final_event_identity/generation through terminal events/IPC/notifications and implement durable pending-delivery reconciliation/consumer dedup. Storing the identity alone does not deliver or deduplicate it.

**Regression:** 201+ interrupted rows recovered without repeated app restarts; scheduler cannot bypass sweep; crash after commit/before delivery emits once; late stale callbacks fenced. **NFR-05/10; FR-14/24; AC-13/25/27/28/32.** Startup recovery exists now; these are completion gaps in that implementation.

### G03 — Correct rollout attribution and obtain full release evidence

- [ ] Attribute shared-ledger consumption to stable lineage root/origin or explicit per-origin entries, not random `MIN(execution_id)` UUID (`AiTaskRolloutMetrics.model.ts:151–162`). Scheduled lineage with manual Continue can otherwise shift cohorts arbitrarily.
- [ ] Validate bounded read-only shadow behavior and compare manual/scheduled route/risk completion, actual/estimated usage, latency, waits, conflicts and reconciliation before enabling.
- [ ] Keep automatic consequential recovery gated until B14/B16–B19 and AC-09/10/13/28 fault tests pass.
- [ ] Exercise rollback during an accepted task and downtime/restart; frozen policy remains authoritative; no downgrade fallback success; historical rows retain historical labels.
- [ ] Run broader main-process/module/E2E and production-required checks after fixes; do not equate green mocked tests or checked T26 notes with full acceptance.

Metrics IPC/aggregation now exists; this TODO is attribution and rollout evidence, not a claim that metrics are absent. **Technical design §17/18; NFR-12; AC-08/13/15/29/32.**

### G04 — Keep external/server work explicitly incomplete

- [ ] FR-16 server provenance/correlation extension, safe provider/model/fallback/usage diagnostics and server tests in `/Users/cengjianze/project/aifetchserver`.
- [ ] Desktop consume optional actual server metadata/correlation; finishReason-derived heuristic is not actual provider/adapter/synthetic provenance.
- [ ] Later Slice 4 legacy schedule-page/non-Chat-V2 adapters and compatibility tests; receipt terminology alignment if implementation state names differ from design.

These repositories/features were not fully audited or modified here. The worktree's existing TODO still lists them open. Server metadata remains optional and cannot replace desktop task verification. **FR-16; NFR-06/11; design §16.**

## C. All-requirement coverage at this snapshot

`Partial` means relevant implementation exists but listed bugs/gaps prevent a complete requirement claim. `Architecture supported` is scoped to inspected new paths. `Deferred` remains incomplete against the full PRD. Acceptance status separates implemented seams from real verified flows.

### Functional requirements

| Requirement | Status and remaining TODO |
| --- | --- |
| FR-01 Objective/policy freeze | Partial: B02/B12/G01; material request/approved scope must survive compilation. |
| FR-02 Execution-local completion | Partial: B02/B03/B19/B21; actual target, report and start/finish semantics. |
| FR-03 Authoritative evidence | Partial: B03/B04/B19/B21; wrong-target counts and checker citations unsafe. |
| FR-04 Qualitative/unknown | Partial: B01/B04/B05/B20; valid best-effort completion, references, batches and deadline. |
| FR-05 Decision boundary | Partial: B06/B07/G01; persistence failure and consult failure bypass. |
| FR-06 Stop distinctions | Partial: B13/B20/G01; input blockers and owned abort/limits. |
| FR-07 Evidence-based continuation | Partial: B02/B03/B13; prompt currently reports bounded maker text as verified progress (`TaskCompletionController.ts:368`) and lacks failures/restrictions summary. |
| FR-08 Shared budgets | Not complete: B13/B14/B15. |
| FR-09 Results-based stalls | Partial: progress tracker improved; durable no-progress/evidence state and allowance wiring B03/B13/G01. |
| FR-10 Same-execution resume | Partial: shared binding/ledger exists; B03/B13/G01 retained scope/waits/denial evidence. |
| FR-11 Effect guards | Partial, unsafe retry/concurrency: B14/B16/B17/B18/B19. |
| FR-12 Honest durable outcomes | Partial: transaction improvements; B06/B07/B14/B16/G02 delivery/winner defects. |
| FR-13 Visible execution | Partial: B08/B09/B10/G01 lifecycle and output flow. |
| FR-14 Actions/notifications | Partial: B07/B10/G01/G02 durability and reconstructable progress. |
| FR-15 i18n/UI tests | Keys and 474 component tests pass; B08–B10/B22/G01 real flow gaps remain. |
| FR-16 Reasons/provenance | Partial/deferred: B20/G04; actual server-origin metadata absent. |
| FR-17 Default manual protection | Partial: compiler/enrollment exists; B01/B02/B11/G01 ordinary completion and early identity. |
| FR-18 Intent/source analysis | Partial: B02/G01; source schema improved, full natural-language scope coverage still not ensured. |
| FR-19 Usable manual contracts | Partial: B01/B02/B03/B05/B19/B21. |
| FR-20 One semantic owner | Not complete: B12; metadata does not enforce exclusive owner. |
| FR-21 Preparation/follow-ups | Partial: successor dispatch/ledger exists; B10/B11/B13/B18/G01/G02. |
| FR-22 Honest manual UX | Partial: outcome-aware badge exists; B01/B06/B08/B09/B10/B20/G01. |
| FR-23 Manual limits | Not complete: B13/B14/B15. |
| FR-24 Independent durable outcomes | Partial: independent rows/transactions exist; B03/B06/B14/B16–B19/G02. |

### Reliability requirements

| Requirement | Status and remaining TODO |
| --- | --- |
| NFR-01 One active writer/priority | Partial: conversation coordinator exists; B11/B12/B17/G01 current races/ownership. |
| NFR-02 Bounded abortable checking | Partial: checker signals wired; B20/B21/G01 strict deadline/artifact/early Stop gaps. |
| NFR-03 Model/Module DB/worker architecture | Architecture supported in inspected persistence/control paths; worker guards and module tests pass. Preserve it in fixes. |
| NFR-04 AI IPC enable/checker entitlement | Inspected new IPC/checker gates present; retain per-dispatch checks and test rollback/disabled cases; budget correctness B13 separate. |
| NFR-05 Restart interruption/no replay | Partial: G02 sweep barrier/overflow; B16–B19 uncertainty/native reconciliation. |
| NFR-06 Stream compatibility | Partial: default-off seams exist, G04 optional diagnostics and real provenance still incomplete. |
| NFR-07 Same scope/authority | Partial: B03/B12/B16–B19/G01 request/goal/effect identity. |
| NFR-08 Redacted untrusted evidence | Partial: bounds/schema improvements; B04/B21 evidence reference and main-process read bound. |
| NFR-09 No task toggle/goal/schedule prerequisite | Enrollment supported, but B01 means ordinary no-plan task still cannot verify. |
| NFR-10 One post-durability terminal/fencing | Not complete: B06–B11/B14/G02. |
| NFR-11 Response/task/goal/occurrence distinct | Types improved; B06/B07/B08/B12/G04 actual winner/delivery/provenance remain. |
| NFR-12 No resolution/rollback unchecked success | Partial: frozen binding fixed; B06/G01/G02/G03 errors/rollback acceptance need real proof. |

### Acceptance criteria

| AC | Current assessment / required completion work |
| --- | --- |
| AC-01 54/100 then stop | Not established: B01/B03/B13; actual qualifying target count and recovery. |
| AC-02 First promise/no tool | Binding can continue, but real result flow not established: B01/B02/B13/G01. |
| AC-03 All required evidence passes | Local evidence-before-cap fixed; B01/B03/B04/B05 prevent complete claim. |
| AC-04 Running-job observation | Not complete: B03 wrong observation, B19 semantics, actual report/recurrence E2E missing. |
| AC-05 Repeated discovery/no progress | Tracker improved; B13 durable totals/stall state, real evidence/results flow required. |
| AC-06 Permission grant retains counters | Partial: B13/G01 actual spend/waits/source/denial state. |
| AC-07 Permission denial/missing input | Partial: B20 missing input misclassified; G01 no workaround regression. |
| AC-08 Total budget exhausted | Not satisfied: B13 fail-open tools/other dispatch and B14/B15 authority. |
| AC-09 Lost successful send response | Not satisfied: B16/B17/B18/B19 receipt identity/reuse/reconciliation. |
| AC-10 Unresolved send | Not satisfied: B16–B19 unknown retry and cross-execution fence. |
| AC-11 Invented evidence rejected | Not satisfied: B02/B03/B04 permit dropped/wrong-source pass. |
| AC-12 Filter/error/truncation | Partial: finish reason handling improved; B20 input vs restriction, G01/G04 actual diagnostics. |
| AC-13 Restart/delivery gap | Partial startup code; G02 barrier/overflow/delivery and B14/B16–B19 effect safety. |
| AC-14 Chat/goal owner | Response-only guard improved; B12 task/actual-goal ownership remains. |
| AC-15 Persistence failure | Not satisfied: B06/B07/B14 verified outcome/delivery before committed result. |
| AC-16 Reload/locales/actions | Status restore and translations pass; B08/B09/B10/G01 missing live terminal/progress/actions. |
| AC-17 Plain manual save100 | Partial enrollment; B01/B03/B13 real no-plan verification and qualifying count. |
| AC-18 Empty/“I will check” | Recovery seams present; B01/B03/G01 real task evidence and early Stop unproved. |
| AC-19 Question vs fresh task | Resolver improved; B03 real retrieval/report, B02 report condition required. |
| AC-20 Text and multipart | Not satisfied: B01/B02/B04/B05 text evidence/whole conjunction. |
| AC-21 Resolver/checker failure | Partial: JSON validation improved; B02/B04/B20/G01 scope/unknown vs restriction. |
| AC-22 Permission/question/plan resume | Partial: G01 actual approval/denial and B13 remaining limits; composed E2E needed. |
| AC-23 Plan draft stop | Preparation enrollment exists; G01 same approved executable contract/effect boundary proof missing. |
| AC-24 Stop during checking/recovery | Signal path exists; B06/B20/B21/G01 durable winner, hanging dispatch/early acceptance. Existing E2E only provider Stop. |
| AC-25 Replacement fences owner | Partial: B06/B09/B10/B12/G02 winner, current execution, owner/event identity. |
| AC-26 Submission transport retry | No redispatch fixed; B11 retry still aborts original active work. |
| AC-27 Continue remaining work | Shared ledger/dispatch fixed; B03/B10/B13/G01/G02 progress, visible output and actual remaining allowance. |
| AC-28 Effect lost/restart/new conversation | Not satisfied: B14/B16/B17/B18/B19/G02. |
| AC-29 Compaction/fallback/tool totals | Not satisfied: B13/B14/B15 shared actual attempt/usage persistence. |
| AC-30 Early recoverable error | Sink holds consult now; B06/B07/G01/G02 durable one-time terminal result still required. |
| AC-31 Unrelated active goal | Ordinary response guard fixed; B12 unrelated actionable request and actual goal ownership remain. |
| AC-32 Terminal/races/reload | Not satisfied end to end: B06–B11/B14/G01/G02. |

## D. Prior fixes retained and recommended order

Do not reopen the old claims that no contract/compiler, event emitter, successor dispatch or operation guard exists. Current code includes those. Execution creation/dedup, transaction-based manual/scheduled finalization, shared Continue ledger claim, operation same-row CAS/unique-collision validation, schedule success streak reset and checkpoint merging are materially improved. Duplicate criterion IDs, required source refs, supplied-source offsets and normalized hash round trips are repaired. Content-sensitive candidate IDs and replay blocking repaired the old continuation-key bug; evidence-before-maker-cap ordering and JSON checker parsing are repaired. Six-language labels now distinguish task outcomes.

The narrower current findings explain why those fixes still do not close the full requirement. In particular, row CAS does not provide a cross-execution intent fence; a transaction for finalization does not serialize separate reservation writers; an emitter does not ensure renderer listener ordering; a compiler does not prove complete original-request coverage.

Recommended dependency order:

1. Durable winner/dispatch authority/effect safety: **B06/B07/B13–B19/G02**.
2. Exact contracts and authoritative evidence: **B01–B05/B20/B21**.
3. Real stream/successor/goal/acceptance lifecycle: **B08–B12/G01**.
4. Real composed/fault/E2E gates, repeatable tests, rollout attribution: **B22/G03**.
5. Track optional server/legacy integration separately: **G04**.

- [ ] Every affected fix has a committed regression proving the concrete failure, not only an injected expected decision.
- [ ] Both manual and scheduled no-plan tasks verify only their exact required outcomes and recover within durable limits.
- [ ] Unknown/confirmed actions cannot be replayed via retry ordinal, new authorization, another conversation or concurrent execution.
- [ ] Live UI/history/notifications reflect the committed outcome winner and remain attached through actual recovery/Continue.
- [ ] All required release checks and assigned acceptance layers have fresh evidence; no broad test failure is hidden by an aggregate passed count.

Closing these checkboxes requires fix commit references and actual test results. This document is an audit artifact; implementation was not modified.
