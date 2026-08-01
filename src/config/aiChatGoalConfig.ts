/**
 * Centralized /loop bounds and default limits.
 *
 * The dispatcher, IPC handler, and loop controller must all read these so the
 * rules live in one place (design §5.1).
 */

/** Minimum allowed /loop iteration count. */
export const GOAL_LOOP_MIN_ITERATIONS = 1;

/** Default /loop iteration count when none is specified. */
export const GOAL_LOOP_DEFAULT_ITERATIONS = 5;

/** Hard maximum /loop iteration count. */
export const GOAL_LOOP_MAX_ITERATIONS = 10;

/** Default per-run wall-clock cap (10 minutes). */
export const GOAL_LOOP_DEFAULT_MAX_RUNTIME_MS = 10 * 60 * 1000;

/** Default number of identical failures before a goal is marked blocked. */
export const GOAL_LOOP_DEFAULT_REPEATED_FAILURE_THRESHOLD = 3;

/** Clamp a requested iteration count to the legal range. Returns null if NaN. */
export function clampGoalLoopIterations(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < GOAL_LOOP_MIN_ITERATIONS) return GOAL_LOOP_MIN_ITERATIONS;
  if (rounded > GOAL_LOOP_MAX_ITERATIONS) return GOAL_LOOP_MAX_ITERATIONS;
  return rounded;
}
