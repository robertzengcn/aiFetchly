/**
 * R5-10 (design §5.3): in-process readiness gate for remote organization
 * actions. Startup runs the location backfill BEFORE the feature is used;
 * if the backfill has not completed successfully in this process, every
 * mutating organization path (IPC + AI tools) fails closed until it does.
 * The gate is deliberately in-memory: a fresh process re-runs the idempotent
 * backfill and re-derives the state, so no stale flag can outlive a crash.
 */

let locationBackfillReady = false;

export function setLocationBackfillReady(ready: boolean): void {
  locationBackfillReady = ready;
}

export function isLocationBackfillReady(): boolean {
  return locationBackfillReady;
}

/** Deterministic refusal reason for the gate (UI/tool mapping). */
export const ORGANIZATION_BACKFILL_PENDING_CODE = "ORGANIZATION_BACKFILL_PENDING";

export function organizationBackfillPendingMessage(): string {
  return (
    "Email organization is not ready yet: the startup location backfill has not " +
    "completed in this session. Retry shortly or restart the app."
  );
}
