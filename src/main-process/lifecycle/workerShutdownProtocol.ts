import { randomUUID } from "crypto";
import { log } from "@/modules/Logger";
import type { OwnedProcessRegistry } from "@/main-process/lifecycle/OwnedProcessRegistry";
import type { SpawnedProcessLike } from "@/main-process/lifecycle/ownedSpawn";

/**
 * workerShutdownProtocol — the parent-side half of the §7 graceful shutdown
 * (design §7), generic across every registered worker family.
 *
 * The registry stores handles opaquely; transports are INFERRED structurally:
 *   - `.postMessage(message)` → Electron UtilityProcess
 *   - `.send(message)`        → child_process with an ipc channel
 *
 * `requestWorkerShutdown` sends `{type:"shutdown", requestId, reason,
 * remainingMs}` over the inferred transport, waits a bounded slice for
 * OBSERVED natural exit (an ack is not exit proof), and returns whether the
 * worker exited. It never kills — the coordinator's force phase owns
 * termination, so a worker that ignores the protocol is still force-stopped
 * with verification.
 */

/** Transport inference over the opaque registry handle. */
export type ShutdownTransport = (message: unknown) => boolean;

export function inferShutdownTransport(
  process: SpawnedProcessLike
): ShutdownTransport | null {
  const maybe = process as {
    postMessage?: (message: unknown) => unknown;
    send?: (message: unknown) => boolean;
  };
  if (typeof maybe.postMessage === "function") {
    return (message) => {
      try {
        maybe.postMessage!(message);
        return true;
      } catch {
        return false;
      }
    };
  }
  if (typeof maybe.send === "function") {
    return (message) => {
      try {
        return Boolean(maybe.send!(message));
      } catch {
        return false;
      }
    };
  }
  return null;
}

export interface WorkerProtocolResult {
  readonly ownerId: string;
  readonly requested: boolean;
  readonly exited: boolean;
}

/**
 * Send the §7 shutdown request to ONE live owned record and wait (bounded)
 * for observed exit. Returns requested=false when the transport is unusable
 * (already gone, or a handle with neither postMessage nor send).
 */
export async function requestWorkerShutdown(
  ownerId: string,
  process: SpawnedProcessLike,
  registry: OwnedProcessRegistry,
  budgetMs: number,
  reason = "app-shutdown"
): Promise<WorkerProtocolResult> {
  const record = registry
    .listByOwner(ownerId)
    .find((r) => r.pid === (process.pid ?? null));
  const transport = inferShutdownTransport(process);
  if (!transport || !record) {
    return { ownerId, requested: false, exited: false };
  }
  const requestId = randomUUID();
  const sent = transport({
    type: "shutdown",
    requestId,
    reason,
    remainingMs: budgetMs,
  });
  if (!sent) {
    log.warn(`[worker-protocol] shutdown send failed for '${ownerId}'`);
    return { ownerId, requested: false, exited: false };
  }
  const exited = await registry.observeExit(record.id, Math.max(0, budgetMs));
  if (!exited) {
    log.info(
      `[worker-protocol] '${ownerId}' did not exit within ${budgetMs}ms; force phase owns it`
    );
  }
  return { ownerId, requested: true, exited };
}
