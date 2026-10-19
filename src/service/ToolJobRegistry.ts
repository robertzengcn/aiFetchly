import { randomUUID } from "crypto";

/**
 * H5: how long a RUNNING job's admission lease survives after a cancel
 * request. The public status flips to `cancelled` immediately, but the
 * spawn continuation (MCP transport teardown → SIGTERM/SIGKILL of the
 * plugin process AND its browser group) is still unwinding until the
 * handle resolves/rejects. The lease is released when the continuation
 * exits, or at this grace deadline at the latest so a hung tool can never
 * wedge the concurrency budget.
 */
export const TOOL_JOB_SETTLE_GRACE_MS = 15_000;

/**
 * H5 (lifecycle): thrown by `start()` when admission is sealed for the
 * tool's plugin prefix (disable/uninstall/update in progress).
 */
export class AdmissionSealedError extends Error {
  readonly sealedBy: string;
  constructor(toolName: string, sealedBy: string) {
    super(
      `${toolName} refused while "${sealedBy}" seals admission (plugin lifecycle operation in progress)`
    );
    this.name = "AdmissionSealedError";
    this.sealedBy = sealedBy;
  }
}

export type ToolJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "not_found"
  | "rate_limited";

export type ToolProgressPhase =
  | "queued"
  | "running"
  | "fetching"
  | "extracting"
  | "finalizing";

export interface ToolJobProgress {
  readonly phase: ToolProgressPhase;
  readonly message: string;
  readonly progress: number | null;
  readonly partialCount: number | null;
  readonly expectedCount: number | null;
}

export interface ToolJobSnapshot {
  readonly jobId: string;
  readonly toolName: string;
  readonly conversationId: string;
  readonly status: ToolJobStatus;
  readonly progress: ToolJobProgress | null;
  readonly partial: {
    data: unknown;
    collectedCount: number;
    expectedCount: number;
  } | null;
  readonly result: unknown;
  readonly error: string | null;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly completedAt: number | null;
  readonly retryAfterMs?: number;
}

export interface ToolJobLimits {
  readonly maxConcurrent: number;
  readonly staleAfterMs: number;
  readonly pollMinIntervalMs: number;
}

export interface ToolJobSpawnHandle {
  /**
   * The registry-assigned job id, available INSIDE the spawn callback
   * (design §7.1: the registry may invoke the callback before start()
   * returns, so the id must be carried on the handle rather than captured
   * from the return value).
   */
  readonly jobId: string;
  readonly onCancel: (handler: () => void) => void;
  /**
   * Register a settlement callback fired exactly once when the job reaches a
   * terminal state AND the underlying work has quiesced (design §7.3).
   * Unlike the synchronous onCancel handlers (cancellation REQUEST), this
   * hook runs after the terminal transition so cleanup continuations can
   * release admission leases or report cleanup completion.
   */
  readonly onSettled: (handler: () => void) => void;
  /**
   * Registry-owned abort signal for this job. `cancel()` and `shutdown()`
   * abort it so the underlying tool work is actually asked to stop — a job
   * labelled `cancelled` must never keep consuming model/tool resources
   * invisibly (message-queue technical design §17.1).
   */
  readonly signal: AbortSignal;
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
}

interface InternalJob {
  jobId: string;
  toolName: string;
  conversationId: string;
  /** Optional canonical duplicate-suppression fingerprint (HOST-10). */
  fingerprint?: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: ToolJobProgress | null;
  partial: {
    data: unknown;
    collectedCount: number;
    expectedCount: number;
  } | null;
  result: unknown;
  error: string | null;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
  cancelHandlers: Array<() => void>;
  settledCallbacks: Array<() => void>;
  settled: boolean;
  lastPolledAt: number;
  queuedSpawn?: () => void;
  abortController: AbortController;
  /** Timer that force-releases the admission lease after a cancel (H5). */
  settleTimer?: NodeJS.Timeout;
  /**
   * B04: set when the cancel grace window lapsed WITHOUT proof of process
   * cleanup (the spawn continuation was still pending). A quarantined job
   * retains its admission lease (blocked replacement/admission) until the
   * continuation finally exits and quiescence is proven — or until stale
   * eviction. Never silently "declares" cleanup complete after a timeout.
   */
  quarantined?: boolean;
  /**
   * B04: explicit cleanup result for cancelled jobs — "clean" when
   * quiescence was proven before the grace window, "grace-lapsed" when the
   * settle window lapsed without proof, null when not applicable.
   */
  cleanupOutcome?: "clean" | "grace-lapsed" | null;
}

