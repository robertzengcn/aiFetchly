import { describe, expect, it, beforeEach, vi } from "vitest";

// --- Controllable stubs ---
const mockFindDue = vi.hoisted(() => vi.fn());
const mockClaim = vi.hoisted(() => vi.fn());
const mockGetByTrigger = vi.hoisted(() => vi.fn());
const mockPauseWithReason = vi.hoisted(() => vi.fn());
const mockMarkInterrupted = vi.hoisted(() => vi.fn());
const mockRunChatLoop = vi.hoisted(() => vi.fn());
const mockCleanupInactiveDependencies = vi.hoisted(() => vi.fn());
const mockCleanupOldExecutions = vi.hoisted(() => vi.fn());
const mockScheduleManagerDestroy = vi.hoisted(() => vi.fn());
const mockScheduleManagerGet = vi.hoisted(() => vi.fn());
const mockSqliteDbReset = vi.hoisted(() =>
  vi.fn(async () => ({ connection: {}, isInitialized: true }))
);

vi.mock("@/config/SqliteDb", () => ({
  SqliteDb: {
    getInstance: () => ({ connection: {} }),
    ensureInitialized: vi.fn(async () => undefined),
    resetInstance: mockSqliteDbReset,
  },
}));
vi.mock("@/modules/ScheduleManager", () => ({
  ScheduleManager: {
    getInstance: mockScheduleManagerGet,
    destroyInstance: mockScheduleManagerDestroy,
    resetInstance: vi.fn(async () => ({
      initializeSchedules: vi.fn(async () => undefined),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      handleAppShutdown: vi.fn(async () => undefined),
      getSchedulerStatus: () => ({ activeSchedules: 0, totalSchedules: 0 }),
      cleanupInactiveDependencies: mockCleanupInactiveDependencies,
    })),
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
  ScheduleExecutionLogModel: vi.fn().mockImplementation(() => ({
    cleanupOldExecutions: mockCleanupOldExecutions,
  })),
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

// Token.getValue(USERSDBPATH) drives refreshDatabaseForUserPath(). Hoist the
// resolver so each test can pin the "current" user path.
const mockGetValue = vi.hoisted(() => vi.fn());
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({ getValue: mockGetValue })),
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
  isInitialized: boolean;
  currentDbPath: string;
  intervalScheduleModel: { modelTag: string } | null;
  intervalRunModel: { modelTag: string } | null;
  processIntervalTasks(): Promise<void>;
  recoverIntervalRuns(): Promise<void>;
  performCleanup(): Promise<void>;
  refreshDatabaseForUserPath(): Promise<void>;
  start(): Promise<void>;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockScheduleManagerDestroy.mockResolvedValue(undefined);
  mockScheduleManagerGet.mockImplementation(() => ({
    initializeSchedules: vi.fn(async () => undefined),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    handleAppShutdown: vi.fn(async () => undefined),
    getSchedulerStatus: () => ({ activeSchedules: 0, totalSchedules: 0 }),
    cleanupInactiveDependencies: mockCleanupInactiveDependencies,
  }));
  mockFindDue.mockResolvedValue([]);
  mockClaim.mockResolvedValue({ kind: "not_due" });
  mockGetByTrigger.mockResolvedValue([]);
  mockMarkInterrupted.mockResolvedValue(0);
  mockCleanupInactiveDependencies.mockResolvedValue(0);
  mockCleanupOldExecutions.mockResolvedValue(0);
  mockRunChatLoop.mockResolvedValue({
    runId: 5,
    status: "completed",
    assistantFinalMessage: "",
    toolCallsCount: 0,
    blockedToolCalls: [],
  });
  // Default: Token reports the same path the scheduler was built with, so
  // refreshDatabaseForUserPath() short-circuits unless a test overrides this.
  mockGetValue.mockReturnValue("/tmp/sched-test");
});

describe("BackgroundScheduler.performCleanup", () => {
  it("uses the ScheduleManager dependency cleanup API", async () => {
    mockCleanupOldExecutions.mockResolvedValue(2);
    mockCleanupInactiveDependencies.mockResolvedValue(1);
    const scheduler = new BackgroundScheduler(
      "/tmp/sched-test"
    ) as unknown as PrivateScheduler;

    await scheduler.performCleanup();

    expect(mockCleanupOldExecutions).toHaveBeenCalledWith(30);
    expect(mockCleanupInactiveDependencies).toHaveBeenCalledTimes(1);
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

describe("BackgroundScheduler.refreshDatabaseForUserPath", () => {
  it("drops cached interval-trigger models so they re-create against the new connection", async () => {
    // Construct with the old path, then force the lazy interval models to be
    // instantiated (simulating at least one interval poll having run).
    const scheduler = new BackgroundScheduler(
      "/tmp/sched-old"
    ) as unknown as PrivateScheduler;
    scheduler.intervalScheduleModel = { modelTag: "stale-schedule" };
    scheduler.intervalRunModel = { modelTag: "stale-run" };

    // Token now reports a new user path → refresh must run the reset branch.
    mockGetValue.mockReturnValue("/tmp/sched-new");

    await scheduler.refreshDatabaseForUserPath();

    // The lazy interval models are reset to null so the next poll rebuilds
    // them against the new SqliteDb instance instead of the destroyed one.
    expect(scheduler.intervalScheduleModel).toBeNull();
    expect(scheduler.intervalRunModel).toBeNull();
    expect(scheduler.currentDbPath).toBe("/tmp/sched-new");
    // Initialization state is cleared so start() re-initializes cleanly.
    expect(scheduler.isInitialized).toBe(false);
  });

  it("rebuilds ScheduleManager only after replacing the shared database", async () => {
    const scheduler = new BackgroundScheduler("/tmp/sched-old");
    mockGetValue.mockReturnValue("/tmp/sched-new");

    await scheduler.refreshDatabaseForUserPath();

    const destroyOrder = mockScheduleManagerDestroy.mock.invocationCallOrder[0];
    const resetOrder = mockSqliteDbReset.mock.invocationCallOrder[0];
    const getOrders = mockScheduleManagerGet.mock.invocationCallOrder;
    expect(destroyOrder).toBeLessThan(resetOrder);
    expect(getOrders.at(-1)).toBeGreaterThan(resetOrder);
  });
});

describe("chatSchedulerLifecycleRegistry", () => {
  it("refresh/stop are no-ops until background.ts registers concrete hooks", async () => {
    // Dynamic import keeps the registry's module state isolated per test run.
    const {
      registerChatSchedulerLifecycle,
      refreshChatSchedulerForUserPath,
      stopChatScheduler,
    } = await import("@/main-process/chatSchedulerLifecycleRegistry");

    // With no registration, both helpers resolve silently (best-effort).
    await expect(refreshChatSchedulerForUserPath()).resolves.toBeUndefined();
    await expect(stopChatScheduler()).resolves.toBeUndefined();

    // Register concrete hooks and assert they are invoked.
    const refreshAndStart = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    registerChatSchedulerLifecycle({ refreshAndStart, stop });

    await refreshChatSchedulerForUserPath();
    await stopChatScheduler();
    expect(refreshAndStart).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);

    // Clearing the registration makes the helpers no-ops again.
    registerChatSchedulerLifecycle(null);
    await expect(refreshChatSchedulerForUserPath()).resolves.toBeUndefined();
    await expect(stopChatScheduler()).resolves.toBeUndefined();
    expect(refreshAndStart).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
