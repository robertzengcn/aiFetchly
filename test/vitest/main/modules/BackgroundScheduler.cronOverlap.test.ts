import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ScheduleStatus,
  TaskType,
  TriggerType,
} from "@/entity/ScheduleTask.entity";
import { TriggerType as LogTriggerType } from "@/entity/ScheduleExecutionLog.entity";

const mocks = vi.hoisted(() => ({
  getSchedulesReadyToExecute: vi.fn(),
  getScheduleById: vi.fn(),
  incrementExecutionCount: vi.fn(),
  updateLastRunTime: vi.fn(),
  updateNextRunTime: vi.fn(),
  updateLastErrorMessage: vi.fn(),
  logExecution: vi.fn(),
  updateExecutionStatus: vi.fn(),
  getExecutionById: vi.fn(),
  executeScheduledTask: vi.fn(),
  calculateNextRunTime: vi.fn(),
}));

vi.mock("@/config/SqliteDb", () => ({
  SqliteDb: {
    getInstance: () => ({ connection: {} }),
    getLiveInstance: () => ({ connection: {} }),
    ensureInitialized: vi.fn(async () => undefined),
    resetInstance: vi.fn(async () => ({ connection: {}, isInitialized: true })),
  },
}));

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): string {
      return "/tmp/bg-cron-overlap";
    }
  },
}));

vi.mock("@/modules/ScheduleManager", () => ({
  ScheduleManager: {
    getInstance: () => ({
      initializeSchedules: vi.fn(async () => undefined),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      handleAppShutdown: vi.fn(async () => undefined),
      getSchedulerStatus: () => ({
        isRunning: true,
        activeSchedules: 1,
        totalSchedules: 1,
      }),
      calculateNextRunTime: mocks.calculateNextRunTime,
      executeDependentJobs: vi.fn(async () => undefined),
      cleanupInactiveDependencies: vi.fn(async () => 0),
    }),
    destroyInstance: vi.fn(async () => undefined),
  },
}));

vi.mock("@/modules/ScheduleTaskModule", () => ({
  ScheduleTaskModule: class {
    getSchedulesReadyToExecute = mocks.getSchedulesReadyToExecute;
    getSchedulesByTriggerType = vi.fn(async () => []);
    getScheduleById = mocks.getScheduleById;
    incrementExecutionCount = mocks.incrementExecutionCount;
    updateLastRunTime = mocks.updateLastRunTime;
    updateNextRunTime = mocks.updateNextRunTime;
    updateLastErrorMessage = mocks.updateLastErrorMessage;
  },
}));

vi.mock("@/model/ScheduleExecutionLog.model", () => ({
  ScheduleExecutionLogModel: class {
    logExecution = mocks.logExecution;
    updateExecutionStatus = mocks.updateExecutionStatus;
    getExecutionById = mocks.getExecutionById;
    getRunningExecutions = vi.fn(async () => []);
    cleanupOldExecutions = vi.fn(async () => 0);
  },
}));

vi.mock("@/modules/TaskExecutorService", () => ({
  TaskExecutorService: class {
    executeScheduledTask = mocks.executeScheduledTask;
  },
}));

import { BackgroundScheduler } from "@/modules/BackgroundScheduler";
import { ScheduleExecutionGuard } from "@/modules/ScheduleExecutionGuard";

type PrivateBg = {
  isRunning: boolean;
  executionQueue: Array<{
    scheduleId: number;
    priority: number;
    retryCount: number;
    maxRetries: number;
    triggeredBy: LogTriggerType;
    scheduledTime: Date;
  }>;
  runningExecutions: Set<number>;
  processScheduledTasks(): Promise<void>;
  processExecutionQueue(): Promise<void>;
  executeScheduleWithRetry(item: {
    scheduleId: number;
    priority: number;
    retryCount: number;
    maxRetries: number;
    triggeredBy: LogTriggerType;
    scheduledTime: Date;
  }): Promise<void>;
};

const CRON_SCHED_A = {
  id: 10,
  name: "Cron A",
  task_type: TaskType.AI_MESSAGE,
  task_id: 500,
  is_active: true,
  status: ScheduleStatus.ACTIVE,
  trigger_type: TriggerType.CRON,
  cron_expression: "0 6 * * *",
};

const CRON_SCHED_B = {
  id: 11,
  name: "Cron B (same task)",
  task_type: TaskType.AI_MESSAGE,
  task_id: 500,
  is_active: true,
  status: ScheduleStatus.ACTIVE,
  trigger_type: TriggerType.CRON,
  cron_expression: "5 6 * * *",
};

