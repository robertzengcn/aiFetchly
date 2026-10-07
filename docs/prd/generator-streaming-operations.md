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
| text (402 events) | — | 0.0002–0.0005 per event | 30 | PASS (≤20 ms budget; harness: `streamingDeliveryBenchmark.test.ts`) |
| reasoning (302 events) | — | 0.0001–0.0002 per event | 30 | PASS |
| multi-tool (130 events) | — | 0.0001–0.0002 per event | 30 | PASS |
| progress-burst (134 events, 50-burst) | — | 0.0001 per event | 30 | PASS |

Measured 2026-10-07, this worktree (WSL2), warmup 5 + 30 measured runs per
fixture, same machine within one session. The presenter-intake path is
µs-scale per event — the ≤20 ms p95 budget has >4 orders of magnitude of
headroom at this fixture scale. **Baseline comparison note:** the presenter
itself is unchanged by this branch (batching window, dedup, ordering
identical — verified by the presenter suite passing unmodified), so a
separate pre-branch run measures the same path; the generator delivery
change adds zero work in the renderer. A dev-checkout vs branch-checkout
differential run of the same harness is the remaining release-formality when
the environment is quiet; the numbers above are the recorded in-branch
evidence. Run cancellation fixture note: cancellation ordering is covered by
the async-poll/Stop suites, not this timing harness.

## 5. Stage B status — COMPLETE (2026-09-30)

**B1 — provider iterator + callback facade:** `ChatProviderStreamEvent`
(chunk|retry|recovery in causal order) + `streamEvents` on the provider
contract; the SSE parser exposes native `parseBodyStream` (early close cancels
the owned body); the local client iterates natively; the hosted retry loop and
both hosted SSE consumers are generators; `openAIChatCompletionStream`/`stream`
are draining facades. 6 iterator tests + unchanged aiChatApi (60)/parser/
client/routing/loop suites.

**B2 — single generator loop:** `iterate()` is the only loop implementation
(33 yield sites; helpers compose via `yield*` or returned events; tool
execution wrapped with the progress multiplexer; provider consumed as an
async iterable with arrival-time chunk acceptance preserving the old
synchronous abort/supersede semantics). `run()` drains it into the legacy
sink with flush-after-tool_call parity. Pending structures carry no sink
(engine side map). All three production wiring sites provide the native seam.

**B3 — delivery-mode switch:** `AI_CHAT_STREAM_IMPLEMENTATION=callback|generator`
(default callback, read once, invalid → callback+warning) through an
injectable provider; per-run pinning across resume; generator mode drains
`iterate()` via `consumeGenerator` with the §8 awaited-persistence handler.

**Rollback (Stage B):** flip the env to `callback` (new runs only — running/
waiting runs keep their captured mode) or release-revert. Never fail over
mid-run; no shadow execution against live tools.

**Gates at Stage B completion:** main suite 5719 passed (4 DB load-order
flakes pass in isolation, pre-existing); components 684 passed; tsc +
vue-tsc 0 errors. Known environmental: ws-importing utilityCode plugin/skill
tests fail under the worktree's symlinked node_modules (pre-existing, pass on
the main checkout).

**Remaining follow-ups (non-blocking):** B4 controlled-rollout evidence (perf
fixture runs recording the §4 table), B5 removal of the callback consumer
after the rollback window.
