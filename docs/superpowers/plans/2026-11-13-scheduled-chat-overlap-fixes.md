# Scheduled Chat Overlap & Concurrency Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate concurrency, stuck-state, registry-corruption, and false-success bugs when scheduled chat runs overlap on the same schedule, task, or conversation.

**Architecture:** Enforce ownership checks on `ScheduledLoopEngineRegistry` and runner cleanup; recover/retire `"waiting_for_conversation"` interval runs both in-process and at startup; coordinate `ScheduleManager` and `BackgroundScheduler` through a shared in-memory `ScheduleExecutionGuard` keyed by `scheduleId` and `(taskType, taskId)`; and propagate non-`completed` AI runner outcomes as failures in `TaskExecutorService`.

**Tech Stack:** Electron, TypeScript, TypeORM / better-sqlite3, `cron`, Vitest.

**Spec:** User-approved 5-bug remediation grounded in `docs/prd/ai-chat-scheduled-loop-technical-design.md` (§15–16) and codebase audit of `ScheduleManager`, `BackgroundScheduler`, `TaskExecutorService`, `ScheduledAiMessageRunner`, `ScheduledLoopEngineRegistry`, `AiMessageTaskRunModel`, and `ScheduleTaskModel`.

## Global Constraints

- Never use `any` type; all new/modified functions must have explicit return types and use `unknown` in `catch` blocks (`AGENTS.md`).
- Database operations remain strictly in `Model` and `Module` classes (`BaseDb` / `BaseModule`); never bypass into IPC handlers.
- Strict TDD per `test-driven-development`: write failing test -> confirm failure -> minimal fix -> confirm pass -> commit logical unit.
- Preserve existing backwards compatibility for minimal test mocks (e.g., `ScheduleTaskModel` / `ScheduleManager` / `AiMessageTaskRunModel` partial mocks in existing unit suites).
- Auto-commit each completed logical unit of work (`<type>: <description>`), staging only modified/created files belonging to that task.

## Review Focus

- A failing/timed-out second run (`CONVERSATION_BUSY`) must never evict the currently active/parked first run's engine or pending permission from `ScheduledLoopEngineRegistry`.
- A `/loop` run marked `"waiting_for_conversation"` must never permanently wedge future occurrences (retry once free within window, retire to `"coalesced"` when next slot arrives or budget expires, and recover to `"interrupted"` across restart).
- A long-running (>60s) or retrying `CRON` schedule must never be launched twice concurrently by `BackgroundScheduler` and `ScheduleManager`, nor loop every 60s forever on repeated failure.
- Two different schedules targeting the same `TaskType.AI_MESSAGE` `task_id` must be serialized/deferred at scheduler dispatch rather than racing into the 30s lock timeout.
- Non-`"completed"` outcomes (`"failed"`, `"timeout"`, `"blocked_by_policy"`, including `CONVERSATION_BUSY`) from `ScheduledAiMessageRunner.run()` must cause `TaskExecutorService.executeAiMessageTask()` to throw so schedule execution logs/statistics/dependents report failure accurately.

---

### Task 1: Ownership-Safe `ScheduledLoopEngineRegistry` Unregistration & Runner Cleanup (Bug #1)

**Files:**
- Modify: `src/service/ScheduledLoopEngineRegistry.ts`
- Modify: `src/service/ScheduledAiMessageRunner.ts`
- Test: `test/vitest/main/service/ScheduledLoopEngineRegistry.test.ts`
- Test: `test/vitest/main/service/ScheduledAiMessageRunner.permission.test.ts`
- Test: `test/vitest/main/service/ScheduledAiMessageRunner.chatLoop.test.ts`

**Interfaces:**
- Produces:
  - `ScheduledLoopEngineRegistry.unregister(conversationId: string, runId?: number): void` — deletes `engines` and `pending` for `conversationId` only when `runId === undefined` or `this.engines.get(conversationId)?.runId === runId`.

- [ ] **Step 1: Write failing tests for run-scoped unregistration and `CONVERSATION_BUSY` cleanup**