beforeEach(() => {
  ScheduleExecutionGuard.getInstance().clear();
  vi.clearAllMocks();
  mocks.getSchedulesReadyToExecute.mockResolvedValue([]);
  mocks.logExecution.mockResolvedValue(1);
  mocks.updateExecutionStatus.mockResolvedValue(undefined);
  mocks.incrementExecutionCount.mockResolvedValue(undefined);
  mocks.updateLastRunTime.mockResolvedValue(undefined);
  mocks.updateNextRunTime.mockResolvedValue(undefined);
  mocks.updateLastErrorMessage.mockResolvedValue(undefined);
  mocks.getExecutionById.mockResolvedValue(null);
  mocks.calculateNextRunTime.mockReturnValue(
    new Date("2026-09-28T06:00:00.000Z")
  );
  mocks.executeScheduledTask.mockResolvedValue(undefined);
});

describe("BackgroundScheduler CRON & cross-schedule overlap guards", () => {
  it("does not enqueue a schedule that is already running in BackgroundScheduler or ScheduleExecutionGuard", async () => {
    const externalLease = ScheduleExecutionGuard.getInstance().tryAcquireSchedule(10);
    expect(externalLease).not.toBeNull();

    try {
      mocks.getSchedulesReadyToExecute.mockResolvedValue([CRON_SCHED_A]);
      const scheduler = new BackgroundScheduler(
        "/tmp/bg-cron-overlap"
      ) as unknown as PrivateBg;
      scheduler.isRunning = true;

      await scheduler.processScheduledTasks();

      expect(scheduler.executionQueue).toHaveLength(0);
    } finally {
      externalLease?.release();
    }
  });

  it("defers a queued schedule when another schedule targeting the same task_id is currently executing (Bug #5)", async () => {
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    mocks.executeScheduledTask.mockImplementationOnce(() => gate);
    mocks.getScheduleById.mockImplementation(async (id: number) => {
      if (id === 10) return CRON_SCHED_A;
      if (id === 11) return CRON_SCHED_B;
      return null;
    });

    const scheduler = new BackgroundScheduler(
      "/tmp/bg-cron-overlap"
    ) as unknown as PrivateBg;
    scheduler.isRunning = true;
    scheduler.executionQueue.push(
      {
        scheduleId: 10,
        priority: 1,
        retryCount: 0,
        maxRetries: 3,
        triggeredBy: LogTriggerType.CRON,
        scheduledTime: new Date(1000),
      },
      {
        scheduleId: 11,
        priority: 1,
        retryCount: 0,
        maxRetries: 3,
        triggeredBy: LogTriggerType.CRON,
        scheduledTime: new Date(2000),
      }
    );

    await scheduler.processExecutionQueue();

    // Schedule 10 starts; Schedule 11 (same task_id 500) is deferred in the queue.
    await vi.waitFor(() => {
      expect(mocks.executeScheduledTask).toHaveBeenCalledTimes(1);
    });
    expect(mocks.executeScheduledTask).toHaveBeenCalledWith(CRON_SCHED_A, 1);
    expect(scheduler.executionQueue.map((i) => i.scheduleId)).toEqual([11]);

    // Finish Schedule 10 -> Schedule 11 can now proceed on the next queue poll.
    releaseFirst();
    await vi.waitFor(() => {
      expect(scheduler.runningExecutions.size).toBe(0);
    });

    mocks.executeScheduledTask.mockResolvedValueOnce(undefined);
    await scheduler.processExecutionQueue();

    await vi.waitFor(() => {
      expect(mocks.executeScheduledTask).toHaveBeenCalledTimes(2);
    });
    expect(mocks.executeScheduledTask).toHaveBeenLastCalledWith(
      CRON_SCHED_B,
      1
    );
  });

  it("advances next_run_time on CRON execution failure so it does not spin every 60s", async () => {
    mocks.getScheduleById.mockResolvedValue(CRON_SCHED_A);
    mocks.executeScheduledTask.mockRejectedValue(new Error("AI run failed"));

    const scheduler = new BackgroundScheduler(
      "/tmp/bg-cron-overlap"
    ) as unknown as PrivateBg;
    scheduler.isRunning = true;

    await scheduler.executeScheduleWithRetry({
      scheduleId: 10,
      priority: 1,
      retryCount: 3,
      maxRetries: 3,
      triggeredBy: LogTriggerType.CRON,
      scheduledTime: new Date(),
    });

    expect(mocks.incrementExecutionCount).toHaveBeenCalledWith(10, false);
    expect(mocks.updateNextRunTime).toHaveBeenCalledWith(
      10,
      new Date("2026-09-28T06:00:00.000Z")
    );
  });
});
