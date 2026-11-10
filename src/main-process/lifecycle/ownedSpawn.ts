import { log } from "@/modules/Logger";
import { getOwnedProcessRegistry } from "@/main-process/lifecycle/OwnedProcessRegistry";
import type {
  OwnedProcessHandle,
  OwnedProcessRecordView,
  RegisterOptions,
} from "@/main-process/lifecycle/OwnedProcessRegistry";
import {
  isSpawnAllowed,
  SpawnGateError,
} from "@/main-process/lifecycle/spawnGate";

/**
 * ownedSpawn — the one-liner adoption path for every main-process spawn
 * family (application-exit design §2/§6, PRD tasks 2-3).
 *
 * Each launcher does:
 *
 *   if (!ownedSpawnAllowed("yellow-pages")) return refuse();
 *   const child = utilityProcess.fork(...);   // or child_process.spawn
 *   registerOwnedProcess("yellow-pages", child);
 *
 * The structural handle below is satisfied by BOTH Electron's
 * UtilityProcess and Node's ChildProcess, so no per-family adapter is
 * needed. Registration never throws — a family whose registration fails
 * still runs; the force phase simply cannot see it (logged, surfaced in
 * the shutdown report as an unregistered family).
 */

/**
 * Structural shape common to UtilityProcess and ChildProcess. Methods are
 * OPTIONAL because some clients hold a deliberately minimal local type for
 * the same runtime process — a pid-only record still gets force-phase
 * signal coverage; the kill/exit-observation extras attach when present.
 */
export interface SpawnedProcessLike {
  /** UtilityProcess.pid is `number | null`; ChildProcess.pid is `number | undefined`. */
  readonly pid?: number | null | undefined;
  kill?(signal?: NodeJS.Signals): boolean;
  once?(
    event: "exit",
    listener: (code: number | null, signal?: NodeJS.Signals | null) => void
  ): unknown;
}

/** Spawn gate re-export with an owner id (see spawnGate.ts). */
export function ownedSpawnAllowed(ownerId: string): boolean {
  return isSpawnAllowed(ownerId);
}

/**
 * The single adoption point (design §6): gate -> launch -> register in ONE
 * call so the ownerId string can never drift between the gate check and the
 * registration. Throws SpawnGateError when the app is shutting down (the
 * caller's existing error handling reports the refused work); the launch
 * function runs only when the gate is open.
 *
 *   const child = spawnOwned("yellow-pages", () => utilityProcess.fork(...));
 */
export function spawnOwned<T extends SpawnedProcessLike>(
  ownerId: string,
  launch: () => T,
  options: Omit<RegisterOptions, "ownerId" | "pid" | "handle"> = {}
): T {
  if (!ownedSpawnAllowed(ownerId)) {
    throw new SpawnGateError(ownerId);
  }
  const process = launch();
  registerOwnedProcess(ownerId, process, options);
  return process;
}

/**
 * Register a freshly launched owned process. Best-effort: returns null and
 * logs on failure so a registry hiccup can never break the feature itself.
 */
export function registerOwnedProcess(
  ownerId: string,
  process: SpawnedProcessLike,
  options: Omit<RegisterOptions, "ownerId" | "pid" | "handle"> = {}
): OwnedProcessRecordView | null {
  try {
    const handle: OwnedProcessHandle | null =
      typeof process.kill === "function" && typeof process.once === "function"
        ? (process as OwnedProcessHandle)
        : null;
    return getOwnedProcessRegistry().register({
      ownerId,
      pid: process.pid ?? undefined,
      handle,
      ...options,
    });
  } catch (err) {
    log.warn(
      `[registry] could not register owned process '${ownerId}':`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}