export class ToolJobRegistry {
  private jobs = new Map<string, InternalJob>();
  private queue: string[] = [];
  private running = 0;
  private closed = false;
  private readonly limits: ToolJobLimits;
  /**
   * H5 (lifecycle): sealed tool-name prefixes refuse admission (disable,
   * uninstall, update). Sealing prevents the next browser start while the
   * plugin's current jobs are still being torn down and their files staged.
   */
  private admissionSeals = new Set<string>();

  constructor(limits?: Partial<ToolJobLimits>) {
    this.limits = {
      maxConcurrent: limits?.maxConcurrent ?? 4,
      staleAfterMs: limits?.staleAfterMs ?? 5 * 60_000,
      pollMinIntervalMs: limits?.pollMinIntervalMs ?? 5_000,
    };
  }

  start(
    toolName: string,
    _args: Record<string, unknown>,
    ctx: { conversationId: string; toolCallId: string },
    spawn: (handle: ToolJobSpawnHandle) => Promise<unknown>,
    options?: { readonly fingerprint?: string }
  ): { jobId: string; queued: boolean } {
    if (this.closed) {
      // T06/AC-05: no job may be admitted after shutdown seals the registry.
      throw new Error(
        "ToolJobRegistry is closed (application shutting down); job refused"
      );
    }
    const sealedBy = this.admissionSealedByPrefix(toolName);
    if (sealedBy !== null) {
      throw new AdmissionSealedError(toolName, sealedBy);
    }
    const jobId = randomUUID();
    // One AbortController per job. Aborting is the authoritative cancellation
    // request for the underlying tool work; the handlers below only relabel
    // the registry entry (technical design §17.1).
    const abortController = new AbortController();
    const job: InternalJob = {
      jobId,
      toolName,
      conversationId: ctx.conversationId,
      fingerprint: options?.fingerprint,
      status: "queued",
      progress: null,
      partial: null,
      result: null,
      error: null,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: null,
      cancelHandlers: [],
      settledCallbacks: [],
      settled: false,
      lastPolledAt: 0,
      abortController,
      quarantined: false,
      cleanupOutcome: null,
    };
    this.jobs.set(jobId, job);

    const handle: ToolJobSpawnHandle = {
      jobId,
      onCancel: (h) => job.cancelHandlers.push(h),
      onSettled: (h) => {
        if (job.settled) {
          // Already terminal — fire immediately (late registration).
          try {
            h();
          } catch {
            /* best-effort */
          }
          return;
        }
        job.settledCallbacks.push(h);
      },
      signal: abortController.signal,
      resolve: (result) => {
        // B04: idempotent settlement — a duplicate resolve must NOT change
        // the recorded result or release capacity a second time.
        if (job.settled) return;
        if (job.status === "cancelled") {
          // H5/B04: a cancelled job whose spawn continuation finally exited —
          // THIS is the moment cleanup has quiesced. The deferred grace timer
          // becomes unnecessary; release the admission lease exactly once.
          this.finishSettling(job);
          return;
        }
        job.status = "completed";
        job.result = result;
        job.completedAt = Date.now();
        job.updatedAt = Date.now();
        this.running--;
        this.markSettled(job);
        this.drainQueue();
      },
      reject: (err) => {
        // B04: resolve-then-reject leaves the settled result and capacity
        // untouched — the first terminal transition always wins.
        if (job.settled) return;
        if (job.status === "cancelled") {
          // Same quiesced-cleanup release as the resolve path above.
          this.finishSettling(job);
          return;
        }
        job.status = "failed";
        job.error = err.message;
        job.completedAt = Date.now();
        job.updatedAt = Date.now();
        this.running--;
        this.markSettled(job);
        this.drainQueue();
      },
    };

    if (this.running >= this.limits.maxConcurrent) {
      this.queue.push(jobId);
      job.queuedSpawn = () => this.runSpawn(job, handle, spawn);
      return { jobId, queued: true };
    }

    this.runSpawn(job, handle, spawn);
    return { jobId, queued: false };
  }

