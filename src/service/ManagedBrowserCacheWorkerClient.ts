import { ownedSpawnAllowed, registerOwnedProcess } from "@/main-process/lifecycle/ownedSpawn";
import * as fs from "fs";
import * as path from "path";
import { log } from "@/modules/Logger";
import type { UtilityProcessLike } from "@/service/ManagedBrowserWorkerClient";
import type {
  CacheDeleteOutcome,
  CacheMaintenanceClient,
  CacheScanOutcome,
} from "@/modules/ManagedBrowserCacheModule";
import {
  managedBrowserCacheOutboundSchema,
  type ManagedBrowserCacheInboundMessage,
  type ManagedBrowserCacheOutboundMessage,
} from "@/schemas/worker/managedBrowserCache";
import {
  MANAGED_BROWSER_CACHE_MAINTENANCE_TIMEOUTS as T,
  MANAGED_BROWSER_MESSAGE_LIMITS,
} from "@/config/managedBrowser";
import {
  getPackagedWorkerPathCandidates,
  resolvePackagedWorkerPath,
  type PackagedWorkerPathRuntime,
  buildPackagedWorkerEnv,
} from "@/utils/packagedWorkerPath";

/**
 * Cache maintenance worker client (technical design §13.9).
 *
 * SHARED SINGLETON — one process-wide handle to the maintenance utility
 * process, forked on demand. Unlike the session worker client this one is
 * RETRYABLE: a worker crash rejects in-flight requests with a safe error
 * (the deletion queue survives on disk, so the main-process module simply
 * re-drives it) and the next operation transparently re-forks.
 *
 * Logs never contain paths, filenames, or URLs — request ids and reason
 * codes only (design §13.4).
 */

export interface CacheWorkerClientDeps {
  readonly fork?: (
    entryPath: string,
    args: readonly string[]
  ) => UtilityProcessLike;
  readonly resolveEntryPath?: () => string;
  readonly now?: () => number;
}

interface PendingRequest {
  readonly requestId: string;
  resolve: (message: ManagedBrowserCacheOutboundMessage) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  readonly accept: (message: ManagedBrowserCacheOutboundMessage) => boolean;
}

/** WORKER_READY waiters (one per fork). */
interface ReadyWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/** Generic distributive Omit (Omit alone collapses unions). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** Request envelope: an inbound message minus the client-managed envelope. */
export type CacheWorkerRequestEnvelope = DistributiveOmit<
  ManagedBrowserCacheInboundMessage,
  "protocolVersion" | "requestId" | "sequence"
>;

