/**
 * Centralized bounds and default limits for AI Chat V2 scheduled loops.
 *
 * The parser, IPC handler, module, scheduler, and runner all read these so the
 * rules live in one place (PRD §8.6, technical-design §7).
 *
 * A scheduled loop is a persistent, interval-based `/loop` mode
 * (`/loop 5m <prompt>`). These constants are intentionally separate from the
 * goal-loop config: one bounds a single immediate goal run, the other bounds a
 * recurring persistent schedule.
 */

/** Minimum allowed interval (1 minute). No second-level intervals in the MVP. */
export const SCHEDULED_LOOP_MIN_INTERVAL_MS = 60_000;

/** Maximum allowed interval (24 hours). */
export const SCHEDULED_LOOP_MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Default maximum number of occurrences when none is requested. */
export const SCHEDULED_LOOP_DEFAULT_MAX_RUNS = 24;

/** Hard maximum number of occurrences per schedule. */
export const SCHEDULED_LOOP_MAX_RUNS = 100;

/** Minimum allowed occurrence count. */
export const SCHEDULED_LOOP_MIN_RUNS = 1;

/** Default schedule lifetime cap when none is requested (24 hours). */
export const SCHEDULED_LOOP_DEFAULT_MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** Hard maximum schedule lifetime (7 days). */
export const SCHEDULED_LOOP_MAX_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** Consecutive run failures before a schedule is marked failed. */
export const SCHEDULED_LOOP_MAX_CONSECUTIVE_FAILURES = 3;

/** How long a scheduled turn waits on a busy conversation before coalescing. */
export const SCHEDULED_LOOP_CONVERSATION_LOCK_WAIT_MS = 30_000;

/** A running occurrence older than this is treated as stale after restart. */
export const SCHEDULED_LOOP_STALE_RUN_MS = 10 * 60 * 1000;

/** MVP default misfire policy: at most one catch-up run after restart/sleep. */
export const SCHEDULED_LOOP_DEFAULT_MISFIRE_POLICY = "run_once" as const;

/** MVP overlap policy: coalesce due occurrences into one pending run. */
export const SCHEDULED_LOOP_DEFAULT_OVERLAP_POLICY = "coalesce" as const;

/** Per-occurrence wall-clock cap for a scheduled AI turn (10 minutes). */
export const SCHEDULED_LOOP_RUN_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Checked integer multiply. Returns null when the result is not a safe integer
 * (prevents silent overflow when converting durations to milliseconds).
 */
export function checkedMultiply(a: number, b: number): number | null {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return null;
  const result = a * b;
  if (!Number.isSafeInteger(result)) return null;
  return result;
}

/** True when a millisecond interval is within the configured bounds. */
export function isValidIntervalMs(ms: number): boolean {
  return (
    Number.isSafeInteger(ms) &&
    ms >= SCHEDULED_LOOP_MIN_INTERVAL_MS &&
    ms <= SCHEDULED_LOOP_MAX_INTERVAL_MS
  );
}

/** True when a run count is within the configured bounds. */
export function isValidMaxRuns(count: number): boolean {
  return (
    Number.isSafeInteger(count) &&
    count >= SCHEDULED_LOOP_MIN_RUNS &&
    count <= SCHEDULED_LOOP_MAX_RUNS
  );
}

/** True when a lifetime duration is within the configured bounds. */
export function isValidMaxLifetimeMs(ms: number): boolean {
  return (
    Number.isSafeInteger(ms) &&
    ms >= SCHEDULED_LOOP_MIN_INTERVAL_MS &&
    ms <= SCHEDULED_LOOP_MAX_LIFETIME_MS
  );
}

/** Clamp a requested interval to the legal range. Returns null if not a safe int. */
export function clampIntervalMs(ms: number): number | null {
  if (!Number.isSafeInteger(ms)) return null;
  if (ms < SCHEDULED_LOOP_MIN_INTERVAL_MS)
    return SCHEDULED_LOOP_MIN_INTERVAL_MS;
  if (ms > SCHEDULED_LOOP_MAX_INTERVAL_MS)
    return SCHEDULED_LOOP_MAX_INTERVAL_MS;
  return ms;
}

/** Clamp a requested run count to the legal range. Returns null if not a safe int. */
export function clampMaxRuns(count: number): number | null {
  if (!Number.isSafeInteger(count)) return null;
  if (count < SCHEDULED_LOOP_MIN_RUNS) return SCHEDULED_LOOP_MIN_RUNS;
  if (count > SCHEDULED_LOOP_MAX_RUNS) return SCHEDULED_LOOP_MAX_RUNS;
  return count;
}

/** Clamp a requested lifetime to the legal range. Returns null if not a safe int. */
export function clampMaxLifetimeMs(ms: number): number | null {
  if (!Number.isSafeInteger(ms)) return null;
  if (ms < SCHEDULED_LOOP_MIN_INTERVAL_MS)
    return SCHEDULED_LOOP_MIN_INTERVAL_MS;
  if (ms > SCHEDULED_LOOP_MAX_LIFETIME_MS)
    return SCHEDULED_LOOP_MAX_LIFETIME_MS;
  return ms;
}

// ---------------------------------------------------------------------------
// Cadence math (technical-design §16.1-16.2). Pure functions over epoch ms so
// they can be unit-tested with an injected clock and never touch Date.now().
// ---------------------------------------------------------------------------

/**
 * Occurrence number of a cadence slot time. Occurrence n is due at
 * `anchor + n * interval`. Returns null when the slot is not on the cadence
 * grid (delta < interval or delta not a whole multiple of the interval).
 */
export function occurrenceOfSlot(
  anchorMs: number,
  intervalMs: number,
  slotTimeMs: number
): number | null {
  if (!Number.isSafeInteger(anchorMs) || !Number.isSafeInteger(intervalMs)) {
    return null;
  }
  if (intervalMs <= 0) return null;
  const delta = slotTimeMs - anchorMs;
  if (delta < intervalMs) return null;
  if (delta % intervalMs !== 0) return null;
  return delta / intervalMs;
}

/**
 * First cadence occurrence strictly after `nowMs`. Occurrence 1 is the first
 * run (due at anchor + interval). Uses checked arithmetic and clamps invalid
 * dates. Returns { occurrence, timeMs }.
 */
export function nextFutureOccurrence(
  anchorMs: number,
  intervalMs: number,
  nowMs: number
): { occurrence: number; timeMs: number } {
  const interval = Math.max(1, intervalMs);
  const elapsed = nowMs - anchorMs;
  let occurrence: number;
  if (elapsed < interval) {
    occurrence = 1;
  } else {
    occurrence = Math.floor(elapsed / interval) + 1;
  }
  const timeMs = checkedMultiply(occurrence, interval);
  if (timeMs === null) {
    // Overflow guard: fall back to a very large but safe future slot.
    occurrence = Math.floor(Number.MAX_SAFE_INTEGER / interval);
    return {
      occurrence,
      timeMs: Number.MAX_SAFE_INTEGER,
    };
  }
  return { occurrence, timeMs: anchorMs + timeMs };
}
