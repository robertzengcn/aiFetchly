import { isEmailReplyKillSwitchOn } from "@/config/featureFlags";
import {
  getUpgradeValidationState,
  setUpgradeValidationStateForTests as _setState,
} from "./EmailReplyReadinessState";

export {
  // Re-exported so background.ts and the N08 integration test keep importing
  // from this gate module. The state itself lives in EmailReplyReadinessState
  // (zero imports) so the shared vitest setup file can mark readiness
  // statically without evaluating this module's Token chain.
  markUpgradeValidationPending,
  markUpgradeValidationPassed,
  markUpgradeValidationFailed,
  getUpgradeValidationState,
} from "./EmailReplyReadinessState";

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
 * The state machine lives in `./EmailReplyReadinessState` (zero imports —
 * see that file for the F08 fixture-race rationale). This module owns the
 * admission check, which reads the kill switch through the Token chain.
 *
 * Fail-closed: any unknown state refuses new work. Import/Token-write failures
 * in the startup path set `failed` explicitly.
 */

export type { UpgradeValidationState } from "./EmailReplyReadinessState";

/**
 * Test fixture hook (F08): the shared vitest setup file marks readiness
 * `passed` synchronously during setup evaluation via the zero-import state
 * module. Re-exported here as a named binding so suites that already import
 * it from the gate module keep working; the setup file itself imports the
 * state module directly (never this Token-chain module).
 */
export function setUpgradeValidationStateForTests(
  state: Parameters<typeof _setState>[0]
): void {
  _setState(state);
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
  if (getUpgradeValidationState() === "pending") {
    return {
      ready: false,
      reason: "Reply upgrade validation is still pending; new guarded work is held until it succeeds",
    };
  }
  if (getUpgradeValidationState() === "failed") {
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
