import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createShutdownParticipants,
  reportSinkAdapter,
  type BackgroundShutdownDeps,
} from "@/main-process/lifecycle/ShutdownParticipants";
import type { ShutdownReport } from "@/main-process/lifecycle/ShutdownCoordinator";

/**
 * Shutdown-participant composition tests (design §6): each participant maps
 * to its existing owner's cleanup API, budgets are respected, and the
 * report sink ties the clean-marker decision to the report outcome
 * (AC-15). Owner modules are mocked — this tests composition, not the
 * owners' internals.
 */

const shutdownAll = vi.fn(async () => undefined);
const listSessions = vi.fn(() => ["session-1"]);
const maintenanceStop = vi.fn(() => undefined);
const toolJobShutdown = vi.fn(() => undefined);
const scheduleShutdown = vi.fn(async () => undefined);
const wsCleanup = vi.fn(() => undefined);
const watcherShutdown = vi.fn(async () => undefined);
const ypTerminateAll = vi.fn(async () => undefined);
const contactCleanup = vi.fn(async () => true);
const reconcileExtractions = vi.fn(async (_reason: string) => []);
const tokenRefreshStop = vi.fn(() => undefined);
const settingsGetter = vi.fn(async () => ({ clearCacheOnExit: false }));

vi.mock("@/service/ToolJobRegistry", () => ({
  getDefaultToolJobRegistry: () => ({ shutdown: toolJobShutdown }),
}));
vi.mock("@/service/ManagedBrowserSupervisor", () => ({
  getDefaultManagedBrowserSupervisor: () => ({
    shutdownAll,
    listSessions,
  }),
}));
vi.mock("@/service/ManagedBrowserCacheMaintenanceScheduler", () => ({
  getDefaultManagedBrowserCacheMaintenanceScheduler: () => ({
    stop: maintenanceStop,
  }),
}));
vi.mock("@/modules/ManagedBrowserSettingsModule", () => ({
  ManagedBrowserSettingsModule: class {
    getEffectiveSettings(): Promise<{ clearCacheOnExit: boolean }> {
      return settingsGetter();
    }
  },
}));
vi.mock("@/modules/ManagedBrowserCacheModule", () => ({
  getDefaultManagedBrowserCacheModule: () => ({
    queueAllForShutdown: vi.fn(async () => undefined),
  }),
}));
vi.mock("@/modules/ScheduleManager", () => ({
  ScheduleManager: {
    getInstance: () => ({ handleAppShutdown: scheduleShutdown }),
  },
}));
vi.mock("@/main-process/communication/websocket-ipc", () => ({
  cleanupWebSocketConnection: wsCleanup,
}));
vi.mock("@/service/workspaceWatch/WorkspaceWatchManagerSingleton", () => ({
  getWorkspaceWatchManager: () => ({ shutdown: watcherShutdown }),
}));
vi.mock("@/modules/YellowPagesProcessManager", () => ({
  YellowPagesProcessManager: {
    getInstance: () => ({ terminateAllProcesses: ypTerminateAll }),
  },
}));
vi.mock("@/main-process/communication/contactExtraction-ipc", () => ({
  cleanupContactExtractionWorker: contactCleanup,
  reconcileInterruptedExtractions: (reason: string) =>
    reconcileExtractions(reason),
}));
vi.mock("@/modules/tokenRefresh", () => ({
  TokenRefreshService: { stopAutoRefresh: tokenRefreshStop },
}));
const searchReconcile = vi.fn(
  async (_reason: string) => [11, 12]
);
vi.mock("@/modules/SearchModule", () => ({
  SearchModule: class {
    reconcileInterruptedTasks(reason: string): Promise<number[]> {
      return searchReconcile(reason);
    }
  },
}));

