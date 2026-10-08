# Generator streaming — requirements re-audit and open TODOs

Audit date: 2026-10-08. Reviewed branch: `generator-streaming`, commit `3057264b`.

Sources: [PRD v1.1](./ai-chat-workspace-generator-streaming-prd.md) and [technical design](./ai-chat-workspace-generator-streaming-technical-design.md). Both worktree copies were compared with the supplied absolute paths under `/home/robertzeng/project/aiFetchly/docs/prd/` and are byte-identical.

## Verdict

**No, all requirements have not been implemented or demonstrated.** The generator loop, native provider iterators, callback compatibility, persistence barriers, durable queue dispatch, typed outcomes, and localized failure UI are present. However, approval currently cancels workspace runs, several lifecycle/finalization guarantees remain broken, and mandatory performance/rollout evidence is incomplete.

This report supersedes the completion assessment in the [previous TODO](./ai-chat-workspace-generator-streaming-todo.md) and [operations record](./generator-streaming-operations.md). Checked boxes in the older report are historical claims, not proof that these paths are correct at the reviewed commit. This audit changes documentation only; the defects below have **not** been fixed.

Evidence labels:

- **Reproduced:** a focused isolated probe executed the actual function/module, or an extracted source method with stubbed dependencies. These are not Electron E2E reproductions.
- **Source-confirmed:** a concrete code path demonstrates the defect; an automated regression is still needed.
- **Evidence gap:** insufficient verification, not proof that the feature fails.
- **Documented deviation:** the implementation inventory explicitly records different behavior from the supplied requirement.

Priority: **P1** blocks correctness/release acceptance; **P2** covers additional contract, diagnostics, and verification work. Source anchors below refer to `3057264b`.

## Open correctness tasks

### R01 — P1: Approval is routed to cancellation

- [ ] Correct permission-grant routing in `src/main-process/communication/ai-chat-v2-ipc.ts:1263–1300`.
- **Requirements:** FR-009/010/024; AC-05/11; design §3.5/14.
- **Reproduced:** `handleResumeToolAfterPermission()` first checks coordinator ownership and calls `cancelOwnedRun()`, then returns. The later identical ownership condition that calls `resumeRun()` is unreachable for these runs. The comment describes denial, but the block is inside the grant handler.
- **Observed probe:** gated access allowed, owner present, valid conversation/tool ID → calls were `["cancel"]`, result was `{ ok: true, handled: true }`; `resumeRun` was never called.
- **Impact:** clicking Approve stops the workspace turn instead of executing the approved tool. A stale tool ID can also cancel the current owned run because this early branch does not validate the pending action.
- **Required change:** route grants to the owner’s validated claim/resume API. Route denial through the intended denial/Stop policy in the correct handler; preserve scheduled-engine routing.
- **Acceptance:** exercise the real IPC handler for grant, deny, stale/duplicate grant, and capacity-full approval. Valid approval runs once; stale approval changes nothing; Stop cancels a queued resume; grant never calls cancellation. Add an Electron approval flow in both delivery modes, since coordinator-only tests bypass this bug.

### R02 — P1: Lifecycle serialization waits on an obsolete promise

- [ ] Store and await the current transition chain on the live run, and serialize resume/Stop with it.
- **Requirements:** FR-007/009/021/024; AC-03/05/06; design §3.2/3.5.
- **Source:** `AIChatCoordinator.ts:1011–1078` (`createLifecycleListener`), pause handling around `:804–837`, and `resumeRun()` at `:418–490`.
- **Reproduced:** `live.lifecycleTransitions` is assigned the initial `Promise.resolve()`. `transitionThenBroadcast()` subsequently reassigns a local variable; the live-run property never receives the new promise. With a deferred database transition, awaiting `live.lifecycleTransitions` completes while the write is still pending.
- **Impact:** pause dispatch can release its lease/capacity before the waiting row is durable. Resume’s direct queued transition can race an earlier waiting write. Catching the failure and setting memory to `running` neither persists a failure nor makes the engine stop waiting.
- **Required change:** update the run-owned chain for every transition; commit state before publishing it; make resume and cancellation participate in the same ordering. Propagate required-write failure into an explicit failed/recovery state rather than log-and-continue.
- **Acceptance:** delay/reject awaiting and resumed writes; immediately approve/answer/Stop; assert no capacity release or continuation before required writes, no stale waiting transition after queued/running/terminal, and truthful durable/runtime state.

### R03 — P1: Durable finalization is bypassed on write failure and Stop

