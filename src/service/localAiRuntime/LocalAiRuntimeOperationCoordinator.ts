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

export class LocalAiRuntimeOperationCoordinator {
  private readonly operations = new Map<
    LocalAiRuntimeId,
    RuntimeOperationLease
  >();
  private readonly versionLeases = new Set<string>();

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

  // ---- worker version leases ----

  acquireVersionLease(runtimeId: LocalAiRuntimeId, version: string): void {
    this.versionLeases.add(this.versionKey(runtimeId, version));
  }

  releaseVersionLease(runtimeId: LocalAiRuntimeId, version: string): void {
    this.versionLeases.delete(this.versionKey(runtimeId, version));
  }

  isVersionLeased(runtimeId: LocalAiRuntimeId, version: string): boolean {
    return this.versionLeases.has(this.versionKey(runtimeId, version));
  }

  private versionKey(runtimeId: LocalAiRuntimeId, version: string): string {
    return `${runtimeId}|${version}`;
  }
}