In `test/vitest/main/service/ScheduledLoopEngineRegistry.test.ts`:
- `unregister(conversationId, wrongRunId)` leaves active engine and pending permission intact.
- `unregister(conversationId, matchingRunId)` removes active engine and pending permission.

In `test/vitest/main/service/ScheduledAiMessageRunner.chatLoop.test.ts`:
- Spy on `ScheduledLoopEngineRegistry.getInstance().unregister` (or keep active run registered for `"v2-conv"` under `runId = 1`) and verify that when `runChatScheduledLoop` (`runId = 2`) or `run()` fails at `acquire` (`CONVERSATION_BUSY`), `runId = 1`'s entry and pending permission remain registered.

- [ ] **Step 2: Run tests to verify failure**

Run Vitest on `ScheduledLoopEngineRegistry.test.ts` and `ScheduledAiMessageRunner.chatLoop.test.ts` and observe the new tests failing because `unregister` ignores `runId` and `finally` calls `unregister(conversationId)` unconditionally.

- [ ] **Step 3: Implement ownership check in `ScheduledLoopEngineRegistry` and `registeredEngine` guard in `ScheduledAiMessageRunner`**

- Update `ScheduledLoopEngineRegistry.unregister(conversationId: string, runId?: number): void` in `src/service/ScheduledLoopEngineRegistry.ts`.
- In both `runChatScheduledLoop` and `executeRunLoop` of `src/service/ScheduledAiMessageRunner.ts`, track `let registeredEngine = false;`, set `registeredEngine = true;` immediately after `engineRegistry.register(...)`, and guard `if (registeredEngine) { engineRegistry.unregister(conversationId, runId); }` in `finally`.
- Update existing `mockUnregisterEngine` expectations in `test/vitest/main/service/ScheduledAiMessageRunner.permission.test.ts` (`toHaveBeenCalledWith("v2-conv", 42)`).

- [ ] **Step 4: Run tests to verify pass + Commit**

Run Vitest on `ScheduledLoopEngineRegistry.test.ts`, `ScheduledAiMessageRunner.permission.test.ts`, and `ScheduledAiMessageRunner.chatLoop.test.ts`. Commit with `fix: scope ScheduledLoopEngineRegistry.unregister by runId and registration state`.

---

### Task 2: Recover / Retry `"waiting_for_conversation"` Runs and Defer Enrollment Until Lease Acquisition (Bug #2)

**Files:**
- Modify: `src/config/aiChatScheduledLoopConfig.ts`
- Modify: `src/model/AiMessageTaskRun.model.ts`
- Modify: `src/model/ScheduleTask.model.ts`
- Modify: `src/service/ScheduledAiMessageRunner.ts`
- Modify: `src/modules/BackgroundScheduler.ts`
- Test: `test/vitest/main/modules/ScheduleTaskModel.interval.test.ts`
- Test: `test/vitest/main/modules/BackgroundScheduler.interval.test.ts`
- Test: `test/vitest/main/service/ScheduledAiMessageRunner.chatLoop.test.ts`
- Test: `test/vitest/main/service/ScheduledAiMessageRunnerFinalize.test.ts`

**Interfaces:**
- Produces:
  - `SCHEDULED_LOOP_MAX_WAIT_ATTEMPTS = 2` in `src/config/aiChatScheduledLoopConfig.ts`
  - `AiMessageTaskRunModel.markInterruptedRuns(cutoff: Date): Promise<number>` (now also recovers `"waiting_for_conversation"` and stale `"pending"`)
  - `AiMessageTaskRunModel.findWaitingIntervalRuns(limit?: number): Promise<AiMessageTaskRunEntity[]>`
  - `AiMessageTaskRunModel.claimWaitingRunForRetry(runId: number): Promise<boolean>`
  - `AiMessageTaskRunModel.retireWaitingRun(runId: number, status: "coalesced" | "cancelled" | "interrupted", errorCode?: string): Promise<boolean>`