- [ ] Make the durable-run gate reject on failure and serialize terminal completion versus Stop.
- **Requirements:** FR-007/008/017/023; AC-04/08/18; design §3.6/11.
- **Source-confirmed:** coordinator `onSegmentDurable` at `AIChatCoordinator.ts:709–732` catches transition rejection and resolves. `AIChatQueryEngine.handleLoopResult()` awaits that gate before completion notifications, compaction, dream triggers, and Stop hooks (`:3194–3260`), so those effects still run after the required run write failed. A later transition retry cannot undo them.
- **Additional paths:** `stopConversation()` (`AIChatQueryEngine.ts:2425`) dispatches the Stop hook immediately, before durable message/run cancellation. Failed-result reactive compaction also starts before the failure’s save/gate in `handleLoopResult()`. Parked cancellation catches its run-write failure and still drops ownership/publishes cancellation (`AIChatCoordinator.ts:579–604`).
- **Race:** once the loop has returned `completed`, Stop during an awaited assistant save only aborts the controller; completion handling still emits/commits completed without rechecking cancellation. The coordinator’s outcome-to-status mapping does not arbitrate this race. This can also produce a user-stopped hook followed by a completed hook.
- **Required change:** one terminal arbitration/commit path; Stop wins if accepted before terminal commit, and is a no-op after it. Required durable-write errors must stop dependent side effects. Preserve a recoverable owner/state if terminal persistence fails.
- **Acceptance:** deferred/rejected assistant and run writes; Stop at each boundary; completed/cancelled/failed/paused side-effect counters. Assert one terminal outcome, one eligible hook/notification/queue callback, no effects before durable finalization, none on pause, and no completed status after cancellation wins.

### R04 — P1: Delivery mode is not pinned at run acceptance

- [ ] Capture immutable mode in the owner’s accepted run context and remove later recapture.
- **Requirements:** FR-018; AC-14; design §16.
- **Source-confirmed:** the coordinator does not capture/pass a delivery mode at acceptance. The engine captures at `runTurn()` (`AIChatQueryEngine.ts:912`) and `submitPersistedUserMessage()` (`:1451`), then **captures again** after asynchronous preparation (`:1929`). `captureStreamMode()` (`:3674–3679`) always overwrites the map from the current provider.
- **Impact:** change injected mode while scheduler admission or engine preparation is pending and an already-accepted run uses the new mode. A busy submission can also touch conversation-keyed state before admission checks; pins should belong to run identity, not every request for that conversation.
- **Coverage hole:** the acceptance-time test changes mode only after the fake loop has started, so it cannot detect either recapture window. Startup configuration sharing exists and is not the remaining problem.
- **Acceptance:** accept while capacity is full, flip mode, dispatch; delay preparation and flip again; pause and flip before permission and question resume. Each original run retains its accepted mode; only a newly accepted run gets the new value. Assert one consumer and no replay.

### R05 — P2: Progress helper starts eagerly and cannot wake a pending read on abort

- [ ] Make the progress wrapper lazy, pre-abort safe, and independently closeable on cancellation.
- **Requirements:** FR-008/015/016; AC-04/08/09; design §11/12.
- **Source:** `src/service/aiChat/runToolWithProgress.ts:57–101`.
- **Reproduced:** creating the helper with an already-aborted signal invokes `start()` once **before** `.next()`. With a tool promise held open, `.next()` remains pending after abort; releasing the fake tool is necessary to finish cleanup. The race contains only the tool promise and slot change, not cancellation.
- **Scope:** the production tool executor has its own abort/timeout handling, which mitigates many actual tools. This is a helper contract/cleanup defect; the isolated probe does not prove every production Stop hangs.
- **Required change:** check cancellation before starting work on first advancement, wake pending helper reads on abort, dispose abort listeners/resolvers, ignore late output, and preserve a separately handled external tool promise. Do not imply that closing the stream reverses an external action.
- **Acceptance:** no call to start before first next or after pre-abort; abort-ignoring fake tool cannot retain the stream read; nested iterator close releases references; progress bursts never fail a tool. Current pre-abort test actually expects the tool’s successful result and should be corrected to test admission safety.

### R06 — P1: Stopping a paused question loses its compatibility terminal event

- [ ] Obtain the pending question sink before deleting it, then emit and finalize cancellation through the correct owner.
- **Requirements:** FR-008/013/015/023; AC-04/06/11.
- **Source-confirmed:** `AIChatQueryEngine.ts:2445–2457` deletes `pendingSinks[conversationId]`, then reads that same entry to emit `cancelled`. The optional call always does nothing.
- **Impact:** a legacy/shared caller waiting on the pending sink receives no cancelled terminal. Coordinator cancellation synthesizes its own detail event and can conceal the defect, so test compatibility callers too.
- **Related cleanup:** `cancelClaimed()` (`:2519–2531`) removes the claim/sink but leaves `runStreamModes`; check all claimed-cancel/Stop-all paths against the terminal cleanup contract.
- **Acceptance:** pause for a question through a compatibility caller, Stop, and assert exactly one cancellation, no continuation, released pending/claim/mode references, and no premature or repeated Stop effects.

