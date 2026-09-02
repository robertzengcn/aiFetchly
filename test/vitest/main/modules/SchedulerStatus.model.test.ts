import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRepository = vi.hoisted(() => ({
  findOne: vi.fn(),
  save: vi.fn(),
  update: vi.fn(),
}));

const mockConnection = vi.hoisted(() => ({
  getRepository: vi.fn(() => mockRepository),
  isInitialized: true,
}));

const mockEnsureInitialized = vi.hoisted(() => vi.fn());

vi.mock("@/config/SqliteDb", () => ({
  SqliteDb: {
    ensureInitialized: mockEnsureInitialized,
    getInstance: vi.fn(() => ({ connection: mockConnection })),
  },
}));

import { SchedulerStatusModel } from "@/model/SchedulerStatus.model";

beforeEach(() => {
  vi.clearAllMocks();
  mockConnection.isInitialized = true;
  mockEnsureInitialized.mockResolvedValue(undefined);
  mockRepository.findOne.mockResolvedValue(null);
  mockRepository.save.mockResolvedValue(undefined);
  mockRepository.update.mockResolvedValue(undefined);
});

describe("SchedulerStatusModel.updateStatus", () => {
  it("does not log a database-close race as an application error", async () => {
    mockRepository.save.mockRejectedValue(
      new TypeError("The database connection is not open")
    );
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const model = new SchedulerStatusModel("/tmp/scheduler-status-test");

    await expect(
      model.updateStatus({ is_running: false })
    ).rejects.toThrow("The database connection is not open");
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("continues to log unrelated database write failures", async () => {
    mockRepository.save.mockRejectedValue(new Error("disk is full"));
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const model = new SchedulerStatusModel("/tmp/scheduler-status-test");

    await expect(
      model.updateStatus({ is_running: false })
    ).rejects.toThrow("disk is full");
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to update scheduler status:",
      expect.objectContaining({ message: "disk is full" })
    );

    errorSpy.mockRestore();
  });
});
