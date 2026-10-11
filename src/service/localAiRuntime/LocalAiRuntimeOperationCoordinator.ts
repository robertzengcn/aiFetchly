/**
 * Local AI Runtime — operation coordinator.
 *
 * Owns one mutable operation per runtime ID and tracks worker version leases
 * (design §14.1, §14.5). Concurrent install/repair/update/remove requests for
 * the same runtime return `runtime_busy`; voice and embedding may run
 * concurrently. A version with an active worker lease cannot be removed.
 */
import {
  LocalAiRuntimeError,
  type LocalAiRuntimeId,
  type RuntimeOperationLease,
} from "@/entityTypes/localAiRuntimeTypes";

interface PendingActivation {
  readonly runtimeId: LocalAiRuntimeId;
  readonly version: string;
  readonly apply: () => Promise<void>;
}

export class LocalAiRuntimeOperationCoordinator {
  private readonly operations = new Map<
    LocalAiRuntimeId,
    RuntimeOperationLease
  >();
  /**
   * Reference-counted worker version leases (§7.8): two holders of the same
   * version — the live grounding worker and a repair probe — must not clear
   * each other's lease.
   */
  private readonly versionLeases = new Map<string, number>();
  /** Deferred activations waiting for the current version's leases to drop. */
  private readonly pendingActivations = new Map<LocalAiRuntimeId, PendingActivation>();

  /** Acquire the operation lock for a runtime. Throws `runtime_busy` if held. */
  acquire(
    runtimeId: LocalAiRuntimeId,
    operationId: string
  ): RuntimeOperationLease {
    const existing = this.operations.get(runtimeId);
    if (existing) {
      throw new LocalAiRuntimeError(
        "runtime_busy",
        `Another ${runtimeId} operation is already in progress.`,
        true
      );
    }
    const lease: RuntimeOperationLease = {
      operationId,
      runtimeId,
      controller: new AbortController(),
      startedAt: Date.now(),
    };
    this.operations.set(runtimeId, lease);
    return lease;
  }

  get(runtimeId: LocalAiRuntimeId): RuntimeOperationLease | null {
    return this.operations.get(runtimeId) ?? null;
  }

  /** Abort the operation if it exists. Returns whether an operation was cancelled. */
  cancel(operationId: string): boolean {
    for (const lease of this.operations.values()) {
      if (lease.operationId === operationId) {
        lease.controller.abort();
        return true;
      }
    }
    return false;
  }

  /** Release the operation lock. Idempotent for unknown ids. */
  release(operationId: string): void {
    for (const [runtimeId, lease] of this.operations) {
      if (lease.operationId === operationId) {
        this.operations.delete(runtimeId);
        return;
      }
    }
  }

  // ---- worker version leases (reference-counted, §7.8) ----

  /** Holder identity for debugging/tests; ref-counted by pair. */
  acquireVersionLease(
    runtimeId: LocalAiRuntimeId,
    version: string
  ): void {
    const key = this.versionKey(runtimeId, version);
    this.versionLeases.set(key, (this.versionLeases.get(key) ?? 0) + 1);
  }

  releaseVersionLease(
    runtimeId: LocalAiRuntimeId,
    version: string
  ): void {
    const key = this.versionKey(runtimeId, version);
    const count = this.versionLeases.get(key) ?? 0;
    if (count <= 1) {
      this.versionLeases.delete(key);
      void this.runPendingActivation(runtimeId);
    } else {
      this.versionLeases.set(key, count - 1);
    }
  }

  isVersionLeased(runtimeId: LocalAiRuntimeId, version: string): boolean {
    return this.versionLeases.has(this.versionKey(runtimeId, version));
  }

  /** Current ref count for a version lease (diagnostics/tests). */
  versionLeaseCount(runtimeId: LocalAiRuntimeId, version: string): number {
    return this.versionLeases.get(this.versionKey(runtimeId, version)) ?? 0;
  }

  // ---- deferred activations (CU-INST-16) ----

  /**
   * Record an activation prepared side by side that must wait until no
   * worker holds the CURRENT active version. `apply` performs the flip
   * (rename + active.json write). Replacing a pending activation for the
   * same runtime discards the older apply.
   */
  deferActivation(
    runtimeId: LocalAiRuntimeId,
    version: string,
    apply: () => Promise<void>
  ): void {
    this.pendingActivations.set(runtimeId, { runtimeId, version, apply });
  }

  /** Whether a deferred activation exists for the runtime. */
  hasPendingActivation(runtimeId: LocalAiRuntimeId): boolean {
    return this.pendingActivations.has(runtimeId);
  }

  /** Run the pending activation when the runtime's versions are unleased. */
  private async runPendingActivation(
    runtimeId: LocalAiRuntimeId
  ): Promise<void> {
    const pending = this.pendingActivations.get(runtimeId);
    if (!pending) return;
    if (this.anyVersionLeased(runtimeId)) return;
    this.pendingActivations.delete(runtimeId);
    try {
      await pending.apply();
    } catch {
      // A failed deferred activation keeps the previous working version.
    }
  }

  private anyVersionLeased(runtimeId: LocalAiRuntimeId): boolean {
    for (const key of this.versionLeases.keys()) {
      if (key.startsWith(`${runtimeId}|`)) return true;
    }
    return false;
  }

  private versionKey(runtimeId: LocalAiRuntimeId, version: string): string {
    return `${runtimeId}|${version}`;
  }
}