  private runSpawn(
    job: InternalJob,
    handle: ToolJobSpawnHandle,
    spawn: (handle: ToolJobSpawnHandle) => Promise<unknown>
  ): void {
    job.status = "running";
    job.updatedAt = Date.now();
    this.running++;
    spawn(handle).catch((err) =>
      handle.reject(err instanceof Error ? err : new Error(String(err)))
    );
  }

  private drainQueue(): void {
    while (this.running < this.limits.maxConcurrent && this.queue.length > 0) {
      const nextId = this.queue.shift();
      if (nextId === undefined) break;
      const next = this.jobs.get(nextId);
      if (!next) continue;
      if (next.queuedSpawn) {
        next.queuedSpawn();
        next.queuedSpawn = undefined;
      }
    }
  }

  updateProgress(jobId: string, progress: ToolJobProgress): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    // B04: late updates must never mutate a settled/terminal snapshot.
    if (
      job.settled ||
      job.status === "completed" ||
      job.status === "failed"
    ) {
      return;
    }
    job.progress = progress;
    job.updatedAt = Date.now();
  }

  updatePartial(
    jobId: string,
    partial: { data: unknown; collectedCount: number; expectedCount: number }
  ): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    // B04: same terminal guard as updateProgress — partials of settled jobs
    // are immutable snapshots.
    if (
      job.settled ||
      job.status === "completed" ||
      job.status === "failed"
    ) {
      return;
    }
    job.partial = partial;
    job.updatedAt = Date.now();
  }

  /**
   * H5: live-or-unwinding probe for a specific job id — used by the
   * plugin-partial gate to refuse snapshots for terminal jobs without
   * touching `getStatus` (which affects rate-limit accounting).
   */
  isJobActive(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    return (
      job.status === "queued" ||
      job.status === "running" ||
      (job.status === "cancelled" && !job.settled)
    );
  }

  getStatus(jobId: string): ToolJobSnapshot {
    const job = this.jobs.get(jobId);
    if (!job) return this.notFound(jobId);
    const now = Date.now();
    if (
      job.status === "running" &&
      job.lastPolledAt > 0 &&
      now - job.lastPolledAt < this.limits.pollMinIntervalMs
    ) {
      return {
        jobId,
        toolName: job.toolName,
        conversationId: job.conversationId,
        status: "rate_limited",
        progress: null,
        partial: null,
        result: null,
        error: null,
        startedAt: job.startedAt,
        updatedAt: job.updatedAt,
        completedAt: null,
        retryAfterMs: this.limits.pollMinIntervalMs - (now - job.lastPolledAt),
      };
    }
    job.lastPolledAt = now;
    return this.snapshot(job);
  }

  getStatusForConversation(
    jobId: string,
    conversationId: string
  ): ToolJobSnapshot {
    const job = this.jobs.get(jobId);
    if (!job || job.conversationId !== conversationId)
      return this.notFound(jobId);
    return this.getStatus(jobId);
  }

  /**
   * Find a queued/running job with the given duplicate-suppression
   * fingerprint in this conversation (HOST-10). Returns the jobId so the
   * caller can return a structured JOB_ALREADY_RUNNING outcome bound to the
   * caller's own toolCallId instead of starting a second live job.
   *
   * H5: cancelled-but-still-tearing-down jobs also block admission — the
   * settlement flag is deferred until the spawn continuation exits, so a
   * second browser cannot start while the first is being reaped.
   */
  findActiveJobByFingerprint(
    conversationId: string,
    fingerprint: string
  ): { jobId: string } | null {
    for (const job of this.jobs.values()) {
      const stillUnwinding =
        job.status === "cancelled" && !job.settled;
      if (
        job.conversationId === conversationId &&
        job.fingerprint === fingerprint &&
        (job.status === "queued" ||
          job.status === "running" ||
          stillUnwinding)
      ) {
        return { jobId: job.jobId };
      }
    }
    return null;
  }

  cancel(jobId: string): { cancelled: boolean; reason?: string } {
    const job = this.jobs.get(jobId);
    if (!job) return { cancelled: false, reason: "not_found" };
    if (job.status === "completed")
      return { cancelled: false, reason: "already_completed" };
    if (job.status === "cancelled")
      return { cancelled: false, reason: "already_cancelled" };
    const wasRunning = job.status === "running";
    const wasQueued = job.status === "queued";
    // Request real cancellation of the underlying work BEFORE relabelling the
    // job. Non-cooperative tools may take time to unwind, but the request must
    // go out (truthful Stop, technical design §17.1).
    job.abortController.abort();
    for (const h of job.cancelHandlers) {
      try {
        h();
      } catch {
        // Best-effort cancellation.
      }
    }
    job.status = "cancelled";
    job.completedAt = Date.now();
    job.updatedAt = Date.now();
    if (wasRunning) {
      // H5 (admission lease): do NOT settle here. The spawn continuation is
      // still tearing the plugin process and its browser group down; the
      // lease (this.running slot + duplicate-suppression fingerprint) is
      // held until the continuation exits or the grace window lapses.
      this.beginDeferredSettle(job);
    } else if (wasQueued) {
      // Remove from queue if still queued
      const idx = this.queue.indexOf(jobId);
      if (idx >= 0) this.queue.splice(idx, 1);
      this.markSettled(job);
    }
    return { cancelled: true };
  }

  /**
   * H5: schedule the deferred settlement for a cancelled RUNNING job. The
   * admission lease is released by `finishSettling` either when the spawn
   * continuation exits (resolve/reject early paths) or when this grace
   * timer lapses — whichever is first.
   */
  private beginDeferredSettle(job: InternalJob): void {
    if (job.settled || job.settleTimer) return;
    const timer = setTimeout(() => {
      job.settleTimer = undefined;
      // B04: the grace window lapsed WITHOUT proof that the spawn
      // continuation (process/browser teardown) finished. Never silently
      // release ownership or report success here — quarantine the job so
      // replacement/admission stays blocked (fingerprint + capacity slot)
      // and surface an explicit cleanup failure via getCleanupOutcome.
      this.quarantine(job);
    }, TOOL_JOB_SETTLE_GRACE_MS);
    // Never keep the event loop alive just for lease accounting.
    timer.unref?.();
    job.settleTimer = timer;
  }

  /**
   * B04: quarantine a cancelled job whose cleanup did not quiesce within
   * the grace window. Ownership (capacity slot + duplicate-suppression
   * fingerprint) is RETAINED; settled callbacks are NOT fired; the job
   * continues reporting as active/unwinding. If the stray continuation
   * eventually exits, the normal resolve/reject path releases ownership
   * (the cleanup-failure verdict stands in getCleanupOutcome).
   */
  private quarantine(job: InternalJob): void {
    if (job.settled || job.quarantined) return;
    job.quarantined = true;
    job.cleanupOutcome = "grace-lapsed";
  }

  /**
   * H5/B04: release a cancelled job's admission lease exactly once — clear
   * the pending grace timer, mark settled, fire callbacks, free the slot,
   * drain. Called only when cleanup quiescence has actually been observed
   * (the spawn continuation exited). A grace-lapsed quarantine is a
   * separate, explicit failure state — never routed here silently.
   */
  private finishSettling(job: InternalJob): void {
    if (job.settled) return;
    if (job.settleTimer) {
      clearTimeout(job.settleTimer);
      job.settleTimer = undefined;
    }
    if (job.cleanupOutcome === null) job.cleanupOutcome = "clean";
    this.running--;
    this.markSettled(job);
    this.drainQueue();
  }

  /** Fire settled callbacks exactly once for a terminal job. */
  private markSettled(job: InternalJob): void {
    if (job.settled) return;
    job.settled = true;
    for (const cb of job.settledCallbacks.splice(0)) {
      try {
        cb();
      } catch {
        /* best-effort settlement */
      }
    }
  }

  /**
   * Wait (bounded) for a job to reach a terminal state (design §7.3
   * cleanup completion). Resolves true once terminal, false on timeout or
   * when the job is unknown. Used by the poll loop to await bounded cleanup
   * after deadline-expiry cancellation instead of returning while the
   * browser/plugin process may still be unwinding (PRD §11.8).
   */
  async waitForSettled(jobId: string, timeoutMs: number): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.settled) return true;
    return new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (value: boolean): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        const index = job.settledCallbacks.indexOf(settleHook);
        if (index >= 0) job.settledCallbacks.splice(index, 1);
        finish(job.settled);
      }, timeoutMs);
      const settleHook = (): void => finish(true);
      job.settledCallbacks.push(settleHook);
    });
  }

  evictStale(): number {
    const now = Date.now();
    let count = 0;
    for (const [id, job] of this.jobs) {
      const terminal =
        job.status === "completed" ||
        job.status === "failed" ||
        job.status === "cancelled";
      if (terminal && now - job.updatedAt > this.limits.staleAfterMs) {
        // B04: a quarantined job retained its capacity slot (cleanup never
        // proved quiescent). Eviction is the last-resort release for that
        // leak so a hung tool cannot clutter the budget forever — the
        // cleanup-failure verdict stays with the record prior to removal.
        if (job.quarantined && !job.settled) this.running--;
        this.jobs.delete(id);
        count++;
      }
    }
    return count;
  }

  /**
   * B04: explicit cleanup outcome for a terminal-or-unwinding job.
   *   "clean"        — quiescence proved within the settle grace window.
   *   "grace-lapsed" — the grace window expired while the spawn
   *                    continuation was still pending: cleanup is NOT
   *                    proven; lifecycle callers must refuse destructive
   *                    follow-ups (file deletion/replacement).
   *   null           — no cleanup result yet (active work / normal paths).
   */
  getCleanupOutcome(
    jobId: string
  ): "clean" | "grace-lapsed" | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return job.cleanupOutcome ?? null;
  }

  /**
   * Trustworthy count of currently RUNNING async tool jobs (queued jobs are
   * not yet active work). Feeds the application close dialog's localized
   * active-task message (application-exit PRD FR-01: omit rather than report
   * an untrustworthy count).
   */
  getActiveJobCount(): number {
    let running = 0;
    for (const job of this.jobs.values()) {
      if (job.status === "running") {
        running += 1;
      }
    }
    return running;
  }

  /**
   * H5 (lifecycle): refuse admission for tools under the given prefix.
   * Callers (disable/uninstall/update) seal admission BEFORE aborting the
   * plugin's active jobs so a new browser can never start behind them.
   */
  sealAdmission(prefix: string): void {
    this.admissionSeals.add(prefix);
  }

  releaseAdmissionSeal(prefix: string): void {
    this.admissionSeals.delete(prefix);
  }

  /** The sealed-by prefix naming `toolName`'s plugin, or null when open. */
  private admissionSealedByPrefix(toolName: string): string | null {
    for (const prefix of this.admissionSeals) {
      if (toolName.startsWith(prefix)) return prefix;
    }
    return null;
  }

  /**
   * H5 (lifecycle): live-or-unwinding job ids whose tool name starts with
   * the prefix. Used by disable/uninstall flows to enumerate exactly the
   * jobs they must abort and then await.
   */
  listActiveJobIdsByToolPrefix(prefix: string): string[] {
    const out: string[] = [];
    for (const [id, job] of this.jobs) {
      const active =
        job.status === "queued" ||
        job.status === "running" ||
        (job.status === "cancelled" && !job.settled);
      if (active && job.toolName.startsWith(prefix)) out.push(id);
    }
    return out;
  }

  shutdown(): void {
    // T06/AC-05: seal the registry — start() refuses new jobs after this.
    // H5: active jobs are aborted and labelled cancelled now, but their
    // admission leases ride the deferred settlement path so a caller that
    // awaits cleanup can observe actual quiescence (see
    // shutdownAndAwaitCleanup). State is NOT cleared here: cleared only in
    // shutdownAndAwaitCleanup after the bounded cleanup wait.
    this.closed = true;
    this.freezeActiveJobs();
  }

  /**
   * H5 (lifecycle): shutdown + bounded cleanup await. Aborts every active
   * job (signals, cancellation requests), then waits up to `graceMs` total
   * for the spawn continuations to quiesce before clearing state. Callers
   * stop paying attention after the grace period regardless (the
   * continuation timers are unref'd, so a hung tool cannot block exit).
   */
  async shutdownAndAwaitCleanup(graceMs: number): Promise<void> {
    this.closed = true;
    const touched = this.freezeActiveJobs();
    await this.waitForAllSettled(graceMs, touched);
    this.jobs.clear();
    this.queue = [];
    this.running = 0;
  }

  /**
   * H5 (lifecycle): abort AND bounded-await a specific set of jobs without
   * sealing the whole registry or clearing state — plugin
   * disable/uninstall/update flows await their own child teardown before
   * removing binaries and files.
   */
  async abortAndAwaitJobs(
    jobIds: readonly string[],
    graceMs: number
  ): Promise<void> {
    const touched = this.freezeJobsById(jobIds);
    await this.waitForAllSettled(graceMs, touched);
  }

  /** Abort + relabel every active (queued/running) job without clearing. */
  private freezeActiveJobs(): string[] {
    const ids: string[] = [];
    for (const [id, job] of this.jobs) {
      if (job.status === "running" || job.status === "queued") ids.push(id);
    }
    this.queue = [];
    return this.freezeJobsById(ids);
  }

  /** Abort + relabel the given active jobs (H5 lifecycle targeting). */
  private freezeJobsById(ids: readonly string[]): string[] {
    const touched: string[] = [];
    for (const id of ids) {
      const job = this.jobs.get(id);
      if (!job) continue;
      if (job.status !== "running" && job.status !== "queued") continue;
      const wasRunning = job.status === "running";
      job.abortController.abort();
      for (const h of job.cancelHandlers) {
        try {
          h();
        } catch {
          // ignore
        }
      }
      job.status = "cancelled";
      job.completedAt = Date.now();
      if (wasRunning) {
        // H5: keep the admission lease until the spawn continuation exits
        // (or the grace window lapses) so cleanup is observable by callers.
        this.beginDeferredSettle(job);
      } else {
        // Queued jobs never started work: nothing to unwind.
        this.markSettled(job);
      }
      touched.push(id);
    }
    return touched;
  }

  private async waitForAllSettled(
    graceMs: number,
    ids: readonly string[]
  ): Promise<void> {
    const deadline = Date.now() + graceMs;
    for (const id of ids) {
      const remaining = Math.max(0, deadline - Date.now());
      if (remaining <= 0) break;
      await this.waitForSettled(id, remaining);
    }
  }

  /** True once shutdown() sealed the registry — start() refuses new jobs (T06). */
  isClosed(): boolean {
    return this.closed;
  }

  private snapshot(job: InternalJob): ToolJobSnapshot {
    return {
      jobId: job.jobId,
      toolName: job.toolName,
      conversationId: job.conversationId,
      status: job.status,
      progress: job.progress,
      partial: job.partial,
      result: job.result,
      error: job.error,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
    };
  }

  private notFound(jobId: string): ToolJobSnapshot {
    return {
      jobId,
      toolName: "",
      conversationId: "",
      status: "not_found",
      progress: null,
      partial: null,
      result: null,
      error: null,
      startedAt: 0,
      updatedAt: 0,
      completedAt: null,
    };
  }
}

let defaultRegistry: ToolJobRegistry | undefined;

export function getDefaultToolJobRegistry(): ToolJobRegistry {
  if (!defaultRegistry) defaultRegistry = new ToolJobRegistry();
  return defaultRegistry;
}

export function setDefaultToolJobRegistry(reg: ToolJobRegistry): void {
  defaultRegistry = reg;
}
