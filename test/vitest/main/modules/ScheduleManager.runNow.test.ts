import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleStatus, TaskType, TriggerType } from "@/entity/ScheduleTask.entity";
import { ScheduleExecutionGuard } from "@/modules/ScheduleExecutionGuard";

const mocks = vi.hoisted(() => ({
  getScheduleById: vi.fn(),
  logExecution: vi.fn(),
  updateExecutionStatus: vi.fn(),
  executeScheduledTask: vi.fn(),
  incrementExecutionCount: vi.fn(),
  updateLastRunTime: vi.fn(),
  updateNextRunTime: vi.fn(),
  updateLastErrorMessage: vi.fn(),
  getExecutionById: vi.fn(),
}));

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): string {
      return "/tmp/schedule-manager-run-now";
    }
  },
}));

vi.mock("@/modules/ScheduleTaskModule", () => ({
  ScheduleTaskModule: class {
    getScheduleById = mocks.getScheduleById;
    incrementExecutionCount = mocks.incrementExecutionCount;
    updateLastRunTime = mocks.updateLastRunTime;
    updateNextRunTime = mocks.updateNextRunTime;
    updateLastErrorMessage = mocks.updateLastErrorMessage;
  },
}));

vi.mock("@/modules/ScheduleExecutionLogModule", () => ({
  ScheduleExecutionLogModule: class {
    logExecution = mocks.logExecution;
    updateExecutionStatus = mocks.updateExecutionStatus;
    getExecutionById = mocks.getExecutionById;
  },
}));

vi.mock("@/modules/ScheduleDependencyModule", () => ({
  ScheduleDependencyModule: class {
    getDependenciesByParent = vi.fn(async () => []);
  },
}));

vi.mock("@/modules/TaskExecutorService", () => ({
  TaskExecutorService: class {
    executeScheduledTask = mocks.executeScheduledTask;
  },
}));

vi.mock("@/model/SchedulerStatus.model", () => ({
  isDatabaseConnectionClosedError: (error: unknown): boolean =>
    error instanceof Error &&
    error.message === "The database connection is not open",
  SchedulerStatusModel: class {
    isConnectionOpen(): boolean {
      return true;
    }
    async updateStatus(): Promise<void> {
      return undefined;
    }
  },
}));

vi.mock("cron", () => ({
  CronJob: class {
    nextDate(): { toJSDate: () => Date } {
      return { toJSDate: () => new Date("2026-09-27T06:00:00.000Z") };
    }
  },
}));

import { ScheduleManager } from "@/modules/ScheduleManager";

const activeSchedule = {
  id: 4,
  name: "Daily outreach",
  is_active: true,
  status: ScheduleStatus.ACTIVE,
  cron_expression: "0 6 * * *",
};

beforeEach(async () => {
  await ScheduleManager.destroyInstance();
  ScheduleExecutionGuard.getInstance().clear();
  vi.clearAllMocks();
  mocks.getScheduleById.mockResolvedValue(activeSchedule);
  mocks.logExecution.mockResolvedValue(11);
  mocks.updateExecutionStatus.mockResolvedValue(undefined);
  mocks.incrementExecutionCount.mockResolvedValue(undefined);
  mocks.updateLastRunTime.mockResolvedValue(undefined);
  mocks.updateNextRunTime.mockResolvedValue(undefined);
  mocks.updateLastErrorMessage.mockResolvedValue(undefined);
  mocks.getExecutionById.mockResolvedValue(null);
});

describe("ScheduleManager.executeSchedule detach", () => {
  it("returns after the run is accepted and starts the task afterward", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.executeScheduledTask.mockImplementation(() => gate);

    const pending = ScheduleManager.getInstance().executeSchedule(4, {
      detach: true,
    });
    await pending;

    expect(mocks.logExecution).toHaveBeenCalled();
    expect(mocks.executeScheduledTask).not.toHaveBeenCalled();

    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(mocks.executeScheduledTask).toHaveBeenCalledTimes(1);

    release();
    await gate;
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  });

  it("waits for the task when the caller does not detach", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.executeScheduledTask.mockImplementation(() => gate);

    let settled = false;
    const pending = ScheduleManager.getInstance()
      .executeSchedule(4)
      .then(() => {
        settled = true;
      });

    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(settled).toBe(false);
    expect(mocks.executeScheduledTask).toHaveBeenCalledTimes(1);

    release();
    await pending;
    expect(settled).toBe(true);
  });

  it("skips a paused schedule without starting the task", async () => {
    mocks.getScheduleById.mockResolvedValue({
      ...activeSchedule,
      status: ScheduleStatus.PAUSED,
    });

    await ScheduleManager.getInstance().executeSchedule(4);

    expect(mocks.logExecution).not.toHaveBeenCalled();
    expect(mocks.executeScheduledTask).not.toHaveBeenCalled();
  });

  it("skips execution when another scheduler already holds the schedule lock", async () => {
    const externalLease = ScheduleExecutionGuard.getInstance().tryAcquireSchedule(4);
    expect(externalLease).not.toBeNull();
    try {
      await ScheduleManager.getInstance().executeSchedule(4);
      expect(mocks.logExecution).not.toHaveBeenCalled();
      expect(mocks.executeScheduledTask).not.toHaveBeenCalled();
    } finally {
      externalLease?.release();
    }
  });

  it("skips execution when another schedule targeting the same task is already running", async () => {
    mocks.getScheduleById.mockResolvedValue({
      ...activeSchedule,
      trigger_type: TriggerType.CRON,
      task_type: TaskType.AI_MESSAGE,
      task_id: 99,
    });
    const activeTaskLease = ScheduleExecutionGuard.getInstance().tryAcquireTask(
      TaskType.AI_MESSAGE,
      99
    );
    expect(activeTaskLease).not.toBeNull();
    try {
      await ScheduleManager.getInstance().executeSchedule(4);
      expect(mocks.logExecution).not.toHaveBeenCalled();
      expect(mocks.executeScheduledTask).not.toHaveBeenCalled();
    } finally {
      activeTaskLease?.release();
    }
  });

  it("advances next_run_time on CRON execution failure so BackgroundScheduler does not re-queue forever", async () => {
    mocks.getScheduleById.mockResolvedValue({
      ...activeSchedule,
      trigger_type: TriggerType.CRON,
      task_type: TaskType.AI_MESSAGE,
      task_id: 99,
    });
    mocks.executeScheduledTask.mockRejectedValue(new Error("AI_TASK_FAILED"));

    await ScheduleManager.getInstance().executeSchedule(4);

    expect(mocks.incrementExecutionCount).toHaveBeenCalledWith(4, false);
    expect(mocks.updateNextRunTime).toHaveBeenCalledWith(
      4,
      new Date("2026-09-27T06:00:00.000Z")
    );
  });
});