function makeDeps(
  overrides: Partial<BackgroundShutdownDeps> = {}
): BackgroundShutdownDeps {
  return {
    stopChatScheduler: vi.fn(async () => undefined),
    stopDevBrowserBridge: vi.fn(async () => undefined),
    stopDiagnosticsRetention: vi.fn(() => undefined),
    clearPendingDesktopAuth: vi.fn(() => undefined),
    stopLogCleanup: vi.fn(() => undefined),
    clearStartupMarker: vi.fn(() => undefined),
    writeShutdownReport: vi.fn(() => undefined),
    hasUserData: () => true,
    ...overrides,
  };
}

const contextOf = (remainingMs: number) => ({
  attemptId: "a1",
  deadlineMonotonicMs: 0,
  signal: new AbortController().signal,
  remainingMs: () => remainingMs,
});

describe("createShutdownParticipants — owner mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("tool-jobs seals the registry in freeze() (T06)", async () => {
    const participants = createShutdownParticipants(makeDeps());
    const toolJobs = participants.find((p) => p.id === "tool-jobs")!;
    toolJobs.freeze();
    // freeze() fires the shutdown via dynamic import — flush the microtask.
    await new Promise((r) => setImmediate(r));
    expect(toolJobShutdown).toHaveBeenCalledTimes(1);
    await toolJobs.stop(contextOf(10_000));
  });

  it("managed-browsers caps its budget at 5s and the remaining deadline", async () => {
    const participants = createShutdownParticipants(makeDeps());
    const browsers = participants.find((p) => p.id === "managed-browsers")!;
    await browsers.stop(contextOf(2_000));
    expect(shutdownAll).toHaveBeenCalledWith(2_000);
    expect(maintenanceStop).toHaveBeenCalledTimes(1);
  });

  it("managed-browsers honors clear-on-exit in finalize", async () => {
    settingsGetter.mockResolvedValueOnce({ clearCacheOnExit: true });
    const participants = createShutdownParticipants(makeDeps());
    const browsers = participants.find((p) => p.id === "managed-browsers")!;
    await browsers.finalize(contextOf(1_000));
    expect(settingsGetter).toHaveBeenCalled();
  });

  it("contact-extraction stops the worker in stop() and settles rows in finalize() (T07)", async () => {
    const participants = createShutdownParticipants(makeDeps());
    const contact = participants.find((p) => p.id === "contact-extraction")!;
    await contact.stop(contextOf(10_000));
    expect(contactCleanup).toHaveBeenCalledWith(2_000);
    // T07: reconciliation waits until the stop stage drained final results.
    expect(reconcileExtractions).not.toHaveBeenCalled();
    await contact.finalize(contextOf(10_000));
    expect(reconcileExtractions).toHaveBeenCalledTimes(1);
    // Ordering across stages: cleanup precedes reconciliation.
    expect(contactCleanup.mock.invocationCallOrder[0]).toBeLessThan(
      reconcileExtractions.mock.invocationCallOrder[0]
    );
  });

  it("schedulers stops token refresh first, then db-backed schedulers", async () => {
    const order: string[] = [];
    tokenRefreshStop.mockImplementationOnce(() => {
      order.push("token");
    });
    scheduleShutdown.mockImplementationOnce(async () => {
      order.push("schedule");
    });
    const deps = makeDeps({
      stopChatScheduler: async () => {
        order.push("chat");
      },
    });
    const participants = createShutdownParticipants(deps);
    const schedulers = participants.find((p) => p.id === "schedulers")!;
    await schedulers.stop(contextOf(10_000));
    expect(order).toEqual(["token", "schedule", "chat"]);
  });

  it("schedulers skips db-backed shutdown without user data", async () => {
    const deps = makeDeps({ hasUserData: () => false });
    const participants = createShutdownParticipants(deps);
    const schedulers = participants.find((p) => p.id === "schedulers")!;
    await schedulers.stop(contextOf(10_000));
    expect(scheduleShutdown).not.toHaveBeenCalled();
    expect(tokenRefreshStop).toHaveBeenCalled(); // timer still stops
  });

  it("websocket, workspace-watch, yellow-pages map to their owners", async () => {
    const participants = createShutdownParticipants(makeDeps());
    const ctx = contextOf(10_000);
    await participants.find((p) => p.id === "marketing-websocket")!.stop(ctx);
    await participants.find((p) => p.id === "workspace-watch")!.stop(ctx);
    await participants.find((p) => p.id === "yellow-pages")!.stop(ctx);
    expect(wsCleanup).toHaveBeenCalledTimes(1);
    expect(watcherShutdown).toHaveBeenCalledTimes(1);
    expect(ypTerminateAll).toHaveBeenCalledTimes(1);
  });

  it("app-resources finalizes housekeeping in the finalize stage only", async () => {
    const deps = makeDeps();
    const participants = createShutdownParticipants(deps);
    const appResources = participants.find((p) => p.id === "app-resources")!;
    await appResources.stop(contextOf(10_000));
    expect(deps.stopDevBrowserBridge).toHaveBeenCalledTimes(1);
    expect(deps.clearPendingDesktopAuth).not.toHaveBeenCalled();
    await appResources.finalize(contextOf(10_000));
    expect(deps.clearPendingDesktopAuth).toHaveBeenCalledTimes(1);
    expect(deps.stopDiagnosticsRetention).toHaveBeenCalledTimes(1);
    expect(deps.stopLogCleanup).toHaveBeenCalledTimes(1);
  });

  it("search-scraper settles rows in finalize(), not stop() (T07/FR-06)", async () => {
    const participants = createShutdownParticipants(makeDeps());
    const search = participants.find((p) => p.id === "search-scraper")!;
    await search.stop(contextOf(10_000));
    expect(searchReconcile).not.toHaveBeenCalled();
    await search.finalize(contextOf(10_000));
    expect(searchReconcile).toHaveBeenCalledWith(
      "Application exited while the search task was running"
    );
  });

  it("a throwing owner rejects its participant (coordinator isolates it)", async () => {
    wsCleanup.mockImplementationOnce(() => {
      throw new Error("ws boom");
    });
    const participants = createShutdownParticipants(makeDeps());
    const ws = participants.find((p) => p.id === "marketing-websocket")!;
    await expect(ws.stop(contextOf(10_000))).rejects.toThrow("ws boom");
  });
});

