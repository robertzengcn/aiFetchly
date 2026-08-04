import { describe, expect, it, beforeEach, vi } from "vitest";

// --- Controllable stubs ---
const mockFindDue = vi.hoisted(() => vi.fn());
const mockClaim = vi.hoisted(() => vi.fn());
const mockGetByTrigger = vi.hoisted(() => vi.fn());
const mockPauseWithReason = vi.hoisted(() => vi.fn());
const mockMarkInterrupted = vi.hoisted(() => vi.fn());
const mockRunChatLoop = vi.hoisted(() => vi.fn());

vi.mock("@/config/SqliteDb", () => ({
  SqliteDb: {
    getInstance: () => ({ connection: {} }),
    ensureInitialized: vi.fn(async () => undefined),
    resetInstance: vi.fn(async () => ({ connection: {}, isInitialized: true })),
  },
}));
vi.mock("@/modules/ScheduleManager", () => ({
  ScheduleManager: {
    getInstance: () => ({
      initializeSchedules: vi.fn(async () => undefined),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      handleAppShutdown: vi.fn(async () => undefined),
      getSchedulerStatus: () => ({ activeSchedules: 0, totalSchedules: 0 }),
      resetInstance: vi.fn(async () => ({})),
    }),
  },
}));
vi.mock("@/modules/ScheduleTaskModule", () => ({
  ScheduleTaskModule: vi.fn().mockImplementation(() => ({
    getSchedulesReadyToExecute: vi.fn(async () => []),
    getSchedulesByTriggerType: vi.fn(async () => []),
    getScheduleById: vi.fn(async () => null),
  })),
}));
vi.mock("@/model/ScheduleExecutionLog.model", () => ({
  ScheduleExecutionLogModel: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@/modules/TaskExecutorService", () => ({
  TaskExecutorService: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@/model/ScheduleTask.model", () => ({
  ScheduleTaskModel: vi.fn().mockImplementation(() => ({
    findDueIntervalSchedules: mockFindDue,
    claimIntervalOccurrence: mockClaim,
    getSchedulesByTriggerType: mockGetByTrigger,
    pauseWithReason: mockPauseWithReason,
  })),
}));
vi.mock("@/model/AiMessageTaskRun.model", () => ({
  AiMessageTaskRunModel: vi.fn().mockImplementation(() => ({
    markInterruptedRuns: mockMarkInterrupted,
  })),
}));
vi.mock("@/service/ScheduledAiMessageRunner", () => ({
  ScheduledAiMessageRunner: vi.fn().mockImplementation(() => ({
    runChatScheduledLoop: mockRunChatLoop,
  })),
}));

import { BackgroundScheduler } from "@/modules/BackgroundScheduler";

const SCHED = {
  id: 3,
  task_id: 1,
  source_conversation_id: "v2-conv",
  is_active: true,
  status: "active",
  trigger_type: "interval",
};

type PrivateScheduler = {
  isRunning: boolean;
  processIntervalTasks(): Promise<void>;
  recoverIntervalRuns(): Promise<void>;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFindDue.mockResolvedValue([]);
  mockClaim.mockResolvedValue({ kind: "not_due" });
  mockGetByTrigger.mockResolvedValue([]);
  mockMarkInterrupted.mockResolvedValue(0);
  mockRunChatLoop.mockResolvedValue({
    runId: 5,
    status: "completed",
    assistantFinalMessage: "",
    toolCallsCount: 0,
    blockedToolCalls: [],
  });
});

describe("BackgroundScheduler.processIntervalTasks", () => {
  it("routes a claimed occurrence to the runner", async () => {
    mockFindDue.mockResolvedValue([SCHED]);
    mockClaim.mockResolvedValue({
      kind: "claimed",
      runId: 5,
      occurrence: 1,
      catchUp: false,
      scheduledFor: new Date(0),
      idempotencyKey: "scheduled-loop:3:1",
      coalescedCount: 0,
    });
    const scheduler = new BackgroundScheduler(
      "/tmp/sched-test"
    ) as unknown as PrivateScheduler;
    scheduler.isRunning = true;

    await scheduler.processIntervalTasks();

    expect(mockClaim).toHaveBeenCalledWith({
      scheduleId: 3,
      now: expect.any(Date),
    });
    expect(mockRunChatLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 1,
        scheduleId: 3,
        runId: 5,
        occurrence: 1,
      })
    );
  });

  it("does not invoke the runner when the claim is coalesced", async () => {
    mockFindDue.mockResolvedValue([SCHED]);
    mockClaim.mockResolvedValue({ kind: "coalesced", coalescedCount: 1 });
    const scheduler = new BackgroundScheduler(
      "/tmp/sched-test"
    ) as unknown as PrivateScheduler;
    scheduler.isRunning = true;

    await scheduler.processIntervalTasks();

    expect(mockRunChatLoop).not.toHaveBeenCalled();
  });

  it("skips work when the scheduler is not running", async () => {
    mockFindDue.mockResolvedValue([SCHED]);
    const scheduler = new BackgroundScheduler(
      "/tmp/sched-test"
    ) as unknown as PrivateScheduler;
    scheduler.isRunning = false;

    await scheduler.processIntervalTasks();

    expect(mockFindDue).not.toHaveBeenCalled();
  });
});

describe("BackgroundScheduler.recoverIntervalRuns", () => {
  it("marks stale runs interrupted and pauses only orphaned schedules", async () => {
    mockMarkInterrupted.mockResolvedValue(2);
    mockGetByTrigger.mockResolvedValue([
      { id: 7, is_active: true, source_conversation_id: null },
      { id: 8, is_active: true, source_conversation_id: "v2-x" },
      { id: 9, is_active: false, source_conversation_id: null },
    ]);
    const scheduler = new BackgroundScheduler(
      "/tmp/sched-test"
    ) as unknown as PrivateScheduler;

    await scheduler.recoverIntervalRuns();

    // markInterruptedRuns called with a cutoff near now - stale window.
    expect(mockMarkInterrupted).toHaveBeenCalledTimes(1);
    expect(mockPauseWithReason).toHaveBeenCalledWith(
      7,
      "CONVERSATION_NOT_FOUND"
    );
    // Active schedule with a valid conversation is NOT paused.
    expect(mockPauseWithReason).not.toHaveBeenCalledWith(8, expect.anything());
    // Inactive orphan is not touched (is_active false → skipped).
    expect(mockPauseWithReason).not.toHaveBeenCalledWith(9, expect.anything());
  });
});
