import { describe, expect, it, beforeEach, vi } from "vitest";

// Regression (AC-002): the shared coordinator's renderer summary must reach the
// window even when the coordinator was constructed before
// initWorkspaceWatchManager (the manager's portableMemorySnapshotCallback
// lazily fetches the shared coordinator). A stale/null sink at construction
// time must NOT silently drop summaries.

const sentChannels: { channel: string; payload: unknown }[] = [];

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: class {},
}));

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return process.env.AIFETCHLY_TEST_DBPATH;
    }
  },
}));

import {
  getSharedPortableMemorySyncCoordinator,
  resetPortableSummarySinkForTests,
  attachPortableMemorySummarySink,
} from "@/service/workspaceWatch/WorkspaceWatchManagerSingleton";

beforeEach(() => {
  sentChannels.length = 0;
  resetPortableSummarySinkForTests();
});

describe("portable memory summary forwarding (AC-002)", () => {
  it("forwards summaries after the sink is attached (late wiring)", async () => {
    // Coordinator constructed FIRST (no sink yet).
    const coordinator = getSharedPortableMemorySyncCoordinator();

    // Sink attached AFTER, simulating initWorkspaceWatchManager(win).
    attachPortableMemorySummarySink((summary) => {
      sentChannels.push({
        channel: "ai:portable-workspace-memory:changed",
        payload: summary,
      });
    });

    // Drive an artificial summary through the coordinator's emitter.
    await coordinator.emitSummaryForTest({
      scopeId: "wscope-legacy-aaaa",
      complete: true,
      imported: 1,
      unchanged: 0,
      rejected: 0,
      conflicted: 0,
      pendingReview: 0,
      deleted: 0,
      diagnostics: [],
    });

    expect(sentChannels).toHaveLength(1);
    expect(sentChannels[0]?.channel).toBe(
      "ai:portable-workspace-memory:changed"
    );
    expect(sentChannels[0]?.payload).toMatchObject({
      scopeId: "wscope-legacy-aaaa",
      imported: 1,
    });
  });

  it("does not throw and drops silently before a sink is attached", async () => {
    const coordinator = getSharedPortableMemorySyncCoordinator();
    await expect(
      coordinator.emitSummaryForTest({
        scopeId: "wscope-legacy-bbbb",
        complete: true,
        imported: 0,
        unchanged: 1,
        rejected: 0,
        conflicted: 0,
        pendingReview: 0,
        deleted: 0,
        diagnostics: [],
      })
    ).resolves.toBeUndefined();
    expect(sentChannels).toHaveLength(0);
  });
});