### R07 — P1: Scheduled owner adapter misclassifies plan submission and lacks a durable completion barrier

- [ ] Preserve plan-submission semantics and make scheduled run persistence part of awaited finalization.
- **Requirements:** FR-007/013/023/025; AC-06/11/18; design §3.6/14/15.
- **Source-confirmed:** `AIChatRunOwnerAdapter.ts:113–118` treats `plan_submitted` like `ask_user_question`, transitioning to `awaiting_user`. SubmitPlanForApproval must let the turn continue; only a question pauses execution.
- **Ordering:** the adapter forwards `inner.emit(event)` before scheduling run persistence (`:106–107`); its `flush` delegates only to the inner sink (`:136`). Transition errors are swallowed. `ScheduledAiMessageRunner` uses this adapter around `:497` and calls `runTurn()` around `:539` without supplying a durable-run gate.
- **Impact:** scheduled sidebar state can falsely claim waiting while execution continues; terminal processing and engine post-terminal effects can precede the adapter’s run-state commit.
- **Required change:** use explicit lifecycle/outcome ownership for scheduled runs; distinguish pending plan approval from a paused execution. Expose/await required run transitions and do not hide persistence failure.
- **Acceptance:** submit plan → more model work → complete while plan remains awaiting approval, with no awaiting-user run transition. Delay/fail scheduled terminal writes and ensure completion/side effects wait or fail honestly. Keep real question pause/resume working.

## Verification and release tasks

### R08 — P1: Replace the invalid performance benchmark and measurements

- [ ] Build a real comparative delivery benchmark and replace the operations table’s PASS claims.
- **Requirements:** PRD §5/10/13; design §18.
- **Source-confirmed:** `test/vitest/main/service/streamingDeliveryBenchmark.test.ts` flattens chunk fields onto the detail envelope (`buildEvents`) instead of putting them in `payload`. The presenter reads only `event.payload` (`workspaceStreamPresenter.ts:89–91,693`).
- **Reproduced:** feeding benchmark-shaped start/token envelopes to the real presenter leaves **zero messages and zero buffered deltas**. `applyEvent` returning true only proves envelope acceptance, not content application.
- **Other defects:** `scheduleFlush` returns a closure that registers the callback when cancellation is invoked, instead of registering it immediately. The harness times synchronous presenter calls and computes p95 of per-run average call cost, not provider-chunk-to-presenter-intake latency. It exercises neither delivery mode, measures no streaming-buffer peak, has no cancellation fixture/baseline/variance comparison, and contains no performance or output assertions.
- **Required change:** valid envelopes and scheduler, output assertions, provider emission/intake timestamps through the actual loop/engine/owner/transport path, and application-owned buffer measurement. Run identical text, reasoning, multi-tool, progress-burst, cancellation fixtures before/after each stage with 5 warmups or another documented warmup and at least 30 measured runs.
- **Acceptance:** record baseline, variance, added p95 ≤20 ms, duration/memory regression ≤10%, preserved 50 ms batching, environment and revisions. Current microsecond figures cannot certify those budgets.

### R09 — P2: Complete privacy-safe diagnostics and cleanup accounting

- [ ] Add the count/timing evidence required by design §18 and assert cleanup returns to baseline.
- **Requirements:** FR-015/016/017 and design §12/18.
- **Evidence gap/source:** `runToolWithProgress.ts` exposes `coalescedDropped` and `emitted` fields but does not increment them; `LatestValueSlot.ts` increments a separate coalescing counter. Late post-close progress has no count-only diagnostic. The helper modules do not provide the complete active consumer/read/listener/timer, required-write, outcome, resume-capacity-wait, and cleanup-error accounting requested by the design.
- **Required change:** inventory existing diagnostics before adding counters; use one authoritative source for each metric, wire missing lifecycle measurements, and avoid content/tool arguments/credentials/full paths.
- **Acceptance:** successful, failed, cancelled, paused, abandoned, and resumed fixture runs return owned-resource counts to baseline; verify oversized/coalesced/late-progress counts and required-write/cleanup failures without private payload logging.

### R10 — P1: Fill the missing end-to-end and adverse-boundary acceptance matrix

