import { randomUUID } from "crypto";

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
  readonly onCancel: (handler: () => void) => void;
  readonly onProgress: (handler: (p: ToolJobProgress) => void) => void;
  readonly onPartial: (
    handler: (p: {
      data: unknown;
      collectedCount: number;
      expectedCount: number;
    }) => void
  ) => void;
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
}

interface InternalJob {
  jobId: string;
  toolName: string;
  conversationId: string;
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
  lastPolledAt: number;
  queuedSpawn?: () => void;
}

export class ToolJobRegistry {
  private jobs = new Map<string, InternalJob>();
  private queue: string[] = [];
  private running = 0;
  private readonly limits: ToolJobLimits;

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
    spawn: (handle: ToolJobSpawnHandle) => Promise<unknown>
  ): { jobId: string; queued: boolean } {
    const jobId = randomUUID();
    const job: InternalJob = {
      jobId,
      toolName,
      conversationId: ctx.conversationId,
      status: "queued",
      progress: null,
      partial: null,
      result: null,
      error: null,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: null,
      cancelHandlers: [],
      lastPolledAt: 0,
    };
    this.jobs.set(jobId, job);

    const handle: ToolJobSpawnHandle = {
      onCancel: (h) => job.cancelHandlers.push(h),
      onProgress: (h) => {
        (
          job as { _progressHandler?: (p: ToolJobProgress) => void }
        )._progressHandler = h;
      },
      onPartial: (h) => {
        (
          job as {
            _partialHandler?: (p: {
              data: unknown;
              collectedCount: number;
              expectedCount: number;
            }) => void;
          }
        )._partialHandler = h;
      },
      resolve: (result) => {
        if (job.status === "cancelled") return;
        job.status = "completed";
        job.result = result;
        job.completedAt = Date.now();
        job.updatedAt = Date.now();
        this.running--;
        this.drainQueue();
      },
      reject: (err) => {
        if (job.status === "cancelled") return;
        job.status = "failed";
        job.error = err.message;
        job.completedAt = Date.now();
        job.updatedAt = Date.now();
        this.running--;
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
    if (job) {
      job.progress = progress;
      job.updatedAt = Date.now();
    }
  }

  updatePartial(
    jobId: string,
    partial: { data: unknown; collectedCount: number; expectedCount: number }
  ): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.partial = partial;
      job.updatedAt = Date.now();
    }
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

  cancel(jobId: string): { cancelled: boolean; reason?: string } {
    const job = this.jobs.get(jobId);
    if (!job) return { cancelled: false, reason: "not_found" };
    if (job.status === "completed")
      return { cancelled: false, reason: "already_completed" };
    if (job.status === "cancelled")
      return { cancelled: false, reason: "already_cancelled" };
    const wasRunning = job.status === "running";
    const wasQueued = job.status === "queued";
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
      this.running--;
      this.drainQueue();
    } else if (wasQueued) {
      // Remove from queue if still queued
      const idx = this.queue.indexOf(jobId);
      if (idx >= 0) this.queue.splice(idx, 1);
    }
    return { cancelled: true };
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
        this.jobs.delete(id);
        count++;
      }
    }
    return count;
  }

  shutdown(): void {
    for (const job of this.jobs.values()) {
      if (job.status === "running" || job.status === "queued") {
        for (const h of job.cancelHandlers) {
          try {
            h();
          } catch {
            // ignore
          }
        }
        job.status = "cancelled";
        job.completedAt = Date.now();
      }
    }
    this.jobs.clear();
    this.queue = [];
    this.running = 0;
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
