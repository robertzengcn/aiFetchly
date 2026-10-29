import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * B12: the process-wide retention hook installs ONE guarded periodic sweep
 * (idempotent across callers, unref'd, resettable for tests).
 */

const sweepSpy = vi.fn(() => 2);

vi.mock("@/service/PluginFileArtifactService", () => ({
  PluginFileArtifactService: class {
    sweepExpired(): number {
      return sweepSpy();
    }
  },
  getPluginFileArtifactService: () => ({
    sweepExpired: sweepSpy,
  }),
}));

import {
  initializePluginArtifactStore,
  resetPluginArtifactSweepForTest,
  PLUGIN_ARTIFACT_SWEEP_INTERVAL_MS,
} from "@/modules/PluginFileArtifactModule";

describe("initializePluginArtifactStore (B12 retention wiring)", () => {
  beforeEach(() => {
    sweepSpy.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetPluginArtifactSweepForTest();
    vi.useRealTimers();
  });

  it("sweeps once at init and repeatedly on the periodic interval", async () => {
    await initializePluginArtifactStore();
    expect(sweepSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(PLUGIN_ARTIFACT_SWEEP_INTERVAL_MS);
    expect(sweepSpy).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(PLUGIN_ARTIFACT_SWEEP_INTERVAL_MS);
    expect(sweepSpy).toHaveBeenCalledTimes(3);
  });

  it("never stacks a second interval across repeated init calls", async () => {
    await initializePluginArtifactStore();
    await initializePluginArtifactStore();
    await initializePluginArtifactStore();
    expect(sweepSpy).toHaveBeenCalledTimes(3);

    // Exactly ONE interval registered: one extra sweep per interval, not
    // three.
    await vi.advanceTimersByTimeAsync(PLUGIN_ARTIFACT_SWEEP_INTERVAL_MS);
    expect(sweepSpy).toHaveBeenCalledTimes(4);
  });
});
