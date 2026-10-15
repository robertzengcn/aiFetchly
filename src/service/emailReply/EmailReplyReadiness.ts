import { isEmailReplyKillSwitchOn } from "@/config/featureFlags";

/**
 * N08: shared upgrade-validation readiness gate (FR-038 §5.3).
 *
 * Guarded reply work (draft generation + new send claims) must not start while
 * the startup upgrade validation is pending/stuck or has failed. Ordinary app
 * startup stays responsive (validation runs async), but new guarded work
 * refuses until validation succeeds. Audit reads, message viewing, and
 * delivery reconciliation stay available (they run through their own IPC
 * handlers and never consult this gate) so operators can diagnose and
 * recover.
 *
 * State machine (process-local, main process only):
 *   - `pending` (initial): validation launched but not yet settled.
 *   - `passed`: validation succeeded — new work allowed (unless kill switch).
 *   - `failed`: validation failed / threw / failed to launch — new work
 *     refused (kill switch is also set by the validation path, but this state
 *     refuses even if the Token write itself failed).
 *
 * Fail-closed: any unknown state refuses new work. Import/Token-write failures
 * in the startup path set `failed` explicitly.
 */

export type UpgradeValidationState = "pending" | "passed" | "failed";

// Default `passed` so isolated unit/integration tests (which never run the
// production startup path) see the pre-existing open behavior. Production
// `background.ts` sets `pending` synchronously at startup before launching
// the async validation, so real guarded work is held until validation
// succeeds. New N08 regression tests set pending/failed explicitly.
let validationState: UpgradeValidationState = "passed";

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

/**
 * Authoritative admission check for NEW guarded work (generation entry,
 * send-claim entry, AI tool entry). Returns ready only when validation has
 * passed AND the emergency kill switch is off.
 *
 * Audit/recovery/view paths MUST NOT consult this gate — they stay available
 * during validation failure by design (§5.3).
 */
export function checkNewGuardedWorkReady(): {
  ready: boolean;
  reason: string;
} {
  if (validationState === "pending") {
    return {
      ready: false,
      reason: "Reply upgrade validation is still pending; new guarded work is held until it succeeds",
    };
  }
  if (validationState === "failed") {
    return {
      ready: false,
      reason: "Reply upgrade validation failed; new guarded work is disabled",
    };
  }
  if (isEmailReplyKillSwitchOn()) {
    return {
      ready: false,
      reason: "Reply work is temporarily disabled by the kill switch",
    };
  }
  return { ready: true, reason: "" };
}
