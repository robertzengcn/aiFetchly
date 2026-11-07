import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BUGFIX 2026-11-02 — the schedule page's "Run now" button awaited the ENTIRE
 * AI run before returning (ScheduleManager.executeSchedule runs the full
 * ScheduledAiMessageRunner synchronously when no options are passed). The
 * detach mechanism exists for exactly this caller — the doc contract on
 * executeSchedule ("Manual Run Now passes detach so the caller returns after
 * the run is accepted") and the AI-tool path (runScheduleNowForAi) both use
 * it — but the controller never passed the option.
 */

const executeScheduleMock = vi.hoisted(() => vi.fn());

vi.mock("@/modules/ScheduleManager", () => ({
  ScheduleManager: {
    getInstance: () => ({
      executeSchedule: executeScheduleMock,
      validateCronExpression: vi.fn(() => true),
      addSchedule: vi.fn(),
    }),
  },
}));

vi.mock("@/modules/ScheduleTaskModule", () => ({
  ScheduleTaskModule: class {
    createSchedule = vi.fn();
    updateSchedule = vi.fn();
    listSchedules = vi.fn(async () => ({ records: [] }));
  },
}));

vi.mock("@/modules/ScheduleExecutionLogModule", () => ({
  ScheduleExecutionLogModule: class {
    listExecutions = vi.fn(async () => []);
  },
}));

vi.mock("@/modules/ScheduleDependencyModule", () => ({
  ScheduleDependencyModule: class {
    getDependenciesByParent = vi.fn(async () => []);
    validateDependencies = vi.fn(async () => ({ valid: true }));
  },
}));

vi.mock("@/modules/TaskExecutorService", () => ({
  TaskExecutorService: class {
    executeScheduledTask = vi.fn();
  },
}));

import { ScheduleController } from "@/controller/ScheduleController";

describe("ScheduleController.runScheduleNow detach (bugfix 2026-11-02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeScheduleMock.mockResolvedValue(undefined);
  });

  it("hands the schedule to the background via detach so the click returns immediately", async () => {
    const controller = new ScheduleController();
    await controller.runScheduleNow(4);
    expect(executeScheduleMock).toHaveBeenCalledWith(4, { detach: true });
  });
});