describe("reportSinkAdapter — clean-marker decision (AC-15)", () => {
  it("clears the marker only when the DURABLE write succeeded (T14)", () => {
    const deps = makeDeps();
    const sink = reportSinkAdapter(deps);
    // No durable writer wired -> legacy path: clear only on clean reports.
    const cleanReport = { clean: true } as ShutdownReport;
    const forcedReport = { clean: false } as ShutdownReport;
    sink(cleanReport);
    expect(deps.clearStartupMarker).toHaveBeenCalledTimes(1);
    sink(forcedReport);
    expect(deps.clearStartupMarker).toHaveBeenCalledTimes(1); // not clean
  });

  it("a failed durable report write KEEPS the marker (T14)", () => {
    const deps = makeDeps({
      appendShutdownReportDurable: () => false, // write failed
    });
    const sink = reportSinkAdapter(deps);
    sink({ clean: true } as ShutdownReport);
    expect(deps.clearStartupMarker).not.toHaveBeenCalled();
  });

  it("a successful durable write clears the marker even when forced (T14)", () => {
    const deps = makeDeps({
      appendShutdownReportDurable: () => true,
    });
    const sink = reportSinkAdapter(deps);
    sink({ clean: false } as ShutdownReport);
    // Durable + coordinated (not a crash): marker off; report distinguishes.
    expect(deps.clearStartupMarker).toHaveBeenCalledTimes(1);
  });

  it("a throwing writer never breaks the sink", () => {
    const deps = makeDeps({
      writeShutdownReport: () => {
        throw new Error("disk full");
      },
    });
    const sink = reportSinkAdapter(deps);
    expect(() => sink({ clean: true } as ShutdownReport)).not.toThrow();
  });
});
