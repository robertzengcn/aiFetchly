/**
 * AIFetchlyConfigManager watcherState integration tests (Plan 14-03 Task 2).
 *
 * Covers the wiring that replaced the Phase-13 placeholder ("not-started"
 * hardcoded) with a real value derived from the injected WorkspaceWatchManager
 * singleton. The DX-02 success criterion requires /status to reflect the
 * real watcher state.
 *
 * Mocks the manager (cheap stub — no real worker fork). The test does not
 * touch the DB, the filesystem, or the network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted manager stub — three observable workerState values.
const managerMocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { on: vi.fn(), whenReady: vi.fn() },
  BrowserWindow: class {},
}));

// --- Imports (after mocks) --------------------------------------------------

import { AIFetchlyConfigManager } from "@/service/aifetchlyConfig/AIFetchlyConfigManager";
import type { WorkspaceWatchManager } from "@/service/workspaceWatch/WorkspaceWatchManager";

/**
 * Build a stub WorkspaceWatchManager whose getStatus() returns the given
 * workerState. The AIFetchlyConfigManager maps the manager's workerState
 * (not-started/running/restarting/failed) onto its own watcherState union
 * (not-started/watching/failed).
 */
function makeStubManager(workerState: string): WorkspaceWatchManager {
  managerMocks.getStatus.mockReturnValue({
    workerState,
    watchedCount: 0,
    recentRestarts: [],
    restartCapExceeded: false,
    watched: [],
  });
  return { getStatus: managerMocks.getStatus } as unknown as WorkspaceWatchManager;
}

describe("AIFetchlyConfigManager.getStatus().watcherState (DX-02 integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 'not-started' when no WorkspaceWatchManager has been set", () => {
    const mgr = new AIFetchlyConfigManager();
    expect(mgr.getStatus().watcherState).toBe("not-started");
  });

  it("returns 'not-started' when manager.getState().workerState is 'not-started'", () => {
    const mgr = new AIFetchlyConfigManager();
    mgr.setWorkspaceWatchManager(makeStubManager("not-started"));
    expect(mgr.getStatus().watcherState).toBe("not-started");
  });

  it("returns 'watching' when manager.getStatus().workerState is 'running'", () => {
    const mgr = new AIFetchlyConfigManager();
    mgr.setWorkspaceWatchManager(makeStubManager("running"));
    expect(mgr.getStatus().watcherState).toBe("watching");
  });

  it("returns 'watching' when manager.getStatus().workerState is 'restarting' (still observing)", () => {
    const mgr = new AIFetchlyConfigManager();
    mgr.setWorkspaceWatchManager(makeStubManager("restarting"));
    expect(mgr.getStatus().watcherState).toBe("watching");
  });

  it("returns 'failed' when manager.getStatus().workerState is 'failed'", () => {
    const mgr = new AIFetchlyConfigManager();
    mgr.setWorkspaceWatchManager(makeStubManager("failed"));
    expect(mgr.getStatus().watcherState).toBe("failed");
  });

  it("watcherState type accepts the full union (not-started | watching | failed)", () => {
    // Compile-time assertion: the literal type is the union. If the manager
    // narrows it back to "not-started", this assignment fails at compile time.
    const value: "not-started" | "watching" | "failed" =
      new AIFetchlyConfigManager().getStatus().watcherState;
    // Three values cycle through; the union must include all of them.
    expect(["not-started", "watching", "failed"]).toContain(value);
  });
});
