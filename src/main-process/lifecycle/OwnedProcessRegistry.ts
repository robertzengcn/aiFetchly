import { randomUUID } from "crypto";
import { log } from "@/modules/Logger";
import type { ProcessOps } from "@/main-process/lifecycle/processOps";
import { createDefaultProcessOps } from "@/main-process/lifecycle/processOps";

/**
 * OwnedProcessRegistry — main-process ownership records and exit observation
 * (technical design §6).
 *
 * The registry is the single source of truth for every process this
 * application launched (or that an owned worker launched on its behalf).
 * Transport-specific handles (ChildProcess / utility-process ports) are
 * stored INTERNALLY and never exposed; the renderer cannot reach handles,
 * PIDs, or termination commands through any IPC surface.
 *
 * Identity model: a PID alone is not identity (PIDs are reused). Each record
 * carries an OS start-time identity when the platform can provide one
 * (linux /proc stat starttime, darwin ps lstart; win32 falls back to the
 * recorded spawn timestamp — documented limitation, design §8).
 *
 * Record lifecycle invariants (design §6):
 *  - register immediately at successful launch, including the pending-spawn
 *    interval before a PID exists
 *  - records survive their owning manager dropping its pointer; only
 *    observed exit (or verified identity mismatch) removes them
 *  - a killed root never erases its living descendant records
 *  - worker-reported descendants are ppid-validated against the reporting
 *    worker's own tree before being trusted; unvalidated reports are
 *    recorded but never force-killed (§7, §8 "ambiguous ownership")
 */

export type ProcessOwnership = "spawned-by-app" | "spawned-by-owned-worker";

/**
 * Minimal structural handle the registry understands (ChildProcess and
 * Electron utility processes both satisfy this shape).
 */
export interface OwnedProcessHandle {
  kill(signal?: NodeJS.Signals): boolean;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): unknown;
}

export interface OwnedProcessRecordView {
  readonly id: string;
  readonly ownerId: string;
  readonly pid: number | null;
  readonly ownership: ProcessOwnership;
  readonly parentRecordId: string | null;
  readonly isolatedProcessGroupId: number | null;
  /** True when the record's OS start-time identity could be captured. */
  readonly identityTracked: boolean;
  /** ppid-validated worker report (only meaningful for worker descendants). */
  readonly validated: boolean;
  readonly exited: boolean;
}

interface InternalRecord {
  readonly id: string;
  ownerId: string;
  pid: number | null;
  ownership: ProcessOwnership;
  parentRecordId: string | null;
  isolatedProcessGroupId: number | null;
  startedAtIdentity: string | null;
  spawnTimestampMs: number;
  validated: boolean;
  exited: boolean;
  handle: OwnedProcessHandle | null;
}

export interface RegisterOptions {
  ownerId: string;
  /** May be omitted for a pending spawn; resolve later with setPid. */
  pid?: number;
  /** ChildProcess / utility-process handle for cooperative kill + exit events. */
  handle?: OwnedProcessHandle | null;
  isolatedProcessGroupId?: number;
  parentRecordId?: string;
  ownership?: ProcessOwnership;
}

/** Outcome of comparing a record's stored identity against the OS right now. */
export type IdentityVerification =
  | "ours" // identity matches — the process is still ours
  | "gone" // process no longer exists
  | "reuse" // pid now belongs to a different process; ours exited
  | "unknown" // platform cannot verify (fall back to liveness probing)
  | "no-record";

/** Poll cadence for exit observation (kept in step with the terminator's verify loop). */
const OBSERVE_POLL_MS = 50;

/** Bounded parent-chain walk for worker-descendant ppid validation (§7). */
const MAX_PARENT_CHAIN_DEPTH = 8;

/**
 * Prefix marking a fallback identity recorded when the platform cannot
 * provide an OS start-time identity (win32; see design §8 limitation).
 */
const FALLBACK_IDENTITY_PREFIX = "spawn:";

/**
 * Bounded retention for EXITED records (design §6: records are kept until
 * termination is confirmed — after that they only aid short-lived
 * post-exit lookups). register() opportunistically evicts the oldest
 * exited records beyond this cap so long-running hidden/tray sessions keep
 * list()/validation scans proportional to live processes.
 */
const MAX_RETAINED_EXITED_RECORDS = 64;

export class OwnedProcessRegistry {
  private readonly records = new Map<string, InternalRecord>();
  private readonly ops: ProcessOps;
  private readonly now: () => number;

  constructor(ops: ProcessOps, now: () => number = Date.now) {
    this.ops = ops;
    this.now = now;
  }

