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
}));
vi.mock("@/modules/tokenRefresh", () => ({
  TokenRefreshService: { stopAutoRefresh: tokenRefreshStop },
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

  it("tool-jobs calls the registry shutdown", async () => {
    const participants = createShutdownParticipants(makeDeps());
    const toolJobs = participants.find((p) => p.id === "tool-jobs")!;
    await toolJobs.stop(contextOf(10_000));
    expect(toolJobShutdown).toHaveBeenCalledTimes(1);
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

  it("contact-extraction waits for observed exit with a bounded budget", async () => {
    const participants = createShutdownParticipants(makeDeps());
    const contact = participants.find((p) => p.id === "contact-extraction")!;
    await contact.stop(contextOf(10_000));
    expect(contactCleanup).toHaveBeenCalledWith(2_000);
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
  it("clears the startup marker only for a clean report", () => {
    const deps = makeDeps();
    const sink = reportSinkAdapter(deps);
    const cleanReport = { clean: true } as ShutdownReport;
    const forcedReport = { clean: false } as ShutdownReport;
    sink(cleanReport);
    expect(deps.clearStartupMarker).toHaveBeenCalledTimes(1);
    expect(deps.writeShutdownReport).toHaveBeenCalledWith(cleanReport);
    sink(forcedReport);
    expect(deps.clearStartupMarker).toHaveBeenCalledTimes(2);
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