export class ManagedBrowserCacheWorkerClient
  implements CacheMaintenanceClient
{
  private readonly fork: (entryPath: string, args: readonly string[]) => UtilityProcessLike;
  private readonly resolveEntryPath: () => string;
  private readonly now: () => number;

  private worker: UtilityProcessLike | null = null;
  private dead = true; // nothing forked yet
  private starting: Promise<void> | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly readyWaiters: ReadyWaiter[] = [];
  private lastSequence = 0;
  private malformedCount = 0;
  private sequence = 0;
  private requestIdCounter = 0;

  public constructor(deps: CacheWorkerClientDeps = {}) {
    this.fork = deps.fork ?? defaultCacheWorkerFork;
    this.resolveEntryPath =
      deps.resolveEntryPath ?? resolveCacheWorkerEntryPath;
    this.now = deps.now ?? Date.now;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Fork-on-demand: reuses the live worker or forks a fresh one. */
  public async ensureStarted(): Promise<void> {
    if (this.worker && !this.dead) {
      return;
    }
    if (this.starting) {
      return this.starting;
    }
    this.starting = this.forkAndAwaitReady().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async forkAndAwaitReady(): Promise<void> {
    this.dead = false;
    this.lastSequence = 0;
    this.malformedCount = 0;
    const worker = this.fork(this.resolveEntryPath(), []);
    this.worker = worker;
    worker.on("message", (raw) => this.handleMessage(raw));
    worker.on("exit", (code) => this.handleExit(code ?? "unknown"));
    worker.on("error", (error) => {
      log.warn(
        `[ManagedBrowserCacheWorkerClient] worker error: ${
          error instanceof Error ? error.name : "unknown"
        }`
      );
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.readyWaiters.findIndex((w) => w.resolve === resolve);
        if (index >= 0) {
          this.readyWaiters.splice(index, 1);
        }
        reject(new Error("worker_start_timeout"));
      }, T.workerStartMs);
      this.readyWaiters.push({ resolve, reject, timeout });
    });
  }

  // -----------------------------------------------------------------------
  // CacheMaintenanceClient surface (module contract)
  // -----------------------------------------------------------------------

  public async scanScope(input: {
    readonly scopePath: string;
  }): Promise<CacheScanOutcome> {
    return this.runOutcome(async () => {
      const reply = await this.request(
        {
          type: "SCAN_SCOPE",
          managedRoot: path.dirname(input.scopePath),
          scopePath: input.scopePath,
        },
        T.scanScopeMs,
        (m) => m.type === "SCAN_SCOPE_RESULT"
      );
      if (reply.type !== "SCAN_SCOPE_RESULT") {
        throw new Error("internal_error");
      }
      return reply.result.status === "ok"
        ? {
            status: "ok" as const,
            approximateBytes: reply.result.approximateBytes,
          }
        : { status: "error" as const, reasonCode: reply.result.reasonCode };
    });
  }

  public async deleteQueuedScope(input: {
    readonly queuePath: string;
  }): Promise<CacheDeleteOutcome> {
    return this.runOutcome(async () => {
      const reply = await this.request(
        {
          type: "DELETE_QUEUED_SCOPE",
          managedRoot: path.dirname(path.dirname(input.queuePath)),
          queuePath: input.queuePath,
        },
        T.deleteQueuedScopeMs,
        (m) => m.type === "DELETE_QUEUED_SCOPE_RESULT"
      );
      if (reply.type !== "DELETE_QUEUED_SCOPE_RESULT") {
        throw new Error("internal_error");
      }
      return reply.result.status === "ok"
        ? {
            status: "ok" as const,
            approximateDeletedBytes: reply.result.approximateDeletedBytes,
          }
        : { status: "error" as const, reasonCode: reply.result.reasonCode };
    });
  }

  /** Whole-root bounded scan (maintenance scheduler surface). */
  public async scanAll(input: {
    readonly managedRoot: string;
  }): Promise<
    | {
        status: "ok";
        scopes: ReadonlyArray<{
          scopeToken: string;
          approximateBytes: number;
          fileCount: number;
          lastModifiedEpochMs: number;
        }>;
        truncated: boolean;
      }
    | { status: "error"; reasonCode: string }
  > {
    return this.runOutcome(async () => {
      const reply = await this.request(
        { type: "SCAN_ALL", managedRoot: input.managedRoot },
        T.scanAllMs,
        (m) => m.type === "SCAN_ALL_RESULT"
      );
      if (reply.type !== "SCAN_ALL_RESULT") {
        throw new Error("internal_error");
      }
      return reply.result.status === "ok"
        ? {
            status: "ok" as const,
            scopes: reply.result.scopes.map((s) => ({ ...s })),
            truncated: reply.result.truncated,
          }
        : { status: "error" as const, reasonCode: reply.result.reasonCode };
    });
  }

  /** Two-phase eviction planning (§13.9). */
  public async planEviction(input: {
    readonly managedRoot: string;
    readonly maxTotalBytes: number;
    readonly perScopeTargetBytes: number;
    readonly inactiveRetentionDays: number;
    readonly activeScopeTokens: readonly string[];
  }): Promise<
    | {
        status: "ok";
        planId: string;
        plannedBytes: number;
        entries: ReadonlyArray<{ scopeToken: string }>;
      }
    | { status: "error"; reasonCode: string }
  > {
    return this.runOutcome(async () => {
      const reply = await this.request(
        { type: "PLAN_EVICTION", ...input, activeScopeTokens: [...input.activeScopeTokens] },
        T.planEvictionMs,
        (m) => m.type === "PLAN_EVICTION_RESULT"
      );
      if (reply.type !== "PLAN_EVICTION_RESULT") {
        throw new Error("internal_error");
      }
      return reply.result.status === "ok"
        ? {
            status: "ok" as const,
            planId: reply.result.planId,
            plannedBytes: reply.result.plannedBytes,
            entries: reply.result.entries.map((e) => ({ ...e })),
          }
        : { status: "error" as const, reasonCode: reply.result.reasonCode };
    });
  }

  /** Cancel a plan before main executes the renames. */
  public async cancelBeforeDelete(input: {
    readonly planId: string;
  }): Promise<{ status: "ok"; cancelled: boolean } | { status: "error"; reasonCode: string }> {
    return this.runOutcome(async () => {
      const reply = await this.request(
        { type: "CANCEL_BEFORE_DELETE", planId: input.planId },
        T.cancelBeforeDeleteMs,
        (m) => m.type === "CANCEL_BEFORE_DELETE_RESULT"
      );
      if (reply.type !== "CANCEL_BEFORE_DELETE_RESULT") {
        throw new Error("internal_error");
      }
      return reply.result.status === "ok"
        ? { status: "ok" as const, cancelled: reply.result.cancelled }
        : { status: "error" as const, reasonCode: reply.result.reasonCode };
    });
  }

  public async shutdown(): Promise<void> {
    if (!this.worker || this.dead) {
      return;
    }
    try {
      await this.request(
        { type: "SHUTDOWN" },
        T.shutdownMs,
        (m) => m.type === "SHUTDOWN_ACK"
      );
    } catch {
      // Graceful window expired — fall through to the forced kill.
    }
    await this.kill();
  }

  // -----------------------------------------------------------------------
  // Request plumbing
  // -----------------------------------------------------------------------

  private async request(
    message: CacheWorkerRequestEnvelope,
    timeoutMs: number,
    accept: (message: ManagedBrowserCacheOutboundMessage) => boolean
  ): Promise<ManagedBrowserCacheOutboundMessage> {
    await this.ensureStarted();
    const worker = this.worker;
    if (!worker) {
      throw new Error("cache_maintenance_unavailable");
    }
    this.requestIdCounter += 1;
    const requestId = `req-cache-${this.requestIdCounter}`;
    this.sequence += 1;
    const full = {
      protocolVersion: 1,
      requestId,
      sequence: this.sequence,
      ...message,
    } as unknown as ManagedBrowserCacheInboundMessage;

    return new Promise<ManagedBrowserCacheOutboundMessage>(
      (resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pending.delete(requestId);
          reject(new Error("worker_request_timeout"));
        }, timeoutMs);
        this.pending.set(requestId, {
          requestId,
          resolve,
          reject,
          timeout,
          accept,
        });
        try {
          worker.postMessage(JSON.stringify(full));
        } catch (error) {
          clearTimeout(timeout);
          this.pending.delete(requestId);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    );
  }

  /** Convert any transport failure into the module's safe error outcome. */
  private async runOutcome<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (error) {
      // Our own Error messages are safe codes/timeouts; log the code only.
      log.warn(
        `[ManagedBrowserCacheWorkerClient] maintenance op failed: ${
          error instanceof Error ? error.message : "unknown"
        }`
      );
      return {
        status: "error",
        reasonCode: "cache_maintenance_unavailable",
      } as unknown as T;
    }
  }

  private handleMessage(raw: unknown): void {
    const parsed =
      typeof raw === "string" ? safeJsonParse(raw) : (raw as unknown);
    const validated = managedBrowserCacheOutboundSchema().safeParse(parsed);
    if (!validated.success) {
      this.malformedCount++;
      log.warn(
        `[ManagedBrowserCacheWorkerClient] dropped malformed outbound message (${this.malformedCount})`
      );
      if (
        this.malformedCount >=
        MANAGED_BROWSER_MESSAGE_LIMITS.maxMalformedMessages
      ) {
        void this.kill("worker_protocol_violation");
      }
      return;
    }
    const message = validated.data as ManagedBrowserCacheOutboundMessage;

    if (
      typeof message.sequence === "number" &&
      message.sequence <= this.lastSequence
    ) {
      return; // stale/replayed sequence
    }
    this.lastSequence =
      typeof message.sequence === "number"
        ? message.sequence
        : this.lastSequence;

    if (message.type === "WORKER_READY") {
      for (const waiter of this.readyWaiters.splice(0)) {
        clearTimeout(waiter.timeout);
        waiter.resolve();
      }
      return;
    }

    const pending =
      "requestId" in message ? this.pending.get(message.requestId) : undefined;
    if (!pending) {
      return; // unsolicited — nothing to do for this client
    }
    if (message.type === "WORKER_ERROR") {
      clearTimeout(pending.timeout);
      this.pending.delete(pending.requestId);
      pending.reject(new Error(message.code));
      return;
    }
    if (pending.accept(message)) {
      clearTimeout(pending.timeout);
      this.pending.delete(pending.requestId);
      pending.resolve(message);
    }
  }

  private handleExit(code: number | string): void {
    // Retryable crash: reject in-flight work, mark dead — the next
    // operation re-forks. Queue entries on disk are untouched.
    this.markDead(`exit:${code}`);
  }

  private markDead(cause: string): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("worker_exited"));
    }
    this.pending.clear();
    for (const waiter of this.readyWaiters.splice(0)) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error("worker_exited"));
    }
    this.worker = null;
    this.dead = true;
    log.warn(
      `[ManagedBrowserCacheWorkerClient] worker gone (${cause}); next op re-forks`
    );
  }

  private async kill(cause = "shutdown"): Promise<void> {
    const worker = this.worker;
    this.markDead(cause);
    if (worker) {
      try {
        worker.kill();
      } catch {
        /* already gone */
      }
    }
  }
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return null;
  }
}