- [ ] Add and execute critical Electron scenarios in callback and generator modes.
- [ ] Add focused regressions for R01–R07 at the actual failing boundaries.
- [ ] Run and record full main/service/component/E2E/typecheck gates on the corrected revision.
- **Requirements:** AC-01–19 as applicable; PRD §12/13; design §17.
- **Evidence gap:** no `AI_CHAT_STREAM_IMPLEMENTATION` E2E matrix was found under `test/e2e`. Existing workspace/approval/queue tests are useful, but do not demonstrate the new required persistence, capacity-limited resume, and mode matrix. Passing isolated coordinator tests did not detect R01.
- **Required scenarios:** approval through IPC under full capacity, Stop before resumed dispatch, question resume, delayed/rejected call/result/message/run saves, renderer detach/reattach, queued durable identity and resumed sequence continuity, restart reconciliation, safe partial-history reload, and no replay on rollback. Compare normalized traces for event meaning/order using scripted providers and fake tools.
- **Acceptance:** attach command results and trace/side-effect assertions to each AC; do not equate test titles or a green suite with untested boundary coverage. Full main/service and Electron E2E were not run during this documentation audit.

### R11 — P1: Reconcile declared deviations and release status with the supplied requirements

- [ ] Resolve FR-026/AC-19 explicitly in the authoritative requirements and acceptance matrix.
- [ ] Reconcile FR-014/AC-12’s literal enablement wording with the recorded provider-aware gating decision.
- [ ] Record real Stage A release and Stage B controlled rollout/rollback evidence after correctness and performance gates pass.
- [ ] Correct older TODO/operations completion claims and defer callback removal until the rollback window closes.
- **Documented deviations:** `generator-streaming-p0-inventory.md:69–91` explicitly says same-conversation re-send supersession is **not implemented as specified**: busy sends queue instead, and `isActiveTurn` suppresses output without itself aborting the provider. It also preserves local-provider eligibility when hosted AI is disabled. The PRD permits recording conflicts, but these cannot simultaneously be called literal implementation of every original requirement.
- **Required action:** retain queue/local-provider behavior while reconciling the controlling documents; do not silently introduce supersession or disable supported local AI as an audit fix. Separately prove cancellation when ownership really is lost if that guarantee remains mandatory.
- **Release gap:** callback remains the default; no controlled-release evidence proving generator is selected for the target workspace release or exercised rollback without replay was found. PRD §13 requires release/evidence, not just code availability. The operations file calls remaining rollout work non-blocking despite these gates.
- **Acceptance:** consistent requirement decisions, correct implementation/evidence statuses, selected production mode and rollout decision recorded, successful rollback drill using fake side effects, and no automatic replay. B5 facade removal is intentionally deferred until its documented window, not an immediate deletion task.

## Requirement-by-requirement assessment

“Present” means corresponding implementation was found; it is not certification of every acceptance scenario. “Partial” identifies a defect or missing contract. “Evidence pending” means release proof is incomplete.

| ID | Assessment | Evidence / open work |
| --- | --- | --- |
| FR-001 | Present | Single `iterate()` loop, `run()` facade, result-preserving `consumeGenerator`; focused tests pass. |
| FR-002 | Present; E2E evidence pending | Provider/loop/presenter incremental paths exist; R08/R10. |
| FR-003 | Partial | Event families retained; scheduled plan-submission meaning is wrong (R07); full differential traces pending. |
| FR-004 | Partial | Main-process direct/queue ownership exists; actual approval cannot resume (R01); detach matrix R10. |
| FR-005 | Present; evidence pending | Run-owned adapter and durable queue dispatch exist; continuity/races R02/R10. |
| FR-006 | Present in inspected barriers | Callback tool-call/result and approved-result flushes exist; 7 focused persistence tests pass; broader adverse/E2E matrix R10. |
| FR-007 | Partial | Required finalization can be bypassed (R03/R07). |
| FR-008 | Partial | Stop hooks/finalization race, helper abort contract, lost question terminal (R03/R05/R06). |
| FR-009 | Partial | Explicit pause outcomes exist; lifecycle ordering and approval routing broken (R01/R02). |
| FR-010 | Partial | Engine claim validation exists; grant IPC bypasses it (R01). |
| FR-011 | Present; broader evidence pending | Required-persistence error excluded from retry; loop/retry suites pass; trace matrix R10. |
| FR-012 | Present; broader evidence pending | Presenter batching/duplicate filtering preserved and tested; adverse E2E R10. |
| FR-013 | Partial | Caller contracts/facades exist; compatibility Stop and scheduled owner gaps R06/R07. |
| FR-014 | Documented deviation | Provider-aware gate before parsing, rather than universal hosted-enable gate; R11. |
| FR-015 | Partial | Provider/helper close paths exist; remaining helper/side-map cleanup and accounting R05/R06/R09. |
| FR-016 | Partially demonstrated | Latest-value coalescing and UTF-8 payload bounds exist; helper and diagnostics gaps R05/R09; concurrent burst evidence R10. |
| FR-017 | Partial | Typed persistence failures and safe partial handling exist; lifecycle/finalization errors still swallowed (R02/R03/R07). |
| FR-018 | Partial | Config injection/startup sharing and resume map exist; acceptance pin overwritten (R04). |
| FR-019 | Present; restart evidence pending | Existing reconciliation retained, no generator serialization; full restart/no-replay test matrix R10. |
| FR-020 | Present | V2 dependency inventory §8 and retained shared components; 827 component tests pass. |
| FR-021 | Partial | Notifications exist; run-owned awaited write chain is ineffective (R02). |
| FR-022 | Present for core path; broader evidence pending | Coordinator consumes classified outcome, missing/throwing outcome fails; scheduled facade migration exists; R07/R10. |
| FR-023 | Partial | No reliable durable-before-effects/Stop arbitration across owners (R03/R07). |
| FR-024 | Partial | Coordinator claim/scheduler/lease paths exist, but IPC approval cancels and lifecycle writes race (R01/R02). |
| FR-025 | Partial | Loop continues after plan submission; scheduled adapter incorrectly pauses run (R07). |
| FR-026 | Not implemented as written; documented deviation | Re-send queues, rather than supersedes; inventory explicitly records this; R11. |

