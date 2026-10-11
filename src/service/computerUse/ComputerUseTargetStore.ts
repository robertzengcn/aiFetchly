/**
 * Computer Use target store (design §9.2, §10.2).
 *
 * Bounded in-memory store of host-minted target handles. Native identifiers,
 * transforms, coordinates, generation, expiry, and grants stay here — they
 * are never accepted as model-supplied authority fields and never persisted
 * into ordinary tool JSON.
 */
import { randomUUID } from "crypto";
import {
  ComputerUseError,
  type ComputerUseObservationId,
  type ComputerUseResolvedTarget,
  type ComputerUseSessionGeneration,
  type ComputerUseTargetHandle,
} from "@/entityTypes/computerUseTypes";

/** Maximum retained targets per session (bounded by design; oldest evicted). */
const MAX_TARGETS_PER_SESSION = 256;

export class ComputerUseTargetStore {
  private readonly targets = new Map<
    ComputerUseTargetHandle,
    ComputerUseResolvedTarget
  >();

  /** Mint a fresh opaque handle for a resolved target. */
  create(
    target: Omit<ComputerUseResolvedTarget, "handle" | "createdAt">
  ): ComputerUseTargetHandle {
    if (this.targets.size >= MAX_TARGETS_PER_SESSION) {
      // Evict the oldest entry (Map preserves insertion order).
      const oldest = this.targets.keys().next().value;
      if (oldest !== undefined) this.targets.delete(oldest);
    }
    const handle = `cut_${randomUUID()}`;
    this.targets.set(handle, { ...target, handle, createdAt: Date.now() });
    return handle;
  }

  /**
   * Resolve a handle against generation + staleness rules. A moved window,
   * changed display, expired observation, or generation mismatch never
   * produces a usable target (CU-VISION-05).
   */
  resolve(
    handle: ComputerUseTargetHandle,
    generation: ComputerUseSessionGeneration,
    now = Date.now()
  ): ComputerUseResolvedTarget {
    const target = this.targets.get(handle);
    if (!target) {
      throw new ComputerUseError("target_stale", "Unknown target handle");
    }
    if (target.generation !== generation) {
      throw new ComputerUseError(
        "target_stale",
        "Target handle belongs to an older session generation"
      );
    }
    if (now > target.expiresAt) {
      this.targets.delete(handle);
      throw new ComputerUseError("target_stale", "Target handle expired");
    }
    return target;
  }

  /** Drop every target of a generation (stop / handoff invalidation). */
  invalidateGeneration(generation: ComputerUseSessionGeneration): number {
    let removed = 0;
    for (const [handle, target] of this.targets) {
      if (target.generation === generation) {
        this.targets.delete(handle);
        removed++;
      }
    }
    return removed;
  }

  /** Drop targets bound to a specific observation. */
  invalidateObservation(observationId: ComputerUseObservationId): number {
    let removed = 0;
    for (const [handle, target] of this.targets) {
      if (target.observationId === observationId) {
        this.targets.delete(handle);
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    this.targets.clear();
  }

  get size(): number {
    return this.targets.size;
  }
}
