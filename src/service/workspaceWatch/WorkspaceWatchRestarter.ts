/**
 * WorkspaceWatchRestarter — WAT-07 sliding-window restart-cap accounting.
 *
 * The single place where worker-restart accounting happens. Bounded to
 * {@link MAX_RESTARTS} (3) within a sliding {@link RESTART_WINDOW_MS}
 * (60_000) window. When the cap is exceeded the watch manager transitions
 * to 'failed' and surfaces a diagnostic; `/reload-config` is the manual
 * retry path (research §9.8 / §Pitfall 6 — no infinite respawn loops).
 *
 * Pure logic — no Electron / child_process / fs imports. The manager
 * drives it via {@link recordRestart} on every worker crash or malformed
 * IPC message; the IPC layer's `/reload-config` handler calls
 * {@link reset} after a quiet period.
 *
 * Window semantics:
 *   - The window is an array of monotonic timestamps (epoch ms or
 *     performance.now-ish values — the caller picks; only deltas matter).
 *   - On every {@link recordRestart}, entries older than
 *     `now - RESTART_WINDOW_MS` are pruned before the new timestamp is
 *     appended (so the post-record length is the in-window count).
 *   - {@link canRestart} (standalone) reports headroom for ONE more
 *     restart: `count < MAX_RESTARTS`. After 3 restarts in the window it
 *     returns false.
 *   - {@link recordRestart}'s returned `canRestart` reports whether the
 *     just-recorded restart was within the cap: `count <= MAX_RESTARTS`.
 *     The manager uses this to decide between re-fork (under cap) and
 *     surfacing 'failed' (over cap).
 *
 * Design references: §9.8 (crash handling — max 3/60s + full rescan),
 * §15.2 (watcher failures), research §Pitfall 6 (restart-loop DoS).
 */

/** Maximum restarts allowed within the sliding window (WAT-07). */
export const MAX_RESTARTS = 3;

/** Sliding window length in milliseconds (WAT-07). */
export const RESTART_WINDOW_MS = 60_000;

export interface RecordRestartResult {
  /** Whether the just-recorded restart is within the cap (count <= MAX). */
  readonly canRestart: boolean;
  /** Number of restarts currently in the window (after this recording). */
  readonly restartCount: number;
}

/**
 * Sliding-window restart-cap accountant.
 *
 * Stateless across a "session" except for the in-memory timestamp window.
 * The manager constructs one and retains it for the worker's lifetime.
 */
export class WorkspaceWatchRestarter {
  private readonly restarts: number[] = [];

  /**
   * Record a restart at the given timestamp. Prunes entries older than
   * `timestamp - RESTART_WINDOW_MS` BEFORE appending the new timestamp,
   * so the returned `restartCount` reflects the in-window total.
   */
  recordRestart(timestamp: number): RecordRestartResult {
    this.prune(timestamp);
    this.restarts.push(timestamp);
    const count = this.restarts.length;
    return { canRestart: count <= MAX_RESTARTS, restartCount: count };
  }

  /**
   * Is there headroom for one more restart right now? `count < MAX`.
   * After {@link MAX_RESTARTS} restarts in the window this returns false.
   */
  canRestart(): boolean {
    return this.restarts.length < MAX_RESTARTS;
  }

  /**
   * Clear the window. Called by the IPC layer's `/reload-config` handler
   * after a quiet period (research §9.8 — manual retry path).
   */
  reset(): void {
    this.restarts.length = 0;
  }

  /**
   * Defensive copy of the in-window timestamps as of `now`. Surfaced via
   * the manager's getStatus() for /status display. Callers may mutate the
   * returned array without corrupting internal state.
   */
  recentRestarts(now: number): readonly number[] {
    this.prune(now);
    return [...this.restarts];
  }

  /** Remove entries older than `now - RESTART_WINDOW_MS`. */
  private prune(now: number): void {
    const cutoff = now - RESTART_WINDOW_MS;
    while (this.restarts.length > 0 && this.restarts[0] < cutoff) {
      this.restarts.shift();
    }
  }
}
