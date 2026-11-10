import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUpdateStatus = vi.hoisted(() => vi.fn(async () => undefined));
const mockIsConnectionOpen = vi.hoisted(() => vi.fn(() => true));
const mockLogError = vi.hoisted(() => vi.fn());

vi.mock("@/modules/Logger", () => ({
  log: {
    info: vi.fn(),
    error: mockLogError,
  },
}));

vi.mock("@/modules/token", () => ({
  Token: class {
    constructor() {
      return {
    getValue: vi.fn(() => "/tmp/schedule-manager-shutdown"),
  };
    }
  },
}));

vi.mock("@/modules/ScheduleTaskModule", () => ({
  ScheduleTaskModule: class {
    constructor() {
      return {};
    }
  },
}));

vi.mock("@/modules/ScheduleExecutionLogModule", () => ({
  ScheduleExecutionLogModule: class {
    constructor() {
      return {};
    }
  },
}));

vi.mock("@/modules/ScheduleDependencyModule", () => ({
  ScheduleDependencyModule: class {
    constructor() {
      return {};
    }
  },
}));

vi.mock("@/modules/TaskExecutorService", () => ({
  TaskExecutorService: class {
    constructor() {
      return {};
    }
  },
}));

vi.mock("@/model/SchedulerStatus.model", () => ({
  isDatabaseConnectionClosedError: (error: unknown): boolean =>
    error instanceof Error &&
    error.message === "The database connection is not open",
  SchedulerStatusModel: class {
    constructor() {
      return {
    isConnectionOpen: mockIsConnectionOpen,
    updateStatus: mockUpdateStatus,
  };
    }
  },
}));

vi.mock("cron", () => ({
  CronJob: vi.fn(),
}));

import { ScheduleManager } from "@/modules/ScheduleManager";

beforeEach(async () => {
  await ScheduleManager.destroyInstance();
  vi.clearAllMocks();
  mockIsConnectionOpen.mockReturnValue(true);
  mockUpdateStatus.mockResolvedValue(undefined);
  mockLogError.mockReset();
});

describe("ScheduleManager shutdown persistence", () => {
  it("does not persist stopped status during application shutdown so the master switch survives a restart", async () => {
    const manager = ScheduleManager.getInstance();

    await manager.handleAppShutdown();

    // App exit is not a user "stop" toggle: leaving scheduler_status
    // untouched lets initializeWithDatabaseStatus() auto-restore the
    // running master switch on the next boot.
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  it("persists stopped status once when the user explicitly stops the scheduler", async () => {
    const manager = ScheduleManager.getInstance();

    await manager.stop();

    expect(mockUpdateStatus).toHaveBeenCalledTimes(1);
  });

  it("does not write through a model whose captured connection was closed", async () => {
    mockIsConnectionOpen.mockReturnValue(false);
    const manager = ScheduleManager.getInstance();

    await manager.stop();

    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  it("treats a connection closed during the shutdown write as expected teardown", async () => {
    mockUpdateStatus.mockRejectedValue(
      new TypeError("The database connection is not open")
    );
    const manager = ScheduleManager.getInstance();

    await manager.stop();

    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("still reports unrelated scheduler status write failures", async () => {
    mockUpdateStatus.mockRejectedValue(new Error("disk is full"));
    const manager = ScheduleManager.getInstance();

    await manager.stop();

    expect(mockLogError).toHaveBeenCalledWith(
      "Failed to persist stopped status:",
      expect.objectContaining({ message: "disk is full" })
    );
  });
});
