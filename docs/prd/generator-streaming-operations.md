# Generator Streaming — Operations, Traceability, Rollback

| Field | Value |
| --- | --- |
| Date | 2026-09-27 |
| Stage | **A complete** (P0, A1, A2a-c, A3a-b) on branch `generator-streaming` (worktree `.worktrees/generator-streaming`) |
| PRD | [Generator streaming PRD](./ai-chat-workspace-generator-streaming-prd.md) |
| Inventory | [P0 caller inventory](./generator-streaming-p0-inventory.md) |

## 1. Stage A behavior changes (operator-visible)

1. **Completion is never inferred.** Every workspace-visible segment returns a typed `AIChatSegmentOutcome` consumed by its owner. An engine throw finalizes the run `failed` with `errorCode: "unclassified_segment_exit"` (AC-17); an admission race (`conversation_busy` outcome) fails the run honestly.
2. **Required persistence is strict.** A failed tool-call/tool-result DB write aborts the segment before dependent execution, is excluded from transient retry, and renders the tool card as a localized failure ("Tool not run: it could not be saved." / "Tool ran but its result could not be saved.") in all six languages. The tool is never re-run (AC-02/08).
3. **Waiting/resume are explicit.** `onAwaiting`/`onResumed` lifecycle notifications replace engine-status sampling; transitions persist before broadcast (FR-021).
4. **Every workspace-visible turn has one owner and a durable run.** Queue-drained rows execute through `dispatchQueuedTurn` with a real run id, monotonic sequence, scheduler capacity, and conversation lease; the synthetic `pending-queue-N` run IDs are gone (AC-16).
5. **Resume goes through the owner.** Permission approvals and plan answers re-enter via `coordinator.resumeRun`: claim → queued (visible while waiting for capacity) → lease → observed continuation outcome. Stop while queued for capacity cancels the claim and never starts the approved tool (AC-04/05). Late terminals outside a live dispatch are dropped with a diagnostic (`settleDetachedTerminal` removed).
6. **Post-terminal side effects** fire exactly once per run, after durable finalization, never on a pause; the queue is notified once per run (`ownerNotifiesTerminal`) (AC-18).

## 2. Stage A acceptance traceability

| Scenario | Test owner |
| --- | --- |
| AC-02 (delayed/failed tool-call save) | `test/vitest/main/service/AIChatQueryEngine.requiredPersistence.test.ts` |
| AC-03 (detach/reload; execution continues) | `aiChatWorkspaceCoordinator.test.ts` ("keeps running when no renderer subscribes"), `aiChatWorkspaceIntegration.test.ts` |
| AC-04 (Stop boundaries incl. resume waiting for capacity) | `aiChatWorkspaceCoordinator.test.ts` ("Stop while a resume waits for capacity…") |
| AC-05 (approval resumes once; capacity full) | `aiChatWorkspaceCoordinator.test.ts` ("resumeRun claims, queues, and observes…"), `AIChatQueryEngine.runTurn.test.ts` (claim idempotency) |
| AC-06 (plan question pause/resume; plan approval not a pause) | `AIChatQueryEngine.runTurn.test.ts` (plan-question park + listener), existing plan tests in `AIChatQueryLoop.test.ts` (SubmitPlanForApproval continues) |
| AC-07 (provider error retry policy preserved) | `AIChatQueryLoop.test.ts` (existing retry/recovery suites, unchanged) |
| AC-08 (persistence failure → aborted, no success) | `AIChatQueryEngine.requiredPersistence.test.ts` |
| AC-10 (duplicate/stale/queue/resumed events) | presenter stale/duplicate suites (`workspaceStreamPresenter.test.ts`), `AIChatQueryEngine.runTurn.test.ts` (stale claims rejected) |
| AC-11 (shared callers contract) | `ScheduledAiMessageRunner.chatLoop.test.ts`, `AgentRuntime.test.ts`, `AIChatTurnQueueService.test.ts`, legacy resume wrappers covered by `AIChatQueryEngine.test.ts` |
| AC-12 (AI-disabled gate) | existing gates: `canUseChat` first in `ai-chat-workspace-ipc.ts` (START_RUN), `handleResumeToolAfterPermission`, `handleAnswerQuestion` |
| AC-13 (restart reconciliation) | existing `reconcileInterruptedRuns` path unchanged; covered by run-model tests |
| AC-15 (composer/transcript/localized states) | `yarn test:components` (684 tests incl. `AiChatExecutionRow.persistFailure.test.ts`) |
| AC-16 (queue-drained durable run) | `aiChatWorkspaceCoordinator.test.ts` ("dispatchQueuedTurn gives a drained row…") |
| AC-17 (unclassified exit fails) | `aiChatWorkspaceCoordinator.test.ts` ("records an unclassified exit as failed…") |
| AC-18 (side-effect counters per outcome) | `AIChatQueryEngine.runTurn.test.ts` ("post-terminal side effects fire once on completed and never on a pause") |

**Gates at Stage A completion:** `yarn testmain` 5700 passed (1 known flaky timing test, `EmailReplyRecovery.model.test.ts`, passes in isolation and predates this branch); service vitest 2534 passed (1 load-order flake `ToolExecutor.searchRecovery.test.ts`, passes in isolation, untouched by this diff); `yarn test:components` 684 passed; `yarn typecheck` + `yarn vue-typecheck` 0 errors.

## 3. Rollback (Stage A)

Stage A adds no entity, migration, or history-format change. Rollback = release revert. The run-model transition table widened `queued` to accept `awaiting_*` (backward-compatible: existing rows never transition awaiting→queued on old code).

## 4. Performance budget procedure (release gate record)

Per PRD §5, before each stage's release: measure with identical scripted provider fixtures (text, reasoning, multi-tool, progress-burst, cancellation), ≥30 runs after warmup, same machine. Measure **presenter-intake latency** (when `workspaceStreamPresenter.applyEvent` receives the event, before its 50 ms batching window) minus provider chunk emission time; added p95 must be ≤20 ms. Record total scripted run duration and peak streaming-buffer memory (≤10% regression allowed). Record baseline, variance, and result here:

| Fixture | Baseline p95 (ms) | Post-change p95 (ms) | Runs | Result |
| --- | --- | --- | --- | --- |
| _(fill at release gate)_ | | | | |

## 5. Stage B status

**B2 infrastructure delivered** (`src/service/aiChat/`): `consumeGenerator`
(result-preserving consumer, design §6), `LatestValueSlot` +
`runToolWithProgress` (progress multiplexer, design §12) — 14 tests in
`test/vitest/main/service/aiChatGeneratorInfrastructure.test.ts`.

**Remaining (deferred):** B1 provider `streamEvents` iterator + callback
facade (hosted retry conversion, `aiChatApi.ts:2259+`), B2-full
`AIChatQueryLoop.iterate()` conversion with `run()` draining facade, and B3
`AI_CHAT_STREAM_IMPLEMENTATION` flag + owner consumer switch. See the
implementation plan (`docs/superpowers/plans/2026-09-26-generator-streaming.md`,
Tasks B1-B3). Per PRD §1, Stage B may be deferred without losing Stage A's
guarantees; Stage A shipped on the existing sink transport behind no flag.