  /**
   * Register a launched process (or a pending spawn without a PID yet).
   * Attaches an exit listener to the handle when available so termination
   * is OBSERVED, not assumed (design §6).
   */
  register(options: RegisterOptions): OwnedProcessRecordView {
    const record: InternalRecord = {
      id: randomUUID(),
      ownerId: options.ownerId,
      pid: options.pid ?? null,
      ownership: options.ownership ?? "spawned-by-app",
      parentRecordId: options.parentRecordId ?? null,
      isolatedProcessGroupId: options.isolatedProcessGroupId ?? null,
      startedAtIdentity: null,
      spawnTimestampMs: this.now(),
      validated: options.ownership !== "spawned-by-owned-worker",
      exited: false,
      handle: options.handle ?? null,
    };
    this.records.set(record.id, record);
    this.pruneExitedRecords();

    if (record.handle) {
      try {
        record.handle.once("exit", () => {
          this.markObservedExit(record.id);
        });
      } catch (err) {
        // A handle that cannot be listened to is still tracked by pid.
        log.warn(
          `[registry] could not attach exit listener for ${options.ownerId}:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
    if (record.pid !== null) {
      void this.captureIdentity(record);
    }
    return this.view(record);
  }

  /** Resolve the PID of a pending spawn (the "pending-spawn interval", §6). */
  setPid(recordId: string, pid: number): boolean {
    const record = this.records.get(recordId);
    if (!record || record.pid !== null) return false;
    record.pid = pid;
    void this.captureIdentity(record);
    return true;
  }

  listByOwner(ownerId: string): OwnedProcessRecordView[] {
    return [...this.records.values()]
      .filter((r) => r.ownerId === ownerId && !r.exited)
      .map((r) => this.view(r));
  }

  list(): OwnedProcessRecordView[] {
    return [...this.records.values()].map((r) => this.view(r));
  }

  get(recordId: string): OwnedProcessRecordView | null {
    const record = this.records.get(recordId);
    return record ? this.view(record) : null;
  }

  /**
   * Cooperative termination via the stored transport handle. Returns false
   * when no handle exists (callers fall back to signals).
   */
  killViaHandle(recordId: string, signal?: NodeJS.Signals): boolean {
    const record = this.records.get(recordId);
    if (!record || !record.handle || record.exited) return false;
    try {
      return record.handle.kill(signal);
    } catch {
      return false;
    }
  }

  /**
   * Verify the record's start-time identity against the OS right now.
   * "reuse" means the OS process with this PID started later than the one
   * we registered — our process is gone (design §8 PID-reuse protection).
   */
  async verifyIdentity(recordId: string): Promise<IdentityVerification> {
    const record = this.records.get(recordId);
    if (!record) return "no-record";
    if (record.pid === null) return "unknown";
    if (record.startedAtIdentity === null) {
      await this.captureIdentity(record);
      if (record.startedAtIdentity === null) return "unknown";
    }
    if (record.startedAtIdentity.startsWith(FALLBACK_IDENTITY_PREFIX)) {
      // Fallback identity (win32): cannot detect reuse; caller probes liveness.
      return this.ops.isAlive(record.pid) ? "unknown" : "gone";
    }
    const current = await this.ops.readStartTimeIdentity(record.pid);
    if (current === null) {
      return this.ops.isAlive(record.pid) ? "unknown" : "gone";
    }
    return current === record.startedAtIdentity ? "ours" : "reuse";
  }

  /**
   * Accept a worker-reported descendant (browser / subprocess, design §7).
   * The report is validated against the reporting worker's owned subtree:
   * the reported pid's parent chain must include the worker's pid or an
   * already-validated descendant pid. Unvalidated reports are recorded with
   * validated=false — visible for graceful close requests, but the
   * terminator never force-kills them (ambiguous ownership, §8).
   */
  async recordDescendantReport(
    workerRecordId: string,
    pid: number,
    label: string
  ): Promise<OwnedProcessRecordView | null> {
    const worker = this.records.get(workerRecordId);
    if (!worker || worker.pid === null) {
      log.warn(
        `[registry] descendant report for unknown worker (${label}); ignored`
      );
      return null;
    }
    const validated = await this.isDescendantOfWorker(pid, worker, worker.pid);
    if (!validated) {
      log.warn(
        `[registry] descendant report pid=${pid} (${label}) failed ppid ` +
          `validation against worker pid=${worker.pid}; recorded unvalidated`
      );
    }
    const record = this.register({
      ownerId: `${worker.ownerId}:${label}`,
      pid,
      ownership: "spawned-by-owned-worker",
      parentRecordId: worker.id,
      handle: null,
    });
    // setValidated targets the just-created record id — never a pid lookup.
    this.setValidated(record.id, validated);
    return this.get(record.id);
  }

  /**
   * Resolve once the process is OBSERVED to have exited — via the handle's
   * exit event or liveness polling. Resolves false on timeout (the caller
   * records a verification failure; a sent signal is not exit proof, §6).
   */
  async observeExit(recordId: string, timeoutMs: number): Promise<boolean> {
    const record = this.records.get(recordId);
    if (!record || record.exited) return true;
    if (record.pid !== null && !this.ops.isAlive(record.pid)) {
      this.markObservedExit(recordId);
      return true;
    }
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean): void => {
        if (settled) return;
        settled = true;
        clearInterval(poll);
        clearTimeout(timer);
        resolve(value);
      };
      const poll = setInterval(() => {
        const current = this.records.get(recordId);
        if (!current || current.exited) {
          finish(true);
          return;
        }
        if (current.pid !== null && !this.ops.isAlive(current.pid)) {
          this.markObservedExit(recordId);
          finish(true);
        }
      }, OBSERVE_POLL_MS);
      const timer = setTimeout(() => finish(false), Math.max(0, timeoutMs));
      if (typeof timer.unref === "function") timer.unref();
    });
  }

  /**
   * Mark a record as observed-exited (handle exit event or verified
   * termination). Records are only removable after this (design §6).
   */
  markObservedExit(recordId: string): void {
    const record = this.records.get(recordId);
    if (!record || record.exited) return;
    record.exited = true;
    record.handle = null;
  }

  /** Remove a record — only legal after observed exit (or verified reuse). */
  forget(recordId: string): boolean {
    const record = this.records.get(recordId);
    if (!record) return false;
    if (!record.exited) {
      log.warn(
        `[registry] refusing to forget live record ${record.ownerId} ` +
          `(pid=${record.pid ?? "pending"}) — must observe exit first`
      );
      return false;
    }
    this.records.delete(recordId);
    return true;
  }

  /** Descendant discovery support for the terminator (spawn races, §8). */
  async listChildPids(recordId: string): Promise<number[]> {
    const record = this.records.get(recordId);
    if (!record || record.pid === null) return [];
    return this.ops.listChildren(record.pid);
  }

  // -------------------------------------------------------------------------

  /** Evict the oldest exited records beyond the retention cap. */
  private pruneExitedRecords(): void {
    let exitedSeen = 0;
    for (const [id, record] of this.records) {
      if (!record.exited) continue;
      exitedSeen += 1;
      if (exitedSeen > MAX_RETAINED_EXITED_RECORDS) {
        this.records.delete(id);
      }
    }
  }

  private setValidated(recordId: string, validated: boolean): void {
    const record = this.records.get(recordId);
    if (record) record.validated = validated;
  }

  /**
   * Walk the reported pid's parent chain (bounded) looking for the worker
   * pid or any pid of a validated record inside the worker's subtree.
   */
  private async isDescendantOfWorker(
    pid: number,
    worker: InternalRecord,
    workerPid: number
  ): Promise<boolean> {
    const trustedPids = new Set<number>([workerPid]);
    for (const record of this.records.values()) {
      if (
        !record.exited &&
        record.pid !== null &&
        record.validated &&
        record.parentRecordId === worker.id
      ) {
        trustedPids.add(record.pid);
      }
    }
    let current = pid;
    for (let depth = 0; depth < MAX_PARENT_CHAIN_DEPTH; depth += 1) {
      if (trustedPids.has(current)) return true;
      const parent = await this.ops.readParentPid(current);
      if (parent === null) return false;
      if (trustedPids.has(parent)) return true;
      current = parent;
    }
    return false;
  }

  private async captureIdentity(record: InternalRecord): Promise<void> {
    if (record.pid === null) return;
    try {
      const identity = await this.ops.readStartTimeIdentity(record.pid);
      record.startedAtIdentity = identity ?? `${FALLBACK_IDENTITY_PREFIX}${record.spawnTimestampMs}`;
    } catch {
      record.startedAtIdentity = `${FALLBACK_IDENTITY_PREFIX}${record.spawnTimestampMs}`;
    }
  }

  private view(record: InternalRecord): OwnedProcessRecordView {
    return {
      id: record.id,
      ownerId: record.ownerId,
      pid: record.pid,
      ownership: record.ownership,
      parentRecordId: record.parentRecordId,
      isolatedProcessGroupId: record.isolatedProcessGroupId,
      identityTracked:
        record.startedAtIdentity !== null &&
        !record.startedAtIdentity.startsWith(FALLBACK_IDENTITY_PREFIX),
      validated: record.validated,
      exited: record.exited,
    };
  }
}

// -----------------------------------------------------------------------------
// Main-process singleton (wired in background.ts with default process ops)
// -----------------------------------------------------------------------------

let registrySingleton: OwnedProcessRegistry | null = null;

export function getOwnedProcessRegistry(): OwnedProcessRegistry {
  if (!registrySingleton) {
    registrySingleton = new OwnedProcessRegistry(createDefaultProcessOps());
  }
  return registrySingleton;
}

/** Test-only: drop the singleton. */
export function resetOwnedProcessRegistryForTests(): void {
  registrySingleton = null;
}