- [ ] **Step 1: Write failing tests for `"waiting_for_conversation"` startup recovery, live retry/retirement, next-slot supersession, and post-lease enrollment**

- In `test/vitest/main/modules/ScheduleTaskModel.interval.test.ts`:
  - `markInterruptedRuns(cutoff)` transitions stale `"waiting_for_conversation"` and stale `"pending"` rows (in addition to `"running"`) to `"interrupted"`.
  - `claimIntervalOccurrence` retires an existing `"waiting_for_conversation"` run for the schedule to `"coalesced"` (with `finished_at` set) and claims the newly due occurrence instead of returning `coalesced` forever.
  - `claimWaitingRunForRetry(runId)` atomically flips `"waiting_for_conversation"` -> `"pending"`, increments `attempt`, clears `error_code`, and returns `false` on a second claim.
- In `test/vitest/main/modules/BackgroundScheduler.interval.test.ts`:
  - `processIntervalTasks()` retries a `"waiting_for_conversation"` run via `runChatScheduledLoop` with the same `runId` / `occurrence` when the conversation is no longer busy (`isBusy === false`), `attempt < SCHEDULED_LOOP_MAX_WAIT_ATTEMPTS`, and `now < schedule.next_run_time`.
  - `processIntervalTasks()` retires an inactive/expired/timed-out/max-attempts `"waiting_for_conversation"` run (`retireWaitingRun`).
- In `test/vitest/main/service/ScheduledAiMessageRunnerFinalize.test.ts`:
  - When `flagOn = true` and `acquire` rejects (`CONVERSATION_BUSY`), `startScheduled` is NOT called prematurely.

- [ ] **Step 2: Run tests to verify failure**

Run Vitest on the 4 test files and confirm the new tests fail.

- [ ] **Step 3: Implement `"waiting_for_conversation"` recovery, retry/retirement, and post-lease enrollment**

- `src/config/aiChatScheduledLoopConfig.ts`: export `SCHEDULED_LOOP_MAX_WAIT_ATTEMPTS = 2`.
- `src/model/AiMessageTaskRun.model.ts`:
  - Update `markInterruptedRuns(cutoff)` to mark stale `"running"`, `"waiting_for_conversation"`, and `"pending"` rows (`started_at < cutoff` or `started_at IS NULL AND createdAt < cutoff`).
  - Add `findWaitingIntervalRuns(limit = 50)`, `claimWaitingRunForRetry(runId)`, and `retireWaitingRun(runId, status, errorCode)`.
- `src/model/ScheduleTask.model.ts`:
  - In `claimIntervalOccurrence`, only coalesce on `In(["pending", "running"])`; if a `"waiting_for_conversation"` row exists for `scheduleId`, mark it `"coalesced"` (`finished_at: now`, `error_code: existing.error_code ?? "CONVERSATION_BUSY"`), include `+1` in `coalesced_occurrence_count` alongside `skipped`, and claim the new due occurrence.
- `src/service/ScheduledAiMessageRunner.ts`:
  - In `runChatScheduledLoop`, move `enrollScheduledExecution(...)` to right after `coordinator.acquire(...)` succeeds inside the outer `try` (leaving `abortController` creation before `acquire`).
- `src/modules/BackgroundScheduler.ts`:
  - Add `private isProcessingIntervalTasks = false;` re-entrancy guard in `processIntervalTasks()`.
  - Add `processWaitingIntervalRuns(now)` at the start of `processIntervalTasks()` (safely checking `typeof runModel.findWaitingIntervalRuns === "function"` for minimal mocks) to retry free waiting runs within budget or retire stale/expired/inactive ones.

- [ ] **Step 4: Run tests to verify pass + Commit**

Verify all tests in `ScheduleTaskModel.interval.test.ts`, `BackgroundScheduler.interval.test.ts`, `ScheduledAiMessageRunner.chatLoop.test.ts`, and `ScheduledAiMessageRunnerFinalize.test.ts` pass. Commit with `fix: retry or retire waiting_for_conversation runs and defer policy enrollment`.

