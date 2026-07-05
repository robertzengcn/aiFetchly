/**
 * WorkspaceChokidarWatcher — WAT-05 debounce + scan-generation tests.
 *
 * The chokidar wrapper coalesces event bursts (add/change/unlink/addDir/
 * unlinkDir) through a per-workspace 500ms debounce timer and bumps a
 * monotonic generation counter on each debounce-fire. The worker uses the
 * generation to discard stale out-of-order scans (design §9.6).
 *
 * Test approach: the underlying OS-event→chokidar-event integration is
 * verified by the manual QA checklist per VALIDATION.md. These unit tests
 * emit events directly on the chokidar EventEmitter (FSWatcher extends
 * EventEmitter) and assert the debounce + generation contract using fake
 * timers. This is the deterministic core of WAT-05.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceWatcher } from "@/childprocess/aifetchly-config/WorkspaceChokidarWatcher";
import { tmpdirSync } from "./_fixtures/workspaceTmpdir";

describe("WorkspaceChokidarWatcher — WAT-05 debounce + generations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces a burst of 5 add events within 100ms into ONE onDebouncedChange call after 500ms", async () => {
    const root = tmpdirSync();
    const calls: number[] = [];
    const handle = createWorkspaceWatcher(root, false, () => {
      calls.push(Date.now());
    });

    try {
      // Emit 5 rapid add events via the chokidar EventEmitter interface.
      // The handler subscribes to 'add' and coalesces through the debounce.
      for (let i = 0; i < 5; i++) {
        handle.watcher.emit("add", `${root}/.aifetchly/f${i}.md`);
      }

      // Before the debounce window elapses: zero callbacks.
      expect(calls.length).toBe(0);
      vi.advanceTimersByTime(499);
      expect(calls.length, "no callback before 500ms window elapses").toBe(0);

      // At exactly 500ms: exactly ONE callback.
      vi.advanceTimersByTime(1);
      expect(calls.length, "5-event burst should produce exactly 1 callback").toBe(1);
    } finally {
      await handle.close();
    }
  });

  it("coalesces mixed add/change/unlink/addDir/unlinkDir events into one callback", async () => {
    const root = tmpdirSync();
    const calls: number[] = [];
    const handle = createWorkspaceWatcher(root, false, () => {
      calls.push(Date.now());
    });

    try {
      handle.watcher.emit("add", `${root}/.aifetchly/a.md`);
      handle.watcher.emit("change", `${root}/.aifetchly/a.md`);
      handle.watcher.emit("unlink", `${root}/.aifetchly/b.md`);
      handle.watcher.emit("addDir", `${root}/.aifetchly/sub`);
      handle.watcher.emit("unlinkDir", `${root}/.aifetchly/old`);

      vi.advanceTimersByTime(500);
      expect(calls.length, "5 mixed events should produce exactly 1 callback").toBe(1);
    } finally {
      await handle.close();
    }
  });

  it("exposes getLastGeneration() that increments exactly once per debounce-fire", async () => {
    const root = tmpdirSync();
    const handle = createWorkspaceWatcher(root, false, () => undefined);

    try {
      const before = handle.getLastGeneration();
      expect(before).toBeGreaterThanOrEqual(0);

      // Burst of 3 events.
      for (let i = 0; i < 3; i++) {
        handle.watcher.emit("add", `${root}/.aifetchly/g-${i}.md`);
      }
      vi.advanceTimersByTime(500);

      const after = handle.getLastGeneration();
      expect(after, "generation increments at least once on burst").toBeGreaterThan(before);
      // The increment should be EXACTLY one for a single burst (no double-fire).
      expect(after - before).toBe(1);
    } finally {
      await handle.close();
    }
  });

  it("does NOT increment the generation before the debounce window completes", async () => {
    const root = tmpdirSync();
    const handle = createWorkspaceWatcher(root, false, () => undefined);

    try {
      const before = handle.getLastGeneration();
      handle.watcher.emit("add", `${root}/.aifetchly/x.md`);
      vi.advanceTimersByTime(499);
      expect(handle.getLastGeneration(), "no bump before 500ms").toBe(before);
      vi.advanceTimersByTime(1);
      expect(handle.getLastGeneration(), "bump at 500ms").toBe(before + 1);
    } finally {
      await handle.close();
    }
  });

  it("stops emitting onDebouncedChange callbacks after close()", async () => {
    const root = tmpdirSync();
    const calls: number[] = [];
    const handle = createWorkspaceWatcher(root, false, () => {
      calls.push(Date.now());
    });

    // Close BEFORE any events fire.
    await handle.close();

    // Now emit + advance time; no callbacks should fire.
    handle.watcher.emit("add", `${root}/.aifetchly/closed.md`);
    vi.advanceTimersByTime(1000);

    expect(calls.length, "no callbacks after close()").toBe(0);
  });

  it("does not fire for events arriving after a callback was already scheduled (burst already primed)", async () => {
    const root = tmpdirSync();
    const calls: number[] = [];
    const handle = createWorkspaceWatcher(root, false, () => {
      calls.push(Date.now());
    });

    try {
      handle.watcher.emit("add", `${root}/.aifetchly/a.md`);
      vi.advanceTimersByTime(250); // halfway through the window
      handle.watcher.emit("add", `${root}/.aifetchly/b.md`); // resets the timer
      vi.advanceTimersByTime(499); // would have fired if not reset
      expect(calls.length).toBe(0);
      vi.advanceTimersByTime(1); // 500ms since the second event
      expect(calls.length).toBe(1);
    } finally {
      await handle.close();
    }
  });
});
