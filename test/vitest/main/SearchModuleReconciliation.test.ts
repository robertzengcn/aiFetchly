import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * FR-06/AC-09 (TODO task 5): SearchModule.reconcileInterruptedTasks maps every
 * RUNNING search task to the existing Error state with an interruption
 * runtime-log line and clears its stored PID — BEFORE the force kill races app
 * termination. Completed rows untouched; retry stays user-initiated.
 */

const activeTaskIds = vi.fn(() => [31, 32]);
const updateStatus = vi.fn(async () => undefined);
const updatePid = vi.fn(async () => undefined);
const updateRuntimeLog = vi.fn(
  async (_taskId: number, _log: string) => undefined
);

vi.mock("@/controller/SearchController", () => ({
  SearchController: {
    getInstance: () => ({
      getActiveTaskIds: () => activeTaskIds(),
      unregisterProcess: vi.fn(),
    }),
  },
}));

vi.mock("@/modules/baseModule", () => ({
  BaseModule: class {},
}));

import { SearchModule } from "@/modules/SearchModule";
import { SearchTaskStatus } from "@/model/SearchTask.model";

describe("SearchModule.reconcileInterruptedTasks (FR-06 at-exit mapping)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Seed the module's taskdbModel with the mocks (constructor-built in the
    // real module; patch via the instance the tests drive).
  });

  it("maps every running task to Error, clears PID, logs the interruption", async () => {
    const module = new SearchModule();
    // Replace the model layer the method delegates to.
    (
      module as unknown as { taskdbModel: unknown }
    ).taskdbModel = {
      updateTaskStatus: updateStatus,
      updateTaskPID: updatePid,
      updateRuntimeLog,
    };

    const ids = await module.reconcileInterruptedTasks("app exit");

    expect(ids).toEqual([31, 32]);
    expect(updateStatus).toHaveBeenCalledWith(31, SearchTaskStatus.Error);
    expect(updateStatus).toHaveBeenCalledWith(32, SearchTaskStatus.Error);
    expect(updatePid).toHaveBeenCalledWith(31, null);
    expect(updatePid).toHaveBeenCalledWith(32, null);
    for (const call of updateRuntimeLog.mock.calls) {
      expect(call[1]).toContain("app exit");
    }
  });

  it("a failing task row never blocks its siblings (settled per-task loop)", async () => {
    updateStatus.mockImplementationOnce(async () => {
      throw new Error("db write failed for task 31");
    });
    const module = new SearchModule();
    (
      module as unknown as { taskdbModel: unknown }
    ).taskdbModel = {
      updateTaskStatus: updateStatus,
      updateTaskPID: updatePid,
      updateRuntimeLog,
    };

    const ids = await module.reconcileInterruptedTasks("app exit");
    // Both attempted; the failing one did not abort the loop.
    expect(ids).toEqual([31, 32]);
    expect(updateStatus).toHaveBeenCalledTimes(2);
  });

  it("with no active tasks it is a no-op", async () => {
    activeTaskIds.mockReturnValueOnce([]);
    const module = new SearchModule();
    (
      module as unknown as { taskdbModel: unknown }
    ).taskdbModel = {
      updateTaskStatus: updateStatus,
      updateTaskPID: updatePid,
      updateRuntimeLog,
    };
    const ids = await module.reconcileInterruptedTasks("app exit");
    expect(ids).toEqual([]);
    expect(updateStatus).not.toHaveBeenCalled();
  });
});
