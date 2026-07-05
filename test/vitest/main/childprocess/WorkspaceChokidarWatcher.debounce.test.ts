/**
 * WorkspaceChokidarWatcher — WAT-05 debounce + scan-generation tests.
 *
 * The chokidar wrapper coalesces event bursts (add/change/unlink/addDir/
 * unlinkDir) through a per-workspace 500ms debounce timer and bumps a
 * monotonic generation counter on each debounce-fire. The worker uses the
 * generation to discard stale out-of-order scans (design §9.6).
 *
 * These tests use vitest fake timers + a real tmpdir + real chokidar so we
 * verify both the timer behavior AND the chokidar event wiring. Cross-
 * platform FS event timing is NOT asserted here (that is the manual QA
 * checklist per VALIDATION.md) — the assertions are on the debounce
 * coalescing + generation bookkeeping, not on chokidar's OS event latency.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { createWorkspaceWatcher } from "@/childprocess/aifetchly-config/WorkspaceChokidarWatcher";
import { tmpdirSync, writeFiles } from "./_fixtures/workspaceTmpdir";

describe("WorkspaceChokidarWatcher — WAT-05 debounce + generations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces a burst of 5 add events within 100ms into ONE onDebouncedChange call after 500ms", async () => {
    const root = tmpdirSync();
    writeFiles(root, [
      { path: ".aifetchly", content: undefined } as unknown as { path: string },
    ]);
    fs.mkdirSync(path.join(root, ".aifetchly"), { recursive: true });

    const calls: number[] = [];
    const watcher = createWorkspaceWatcher(root, false, () => {
      calls.push(Date.now());
    });

    try {
      // Fire 5 rapid add events by writing 5 files within ~0ms of each other.
      // chokidar's awaitWriteFinish (stabilityThreshold:500, pollInterval:100)
      // would normally delay emission, but since we control the fake timers
      // AND chokidar reads from real FS, we advance time enough to let the
      // debounce window elapse.
      for (let i = 0; i < 5; i++) {
        fs.writeFileSync(
          path.join(root, ".aifetchly", `f${i}.md`),
          `content ${i}`,
          "utf8"
        );
      }

      // Advance fake timers past the debounce + awaitWriteFinish windows.
      // The 500ms debounce is the dominant timer; allow some slack for the
      // chokidar internals to settle.
      await vi.advanceTimersByTimeAsync(1500);
      await Promise.resolve(); // flush microtasks

      // The debounce contract: exactly ONE onDebouncedChange after the 500ms
      // window elapses, regardless of how many events fired in the burst.
      expect(
        calls.length,
        "5-event burst should produce exactly 1 callback"
      ).toBe(1);
    } finally {
      await watcher.close();
    }
  });

  it("exposes getLastGeneration() that increments exactly once per debounce-fire", async () => {
    const root = tmpdirSync();
    fs.mkdirSync(path.join(root, ".aifetchly"), { recursive: true });

    const watcher = createWorkspaceWatcher(root, false, () => undefined);
    try {
      const before = watcher.getLastGeneration();
      expect(before).toBeGreaterThanOrEqual(0);

      // Burst write.
      for (let i = 0; i < 3; i++) {
        fs.writeFileSync(
          path.join(root, ".aifetchly", `gen-${i}.md`),
          `gen ${i}`,
          "utf8"
        );
      }
      await vi.advanceTimersByTimeAsync(1500);
      await Promise.resolve();

      const after = watcher.getLastGeneration();
      expect(
        after,
        "generation increments at least once on burst"
      ).toBeGreaterThan(before);
      // The increment should be EXACTLY one for a single burst (no double-fire).
      expect(after - before).toBe(1);
    } finally {
      await watcher.close();
    }
  });

  it("stops emitting onDebouncedChange callbacks after close()", async () => {
    const root = tmpdirSync();
    fs.mkdirSync(path.join(root, ".aifetchly"), { recursive: true });

    const calls: number[] = [];
    const watcher = createWorkspaceWatcher(root, false, () => {
      calls.push(Date.now());
    });

    // Close BEFORE any writes happen.
    await watcher.close();

    // Now write + advance time; no callbacks should fire.
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(
        path.join(root, ".aifetchly", `closed-${i}.md`),
        `closed ${i}`,
        "utf8"
      );
    }
    await vi.advanceTimersByTimeAsync(1500);
    await Promise.resolve();

    expect(calls.length, "no callbacks after close()").toBe(0);
  });
});