---

### Task 3: Unified Schedule/Task Execution Guard (`ScheduleExecutionGuard`) and Cron Overlap/Next-Run Fixes (Bugs #3 & #5)

**Files:**
- Create: `src/modules/ScheduleExecutionGuard.ts`
- Modify: `src/modules/ScheduleManager.ts`
- Modify: `src/modules/BackgroundScheduler.ts`
- Test: `test/vitest/main/modules/ScheduleExecutionGuard.test.ts`
- Test: `test/vitest/main/modules/ScheduleManager.runNow.test.ts`
- Test: `test/vitest/main/modules/BackgroundScheduler.interval.test.ts`

**Interfaces:**
- Produces:
  - `ScheduleExecutionGuard`:
    - `static getInstance(): ScheduleExecutionGuard`
    - `isScheduleRunning(scheduleId: number): boolean`
    - `isTaskRunning(taskType: TaskType, taskId: number): boolean`
    - `tryAcquireSchedule(scheduleId: number): (() => void) | null`
    - `tryAcquireTask(taskType: TaskType, taskId: number): (() => void) | null`
    - `clear(): void`
  - `ScheduleManager.isScheduleRunning(scheduleId: number): boolean`

- [ ] **Step 1: Write failing tests for cross-scheduler and same-task overlap prevention + failure `next_run_time` advance**

- `test/vitest/main/modules/ScheduleExecutionGuard.test.ts`:
  - Synchronous single-owner lock by `scheduleId` and by `(taskType, taskId)`; idempotent owner-token release never deletes another holder's lock.
- `test/vitest/main/modules/ScheduleManager.runNow.test.ts`:
  - Rejects/skips starting a second schedule (`scheduleId = 5`) when another schedule (`scheduleId = 4`) is actively running the same `(task_type: TaskType.AI_MESSAGE, task_id: 99)`.
  - Advances `next_run_time` when a `CRON` execution fails in `completeScheduleExecution` so `BackgroundScheduler` doesn't re-trigger it every 60s.
- `test/vitest/main/modules/BackgroundScheduler.interval.test.ts`:
  - `addToExecutionQueue` does not enqueue `scheduleId` when already in `runningExecutions` or held in `ScheduleExecutionGuard` / `ScheduleManager.isScheduleRunning`.
  - `processExecutionQueue` skips already-running `scheduleId` and defers (re-queues after loop) a different `scheduleId` targeting a `task_type + task_id` currently held in `ScheduleExecutionGuard`.
  - `executeScheduleWithRetry` advances `next_run_time` for `TriggerType.CRON` when `retryCount >= maxRetries` exhausts retries.

- [ ] **Step 2: Run tests to verify failure**

Run Vitest on `ScheduleExecutionGuard.test.ts`, `ScheduleManager.runNow.test.ts`, and `BackgroundScheduler.interval.test.ts` and confirm new tests fail.

- [ ] **Step 3: Implement `ScheduleExecutionGuard` and integrate into `ScheduleManager` and `BackgroundScheduler`**

- Create `src/modules/ScheduleExecutionGuard.ts` with token-checked maps for `activeSchedules` (`number`) and `activeTasks` (`string`).
- In `src/modules/ScheduleManager.ts`:
  - Acquire `ScheduleExecutionGuard.getInstance().tryAcquireSchedule(scheduleId)` synchronously in `executeSchedule`; check `this.executionGuard.tryAcquireTask(schedule.task_type, schedule.task_id)` when `schedule.task_type !== undefined && schedule.task_id !== undefined`; release both reliably in sync/async/`detach` `finally` blocks; expose `isScheduleRunning(scheduleId)`.
  - In `completeScheduleExecution` catch block, advance `next_run_time` when `schedule.trigger_type === TriggerType.CRON && schedule.cron_expression`.
