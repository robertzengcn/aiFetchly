import { beforeEach, describe, expect, it } from "vitest";
import { TaskType } from "@/entity/ScheduleTask.entity";
import { ScheduleExecutionGuard } from "@/modules/ScheduleExecutionGuard";

describe("ScheduleExecutionGuard", () => {
  beforeEach(() => {
    ScheduleExecutionGuard.getInstance().clear();
  });

  it("serializes same-schedule acquisition across callers and allows re-acquire after release", () => {
    const guard = ScheduleExecutionGuard.getInstance();

    const first = guard.tryAcquireSchedule(42);
    expect(first).not.toBeNull();
    expect(guard.isScheduleRunning(42)).toBe(true);

    const second = guard.tryAcquireSchedule(42);
    expect(second).toBeNull();

    // Idempotent release clears once, never double-deletes another owner's lease.
    first?.release();
    expect(guard.isScheduleRunning(42)).toBe(false);

    const third = guard.tryAcquireSchedule(42);
    expect(third).not.toBeNull();
    expect(guard.isScheduleRunning(42)).toBe(true);

    // Calling release again on stale lease `first` must NOT release `third`.
    first?.release();
    expect(guard.isScheduleRunning(42)).toBe(true);

    third?.release();
    expect(guard.isScheduleRunning(42)).toBe(false);
  });

  it("serializes different schedules targeting the same (taskType, taskId) while allowing distinct tasks", () => {
    const guard = ScheduleExecutionGuard.getInstance();

    const taskLeaseA = guard.tryAcquireTask(TaskType.AI_MESSAGE, 100);
    expect(taskLeaseA).not.toBeNull();
    expect(guard.isTaskRunning(TaskType.AI_MESSAGE, 100)).toBe(true);

    // Same task, different schedule -> rejected while active.
    expect(guard.tryAcquireTask(TaskType.AI_MESSAGE, 100)).toBeNull();

    // Different task ID or different task type -> allowed concurrently.
    const taskLeaseB = guard.tryAcquireTask(TaskType.AI_MESSAGE, 101);
    const taskLeaseC = guard.tryAcquireTask(TaskType.EMAIL_EXTRACT, 100);
    expect(taskLeaseB).not.toBeNull();
    expect(taskLeaseC).not.toBeNull();

    taskLeaseA?.release();
    expect(guard.isTaskRunning(TaskType.AI_MESSAGE, 100)).toBe(false);

    const taskLeaseA2 = guard.tryAcquireTask(TaskType.AI_MESSAGE, 100);
    expect(taskLeaseA2).not.toBeNull();
    taskLeaseA?.release(); // stale lease must not clear A2
    expect(guard.isTaskRunning(TaskType.AI_MESSAGE, 100)).toBe(true);

    taskLeaseA2?.release();
    taskLeaseB?.release();
    taskLeaseC?.release();
  });
});