function defaultCacheWorkerFork(
  entryPath: string,
  args: readonly string[]
): UtilityProcessLike {
  // Lazy require: keeps this module importable in test contexts.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const electron = require("electron") as {
    utilityProcess: {
      fork: (
        path: string,
        args: readonly string[],
        options?: { stdio: "pipe" | "ignore"; env?: Record<string, string> }
      ) => UtilityProcessLike;
    };
  };
  if (!ownedSpawnAllowed("managed-browser-cache-worker")) {
    throw new Error("Application is shutting down; refusing worker start");
  }
  const proc = electron.utilityProcess.fork(entryPath, [...args], {
    stdio: "pipe",
    env: buildPackagedWorkerEnv() as Record<string, string>,
  });
  registerOwnedProcess("managed-browser-cache-worker", proc);
  return proc;
}

/** Resolve the packaged/dev cache worker entry (ManagedBrowserCacheWorker.js). */
export function resolveCacheWorkerEntryPath(): string {
  const electronProcess = process as NodeJS.Process & {
    resourcesPath?: string;
  };
  const runtime: PackagedWorkerPathRuntime = {
    dirname: __dirname,
    cwd: process.cwd(),
    resourcesPath: electronProcess.resourcesPath,
    existsSync: fs.existsSync,
  };
  const options = {
    dirnameRelativePaths: [
      "ManagedBrowserCacheWorker.js",
      path.join("childprocess", "ManagedBrowserCacheWorker.js"),
      path.join("..", "childprocess", "ManagedBrowserCacheWorker.js"),
    ],
    cwdRelativePaths: [
      path.join("dist", "childprocess", "ManagedBrowserCacheWorker.js"),
      path.join(".vite", "build", "ManagedBrowserCacheWorker.js"),
    ],
  };
  const resolved = resolvePackagedWorkerPath(runtime, options);
  if (resolved) {
    return resolved;
  }
  throw new Error(
    `Managed browser cache worker file not found. Tried: ${getPackagedWorkerPathCandidates(
      runtime,
      options
    ).join(", ")}`
  );
}

let defaultCacheWorkerClient: ManagedBrowserCacheWorkerClient | null = null;

/** Process singleton (design §13.9) — the cache module's default client. */
export function getDefaultManagedBrowserCacheWorkerClient(): ManagedBrowserCacheWorkerClient {
  if (!defaultCacheWorkerClient) {
    defaultCacheWorkerClient = new ManagedBrowserCacheWorkerClient();
  }
  return defaultCacheWorkerClient;
}
