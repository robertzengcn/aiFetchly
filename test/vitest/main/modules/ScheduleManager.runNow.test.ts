import { beforeEach, describe, expect, it, vi } from "vitest";

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
  cron_expression: "0 6 * * *",
};

beforeEach(async () => {
  await ScheduleManager.destroyInstance();
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
});
