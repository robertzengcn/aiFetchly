import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUpdateStatus = vi.hoisted(() => vi.fn(async () => undefined));
const mockIsConnectionOpen = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn(() => "/tmp/schedule-manager-shutdown"),
  })),
}));

vi.mock("@/modules/ScheduleTaskModule", () => ({
  ScheduleTaskModule: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("@/modules/ScheduleExecutionLogModule", () => ({
  ScheduleExecutionLogModule: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("@/modules/ScheduleDependencyModule", () => ({
  ScheduleDependencyModule: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("@/modules/TaskExecutorService", () => ({
  TaskExecutorService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("@/model/SchedulerStatus.model", () => ({
  isDatabaseConnectionClosedError: (error: unknown): boolean =>
    error instanceof Error &&
    error.message === "The database connection is not open",
  SchedulerStatusModel: vi.fn().mockImplementation(() => ({
    isConnectionOpen: mockIsConnectionOpen,
    updateStatus: mockUpdateStatus,
  })),
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
});

describe("ScheduleManager shutdown persistence", () => {
  it("persists stopped status once during application shutdown", async () => {
    const manager = ScheduleManager.getInstance();

    await manager.handleAppShutdown();

    expect(mockUpdateStatus).toHaveBeenCalledTimes(1);
  });

  it("does not write through a model whose captured connection was closed", async () => {
    mockIsConnectionOpen.mockReturnValue(false);
    const manager = ScheduleManager.getInstance();

    await manager.handleAppShutdown();

    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  it("treats a connection closed during the shutdown write as expected teardown", async () => {
    mockUpdateStatus.mockRejectedValue(
      new TypeError("The database connection is not open")
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const manager = ScheduleManager.getInstance();

    await manager.handleAppShutdown();

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("still reports unrelated scheduler status write failures", async () => {
    mockUpdateStatus.mockRejectedValue(new Error("disk is full"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const manager = ScheduleManager.getInstance();

    await manager.handleAppShutdown();

    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to persist stopped status:",
      expect.objectContaining({ message: "disk is full" })
    );
    errorSpy.mockRestore();
  });
});
