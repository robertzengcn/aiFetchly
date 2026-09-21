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

describe("reconcileBulkEmailAtExit", () => {
  function makeModel(ids: number[]): {
    model: BulkEmailReconcileModel;
    statuses: Array<[number, TaskStatus]>;
    logs: Array<[number, string]>;
  } {
    const statuses: Array<[number, TaskStatus]> = [];
    const logs: Array<[number, string]> = [];
    return {
      statuses,
      logs,
      model: {
        listTaskIdsByStatus: async (status) => {
          expect(status).toBe(TaskStatus.Processing);
          return ids;
        },
        updateTaskStatus: async (id, status) => {
          statuses.push([id, status]);
        },
        updateTaskErrorFile: async (id, message) => {
          logs.push([id, message]);
        },
      },
    };
  }

  it("maps Processing rows to the existing Error state with an [interrupted] note", async () => {
    const h = makeModel([7, 8]);
    const ids = await reconcileBulkEmailAtExit(h.model, "app exit");
    expect(ids).toEqual([7, 8]);
    expect(h.statuses).toEqual([
      [7, TaskStatus.Error],
      [8, TaskStatus.Error],
    ]);
    for (const [, message] of h.logs) {
      expect(message).toBe("[interrupted] app exit");
    }
  });

  it("never touches completed rows (only Processing is queried)", async () => {
    const queried: TaskStatus[] = [];
    const model: BulkEmailReconcileModel = {
      listTaskIdsByStatus: async (status) => {
        queried.push(status);
        return [];
      },
      updateTaskStatus: async () => undefined,
      updateTaskErrorFile: async () => undefined,
    };
    const ids = await reconcileBulkEmailAtExit(model, "app exit");
    expect(ids).toEqual([]);
    expect(queried).toEqual([TaskStatus.Processing]);
  });

  it("a failing row never blocks its siblings; a list failure returns []", async () => {
    const statuses: Array<[number, TaskStatus]> = [];
    const model: BulkEmailReconcileModel = {
      listTaskIdsByStatus: async () => [1, 2],
      updateTaskStatus: async (id) => {
        if (id === 1) throw new Error("db gone");
        statuses.push([id, TaskStatus.Error]);
      },
      updateTaskErrorFile: async () => undefined,
    };
    const ids = await reconcileBulkEmailAtExit(model, "app exit");
    expect(ids).toEqual([1, 2]);
    expect(statuses).toEqual([[2, TaskStatus.Error]]);

    const broken: BulkEmailReconcileModel = {
      listTaskIdsByStatus: async () => {
        throw new Error("no table");
      },
      updateTaskStatus: async () => undefined,
      updateTaskErrorFile: async () => undefined,
    };
    await expect(reconcileBulkEmailAtExit(broken, "r")).resolves.toEqual([]);
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
    await participant!.stop({
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