- In `src/modules/BackgroundScheduler.ts`:
  - In `addToExecutionQueue` and `processExecutionQueue`, enforce `this.runningExecutions`, `this.scheduleManager.isScheduleRunning?.(...)`, and `this.executionGuard`.
  - In `processExecutionQueue`, hold `(scheduleId, taskKey)` guard leases across `executeScheduleWithRetry`; if `taskKey` is busy, release the `scheduleId` lease and defer `queueItem` to `deferredItems` pushed back after the drain loop; guard `this.runningExecutions.delete` with an execution token map (`activeExecutionTokens`).
  - In `processIntervalSchedule`, best-effort acquire `tryAcquireTask(TaskType.AI_MESSAGE, schedule.task_id)` while running `/loop` (still proceed to `runChatScheduledLoop` if held by another path so `/loop`'s 30s coordinator + wait recovery handles it without stranding `"pending"` rows).
  - In `executeScheduleWithRetry`, advance `next_run_time` on `TriggerType.CRON` once retries are exhausted (`retryCount >= maxRetries`).

- [ ] **Step 4: Run tests to verify pass + Commit**

Verify `ScheduleExecutionGuard.test.ts`, `ScheduleManager.runNow.test.ts`, `ScheduleManager.shutdown.test.ts`, `ScheduleController.runNowDetach.test.ts`, and `BackgroundScheduler.interval.test.ts` pass. Commit with `fix: coordinate active schedule and task execution across ScheduleManager and BackgroundScheduler`.

---

### Task 4: Propagate Failed / `CONVERSATION_BUSY` AI Message Run Outcomes in `TaskExecutorService` (Bug #4)

**Files:**
- Modify: `src/modules/TaskExecutorService.ts`
- Test: `test/vitest/main/modules/TaskExecutorService.test.ts`

**Interfaces:**
- Consumes: `ScheduledAiMessageRunner.run(taskId: number, scheduleId?: number): Promise<ScheduledAiMessageRunResult>`
- Produces: `TaskExecutorServiceDeps.createScheduledAiMessageRunner?: () => Pick<ScheduledAiMessageRunner, "run">` (optional DI hook)

- [ ] **Step 1: Write failing tests for non-completed `ScheduledAiMessageRunner.run()` results**

In `test/vitest/main/modules/TaskExecutorService.test.ts`:
- When `runner.run(1, 2)` returns `{ runId: 10, status: "completed", ... }`, `executeAiMessageTask(1, 2)` resolves `10`.
- When `runner.run(1, 2)` returns `{ runId: 11, status: "blocked_by_policy", errorMessage: "CONVERSATION_BUSY", ... }`, `executeAiMessageTask(1, 2)` throws an Error mentioning `CONVERSATION_BUSY`.
- When `runner.run(1, 2)` returns `{ runId: 12, status: "failed", errorMessage: "REMOTE_AI_ERROR", ... }` or `"timeout"`, `executeAiMessageTask(1, 2)` throws.

- [ ] **Step 2: Run test to verify failure**

Run Vitest on `TaskExecutorService.test.ts` and observe failure because `executeAiMessageTask` currently ignores `result.status`.

- [ ] **Step 3: Update `TaskExecutorService.executeAiMessageTask` to check `result.status`**

- Add optional `createScheduledAiMessageRunner` to `TaskExecutorServiceDeps` (defaulting to `() => new ScheduledAiMessageRunner()`).
- Throw `Error` when `result.status !== "completed"`.

- [ ] **Step 4: Run tests to verify pass + Commit**

Run Vitest on `TaskExecutorService.test.ts` (and `ScheduleManager.runNow.test.ts` / `BackgroundScheduler.interval.test.ts`). Commit with `fix: throw when ScheduledAiMessageRunner returns non-completed status`.

---

### Task 5: End-to-End Verification

- [ ] **Step 1**: Run full `yarn typecheck` (`tsc --noEmit`) cleanly with 0 errors.
- [ ] **Step 2**: Run full scheduler/runner/task Vitest suites + `yarn testmain` + `yarn test` (reporting exact outputs without touching pre-existing unrelated modified files).
