import { describe, expect, it, vi } from "vitest";
import {
  reconcileBulkEmailAtExit,
  reconcileSocialAtExit,
  type BulkEmailReconcileModel,
  type SocialReconcileModel,
} from "@/main-process/communication/durableTaskReconciliation";
import { TaskStatus } from "@/entityTypes/commonType";

/**
 * FR-06/AC-09 (TODO task 4) at-exit mapping tests for the remaining durable
 * families: bulk-email Processing rows -> existing Error + [interrupted]
 * note; social live runs -> interruption marker. Completed rows untouched;
 * nothing auto-retried; a failing row never blocks siblings.
 */

describe("reconcileBulkEmailAtExit (T08 semantics)", () => {
  function makeModel(ids: number[]): {
    model: import("@/main-process/communication/durableTaskReconciliation").BulkEmailReconcileModel;
    statuses: Array<[number, TaskStatus]>;
    storedPaths: Array<[number, string]>;
    writtenNotes: Array<[number, string]>;
  } {
    const statuses: Array<[number, TaskStatus]> = [];
    const storedPaths: Array<[number, string]> = [];
    const writtenNotes: Array<[number, string]> = [];
    let live = [...ids];
    return {
      statuses,
      storedPaths,
      writtenNotes,
      model: {
        listTaskIdsByStatus: async (status) => {
          expect(status).toBe(TaskStatus.Processing);
          return [...live];
        },
        updateTaskStatus: async (id, status) => {
          statuses.push([id, status]);
          if (status === TaskStatus.Error) {
            live = live.filter((x) => x !== id);
          }
        },
        updateTaskErrorFile: async (id, errorLogPath) => {
          storedPaths.push([id, errorLogPath]);
        },
        getTaskErrorFilePath: async () => undefined,
      },
    };
  }

  const writer = async (taskId: number, note: string): Promise<string> => {
    return `/tmp/logs/task-${taskId}-interrupted.error.log:${note}`;
  };

  it("stores the LOG PATH (never message text) and flips to Error", async () => {
    const h = makeModel([7, 8]);
    const ids = await reconcileBulkEmailAtExit(h.model, "app exit", writer);
    expect(ids).toEqual([7, 8]);
    expect(h.statuses).toEqual([
      [7, TaskStatus.Error],
      [8, TaskStatus.Error],
    ]);
    for (const [id, p] of h.storedPaths) {
      expect(p).toContain(`/tmp/logs/task-${id}-interrupted.error.log`);
      expect(p).not.toContain("app exit]"); // path only — the note is in the file
    }
  });

  it("a row that leaves Processing before the write is untouched", async () => {
    const h = makeModel([7]);
    // Simulate concurrent completion: second listing no longer contains 7.
    const original = h.model.listTaskIdsByStatus;
    let calls = 0;
    h.model.listTaskIdsByStatus = async (status) => {
      calls += 1;
      if (calls > 1) return [];
      return original(status);
    };
    const ids = await reconcileBulkEmailAtExit(h.model, "r", writer);
    expect(ids).toEqual([]);
    expect(h.statuses).toEqual([]);
  });

  it("only successfully-written rows are returned (truthful reconcile)", async () => {
    const h = makeModel([1, 2]);
    h.model.updateTaskStatus = async (id) => {
      if (id === 1) throw new Error("db gone");
    };
    const ids = await reconcileBulkEmailAtExit(h.model, "r", writer);
    expect(ids).toEqual([2]);
  });

  it("a list failure degrades to no-op", async () => {
    const model = {
      listTaskIdsByStatus: async (): Promise<number[]> => {
        throw new Error("no table");
      },
      updateTaskStatus: async (): Promise<void> => undefined,
      updateTaskErrorFile: async (): Promise<void> => undefined,
      getTaskErrorFilePath: async (): Promise<string | undefined> => undefined,
    } as unknown as Parameters<typeof reconcileBulkEmailAtExit>[0];
    await expect(reconcileBulkEmailAtExit(model, "r", writer)).resolves.toEqual(
      []
    );
  });
});

describe("reconcileSocialAtExit", () => {
  it("marks each active run interrupted and clears the registry", async () => {
    const marked: Array<[number, string]> = [];
    const model: SocialReconcileModel = {
      listActiveRunIds: async () => [51, 52],
      markRunInterrupted: async (id, reason) => {
        marked.push([id, reason]);
      },
    };
    const ids = await reconcileSocialAtExit(model, "app exit");
    expect(ids).toEqual([51, 52]);
    expect(marked).toEqual([
      [51, "app exit"],
      [52, "app exit"],
    ]);
  });

  it("a failing run never blocks siblings; no active runs is a no-op", async () => {
    const marked: number[] = [];
    const model: SocialReconcileModel = {
      listActiveRunIds: async () => [1, 2],
      markRunInterrupted: async (id) => {
        if (id === 1) throw new Error("log write failed");
        marked.push(id);
      },
    };
    const ids = await reconcileSocialAtExit(model, "r");
    expect(ids).toEqual([1, 2]);
    expect(marked).toEqual([2]);

    const empty: SocialReconcileModel = {
      listActiveRunIds: async () => [],
      markRunInterrupted: async () => undefined,
    };
    await expect(reconcileSocialAtExit(empty, "r")).resolves.toEqual([]);
  });
});

describe("durable-tasks participant wiring", () => {
  it("stop() calls both reconcilers through their owning modules", async () => {
    vi.resetModules();
    const bulk = vi.fn(async (_reason: string) => [9]);
    const social = vi.fn(async (_reason: string) => [4]);
    vi.doMock("@/modules/buckEmailTaskModule", () => ({
      BuckEmailTaskModule: class {
        reconcileInterruptedTasks(reason: string): Promise<number[]> {
          return bulk(reason);
        }
      },
    }));
    vi.doMock("@/modules/socialtask", () => ({
      reconcileInterruptedSocialRuns: (reason: string) => social(reason),
    }));
    const { createShutdownParticipants } = await import(
      "@/main-process/lifecycle/ShutdownParticipants"
    );
    const deps = {
      stopChatScheduler: async () => undefined,
      stopDevBrowserBridge: async () => undefined,
      stopDiagnosticsRetention: () => undefined,
      clearPendingDesktopAuth: () => undefined,
      stopLogCleanup: () => undefined,
      clearStartupMarker: () => undefined,
      writeShutdownReport: () => undefined,
      hasUserData: () => true,
    };
    const participant = createShutdownParticipants(deps).find(
      (p) => p.id === "durable-tasks"
    );
    expect(participant).toBeDefined();
    // T07: reconciliation runs in finalize(), after the stop stage drained.
    await participant!.stop({
      attemptId: "a",
      deadlineMonotonicMs: 0,
      signal: new AbortController().signal,
      remainingMs: () => 10_000,
    });
    expect(bulk).not.toHaveBeenCalled();
    expect(social).not.toHaveBeenCalled();
    await participant!.finalize({
      attemptId: "a",
      deadlineMonotonicMs: 0,
      signal: new AbortController().signal,
      remainingMs: () => 10_000,
    });
    expect(bulk).toHaveBeenCalledWith(
      "Application exited while the email batch was running"
    );
    expect(social).toHaveBeenCalledWith(
      "Application exited while the social task run was in progress"
    );
    vi.resetModules();
    vi.doUnmock("@/modules/buckEmailTaskModule");
    vi.doUnmock("@/modules/socialtask");
  });
});
