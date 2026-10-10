import { log } from "@/modules/Logger";
import type { ApplicationLifecycleService } from "@/main-process/lifecycle/ApplicationLifecycleService";

/**
 * Spawn gate — the synchronous freeze hook (PRD FR-05, AC-05).
 *
 * Process-spawning sites consult this gate BEFORE launching: once the
 * lifecycle service enters `quitting`, new spawns, queued starts, retries,
 * and worker restarts are refused. The gate flips synchronously inside
 * `requestExit` (design §4), so a spawn admitted an instant before exit
 * sees the closed gate.
 *
 * Adoption status (v1): the contact-extraction worker spawn + crash-restart
 * path consults `isSpawnAllowed`. Remaining families (Yellow Pages,
 * workspace watch, MCP, tool-job workers) are covered by the force phase's
 * verified termination until they adopt the gate; `assertSpawnAllowed` is
 * the throwing variant reserved for those adapters.
 *
 * Pure TypeScript: bound to the lifecycle singleton at composition time
 * (background.ts), so worker transports and tests can import it freely.
 */

export const SPAWN_BLOCKED_ERROR_CODE = "SPAWN_BLOCKED_SHUTDOWN";

export class SpawnGateError extends Error {
  readonly code = SPAWN_BLOCKED_ERROR_CODE;
  constructor(ownerId: string) {
    super(
      `Spawn refused: application is shutting down (owner: ${ownerId})`
    );
    this.name = "SpawnGateError";
  }
}

let lifecycle: ApplicationLifecycleService | null = null;

/** Composition root wiring (idempotent). */
export function bindSpawnGateToLifecycle(
  service: ApplicationLifecycleService
): void {
  lifecycle = service;
}

/** True while the application accepts new background work. */
export function isSpawnAllowed(ownerId: string): boolean {
  if (!lifecycle) return true; // gate not wired (tests, early startup)
  if (!lifecycle.isQuitting()) return true;
  log.warn(`[spawn-gate] blocked spawn for '${ownerId}' during shutdown`);
  return false;
}

/**
 * Throwing variant for spawn sites: a refused launch must not silently
 * degrade into an untracked zombie; the owner's error handling takes over.
 */
export function assertSpawnAllowed(ownerId: string): void {
  if (!isSpawnAllowed(ownerId)) {
    throw new SpawnGateError(ownerId);
  }
}
