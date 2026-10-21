/**
 * N08 / F08 — readiness STATE machine for the upgrade-validation gate, split
 * from the gate module (`EmailReplyReadiness.ts`) so it can be imported from
 * the shared vitest setup file with ZERO imports of its own.
 *
 * Why zero imports matters: the shared setup file (`test/vitest/_setup/
 * isolatedTmpDir.ts`) runs before every test file's `vi.mock` registrations.
 * Any import chain that reaches `token`/`electron-store` from the setup file
 * — even via a deferred dynamic import — races per-file mock registration
 * under parallel load: the real store gets cached into Token-mocked suites
 * (isArchiveReadsEnabled() returns the real machine's "true" with an empty
 * mocked store) or resolves after environment teardown (EnvironmentTeardownError
 * "Cannot load electron-store ... after the environment was torn down",
 * observed from EmailReplyD7Seams.test.ts on 2026-10-16).
 *
 * A module with no imports has nothing for vi.mock to interpose and no Token
 * chain to evaluate: the setup file's static import is synchronous, completes
 * during setup evaluation, and cannot collide with ANY test file's mocks.
 *
 * State machine semantics (unchanged from the F08 design):
 *   - `pending` (initial): validation launched but not yet settled.
 *   - `passed`: validation succeeded — new work allowed (unless kill switch).
 *   - `failed`: validation failed / threw / failed to launch — new work refused.
 * Fail-closed: any unknown state refuses new work.
 */

export type UpgradeValidationState = "pending" | "passed" | "failed";

let validationState: UpgradeValidationState = "pending";

export function markUpgradeValidationPending(): void {
  validationState = "pending";
}

export function getUpgradeValidationState(): UpgradeValidationState {
  return validationState;
}

export function setUpgradeValidationStateForTests(
  state: UpgradeValidationState
): void {
  validationState = state;
}

export function markUpgradeValidationPassed(): void {
  validationState = "passed";
}

export function markUpgradeValidationFailed(): void {
  validationState = "failed";
}
