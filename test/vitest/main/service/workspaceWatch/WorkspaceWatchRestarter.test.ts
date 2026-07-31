/**
 * WorkspaceWatchRestarter — WAT-07 sliding-window restart-cap tests.
 *
 * Pure-logic unit tests (no Electron, no child_process). The restarter
 * owns the only place restart-cap accounting happens — bounded to
 * MAX_RESTARTS=3 within a sliding RESTART_WINDOW_MS=60_000 window. No
 * infinite respawn loops (research §Pitfall 6).
 *
 * Cases (per plan Task 2):
 *   (a) 3 restarts within 60s → canRestart returns false on the 4th.
 *   (b) restart timestamps older than 60s are pruned → canRestart
 *       returns true again.
 *   (c) reset() clears the window.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_RESTARTS,
  RESTART_WINDOW_MS,
  WorkspaceWatchRestarter,
} from "@/service/workspaceWatch/WorkspaceWatchRestarter";

describe("WorkspaceWatchRestarter — WAT-07 sliding 60s window", () => {
  it("exposes the configured constants", () => {
    expect(MAX_RESTARTS).toBe(3);
    expect(RESTART_WINDOW_MS).toBe(60_000);
  });

  it("(a) allows MAX_RESTARTS within the window; 4th call returns canRestart=false", () => {
    const r = new WorkspaceWatchRestarter();
    const t0 = 1_000_000;
    // First 3 restarts are allowed (under cap).
    const r1 = r.recordRestart(t0 + 1_000);
    expect(r1.restartCount).toBe(1);
    expect(r1.canRestart).toBe(true);

    const r2 = r.recordRestart(t0 + 2_000);
    expect(r2.restartCount).toBe(2);
    expect(r2.canRestart).toBe(true);

    const r3 = r.recordRestart(t0 + 3_000);
    expect(r3.restartCount).toBe(3);
    expect(r3.canRestart).toBe(true);

    // Standalone canRestart() now reports no headroom (3 < 3 === false).
    expect(r.canRestart()).toBe(false);

    // The 4th call records the timestamp (for diagnostics) but reports
    // over-cap — the manager uses this to transition to 'failed'.
    const r4 = r.recordRestart(t0 + 4_000);
    expect(r4.restartCount).toBe(4);
    expect(r4.canRestart).toBe(false);
  });

  it("(b) prunes timestamps older than the window; canRestart returns true again", () => {
    const r = new WorkspaceWatchRestarter();
    const t0 = 5_000_000;
    // Saturate the window at the cap with three closely-spaced restarts.
    r.recordRestart(t0);
    r.recordRestart(t0 + 1_000);
    r.recordRestart(t0 + 2_000);
    expect(r.canRestart()).toBe(false);

    // 61s AFTER the most recent in-window entry: every prior timestamp
    // is now strictly older than RESTART_WINDOW_MS, so the prune step
    // removes all of them before appending the new one.
    const t1 = t0 + 2_000 + RESTART_WINDOW_MS + 1_000;
    const after = r.recordRestart(t1);
    // The 3 old entries are pruned; only the new one remains in-window.
    expect(after.restartCount).toBe(1);
    expect(after.canRestart).toBe(true);
    expect(r.canRestart()).toBe(true);
  });

  it("(c) reset() clears the window", () => {
    const r = new WorkspaceWatchRestarter();
    r.recordRestart(100);
    r.recordRestart(200);
    r.recordRestart(300);
    expect(r.canRestart()).toBe(false);

    r.reset();

    expect(r.canRestart()).toBe(true);
    const after = r.recordRestart(400);
    expect(after.restartCount).toBe(1);
    expect(after.canRestart).toBe(true);
  });

  it("recentRestarts(now) returns a defensive copy of in-window timestamps", () => {
    const r = new WorkspaceWatchRestarter();
    r.recordRestart(1_000);
    r.recordRestart(2_000);

    const snapshot = r.recentRestarts(2_000);
    expect(snapshot).toEqual([1_000, 2_000]);
    // Mutating the returned array does not corrupt internal state.
    (snapshot as number[]).push(9_999);
    expect(r.recentRestarts(2_000)).toEqual([1_000, 2_000]);
  });
});