## Verification performed in this audit

Environment: Node/Vitest tooling installed in this worktree; Vitest reports **4.1.11**. Unlike the old audit, current `package.json` declares `^4.1.11`; its old version-mismatch blocker should not be repeated.

| Command / scope | Result |
| --- | --- |
| `yarn vitest --config vitest.service.config.mjs run` with `aiChatGeneratorInfrastructure`, `AIChatQueryEngine.runTurn`, `AIChatQueryEngine.requiredPersistence`, `AIChatStreamImplementationConfig`, `streamingDeliveryBenchmark` test files | 5 files, **55 tests passed**. Benchmark passing is not valid performance evidence (R08). |
| `yarn vitest --config vite.main.config.mjs run test/vitest/main/aiChatWorkspaceCoordinator.test.ts test/vitest/main/aiChatRunOwnerAdapter.test.ts` | 2 files, **24 tests passed**. |
| `yarn vitest --config vite.utilityCode.config.mjs run` with `workspaceStreamPresenter`, `chatProviderStreamEvents`, `openAIStreamParser`, `openAICompatibleProviderClient` test files | 4 files, **31 tests passed**. |
| `yarn vitest --config vitest.service.config.mjs run` with `AIChatQueryLoop`, `AIChatQueryLoopAsyncPermission`, `AIChatTurnQueueService`, `ScheduledAiMessageRunner.chatLoop`, `AgentRuntime` test files, `--maxWorkers=1` | 5 files, **114 tests passed**. |
| `yarn test:components` | 115 files, **827 tests passed**. |
| `yarn typecheck` | Passed, no errors. |
| `yarn vue-typecheck` | Passed, no errors. |

Total existing tests executed: **1,051 passed** across 131 files. No full main/service-suite or Electron E2E pass is claimed. No live provider or external tool side effects were used.

Additional isolated probes (not committed as tests):

1. Transpiled actual `handleResumeToolAfterPermission` with allowed gate and owned-run stub: cancellation called, resume not called (R01).
2. Extracted actual `createLifecycleListener` method with deferred `runModule.transition`: live-run lifecycle promise resolved while the write remained pending (R02).
3. Actual `runToolWithProgress`/`LatestValueSlot`: pre-aborted creation started tool before iteration; aborted pending read stayed pending until fake tool resolved (R05). Probe released the fake tool afterward.
4. Actual presenter fed benchmark-shaped flattened envelopes: zero messages and zero buffered deltas (R08).

Raw command logs are local session artifacts under `/tmp/generator-streaming-audit-{focused,coordinator,provider,callers,components,typecheck,vue}.log`; the results above are recorded here so the report does not depend on retaining temporary files.

## Suggested completion order

1. Fix R01 immediately, then R02/R03/R06/R07 with regression tests at IPC/owner boundaries.
2. Fix mode pinning and helper contracts (R04/R05), complete diagnostics (R09).
3. Replace benchmark (R08), run the full acceptance matrix (R10), and reconcile/release against R11.
4. Re-audit this checklist at the resulting commit before marking either stage complete.
