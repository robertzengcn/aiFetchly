/**
 * N02: process-wide submitter liveness registry (technical design §9/§16).
 *
 * A timeout/status change alone must never prove non-delivery. Before a
 * recovered `delivery_unknown` attempt may be negatively reconciled
 * (`confirm_not_sent` → `failed` + guard reopen), the original SMTP submitter
 * must be proven quiescent in THIS process: no live `sendReplyEmail` promise
 * for that attempt id may still be running.
 *
 * Lifecycle:
 *   - `markRunning(attemptId)` immediately before the SMTP handoff.
 *   - `markSettled(attemptId)` in a `finally` after the SMTP promise settles
 *     (success, rejection, or throw) and after `finalizeSendOutcome` runs.
 *   - `isRunning(attemptId)` consulted by `reconcileDelivery` for
 *     `confirm_not_sent`: a running submitter refuses the downgrade.
 *
 * Restart semantics: the registry is in-memory only. After a process restart
 * no submitter is running, so a recovered attempt IS eligible for negative
 * reconciliation (the crash itself is the quiescence evidence — the old
 * promise died with the process). This matches the recovery contract: the
 * crash is quiescence, a live promise is not.
 */
const runningSubmitters = new Set<number>();

export function markSubmitterRunning(attemptId: number): void {
  runningSubmitters.add(attemptId);
}

export function markSubmitterSettled(attemptId: number): void {
  runningSubmitters.delete(attemptId);
}

export function isSubmitterRunning(attemptId: number): boolean {
  return runningSubmitters.has(attemptId);
}

/** Test-only: clear the registry between isolated test cases. */
export function clearSubmitterTrackerForTests(): void {
  runningSubmitters.clear();
}
