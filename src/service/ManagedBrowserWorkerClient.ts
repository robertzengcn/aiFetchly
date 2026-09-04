import * as fs from "fs";
import * as path from "path";
import { log } from "@/modules/Logger";
import type { NormalizedCookie } from "@/schemas/accountCookies";
import type { ManagedBrowserInboundMessage } from "@/schemas/worker/managedBrowser";
import { managedBrowserOutboundSchema } from "@/schemas/worker/managedBrowser";
import type { ManagedBrowserOutboundMessage } from "@/schemas/worker/managedBrowser";
import {
  MANAGED_BROWSER_MESSAGE_LIMITS,
  MANAGED_BROWSER_TIMEOUTS,
} from "@/config/managedBrowser";
import type { ManagedBrowserProcessIdentity } from "@/entityTypes/managedBrowserTypes";
import {
  getPackagedWorkerPathCandidates,
  resolvePackagedWorkerPath,
  type PackagedWorkerPathRuntime,
  buildPackagedWorkerEnv,
} from "@/utils/packagedWorkerPath";

/**
 * Managed-browser worker client (technical design §8.4).
 *
 * ONE client per managed-browser session (unlike the shared SkillWorkerClient,
 * the worker is disposable). Owns:
 *  - one utility-process handle;
 *  - pending requests keyed by request ID with per-op timeouts;
 *  - the last accepted outbound sequence + malformed-message counter;
 *  - last heartbeat time and the validated Chrome process identity;
 *  - a single memoized cleanup promise so concurrent stop paths are
 *    idempotent (FR-RUNTIME-012).
 *
 * REFRESHED_COOKIES is routed ONLY to the private cookie callback — it is
 * never forwarded to the generic event sink or the renderer (§8.3).
 */

export interface UtilityProcessLike {
  postMessage(message: unknown): void;
  kill(): boolean;
  on(event: "message", listener: (message: unknown) => void): void;
  on(event: "exit", listener: (code: number | null) => void): void;
  on(event: "error", listener: (error: unknown) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
}

type OutboundEvent = Exclude<
  ManagedBrowserOutboundMessage,
  { type: "WORKER_HEARTBEAT" }
>;

export interface WorkerClientDeps {
  readonly sessionId: string;
  readonly sessionNonce: string;
  /** Safe events for the module/renderer (never cookies, never heartbeats). */
  readonly onEvent: (message: OutboundEvent) => void;
  /** PRIVATE cookie path — routed straight to AccountSessionService glue. */
  readonly onRefreshedCookies: (cookies: NormalizedCookie[]) => void;
  /** Fires exactly once when the worker is gone (crash, kill, cleanup). */
  readonly onExited: (detail: string) => void;
  readonly fork?: (
    entryPath: string,
    args: readonly string[]
  ) => UtilityProcessLike;
  readonly resolveEntryPath?: () => string;
  readonly now?: () => number;
}

interface PendingRequest {
  readonly requestId: string;
  resolve: (message: ManagedBrowserOutboundMessage) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  readonly accept: (message: ManagedBrowserOutboundMessage) => boolean;
}

/** Unsolicited-event waiter (WORKER_READY, spontaneous transitions). */
interface EventWaiter {
  resolve: (message: ManagedBrowserOutboundMessage) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  readonly accept: (message: ManagedBrowserOutboundMessage) => boolean;
}

/** Generic distributive Omit (Omit alone collapses unions). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** Request envelope: an inbound message minus the client-managed envelope. */
export type WorkerRequestEnvelope = DistributiveOmit<
  ManagedBrowserInboundMessage,
  "protocolVersion" | "sessionId" | "requestId" | "sequence"
>;

export class ManagedBrowserWorkerClient {
  public readonly sessionId: string;
  private readonly sessionNonce: string;
  private readonly deps: WorkerClientDeps;
  private readonly now: () => number;

  private worker: UtilityProcessLike | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly waiters: EventWaiter[] = [];
  private lastHeartbeatAt = 0;
  private lastSequence = 0;
  private malformedCount = 0;
  private exitedFired = false;
  private cleanupPromise: Promise<string> | null = null;
  private stopPromise: Promise<string> | null = null;
  private lastIdentity: ManagedBrowserProcessIdentity | null = null;
  private sequence = 0;
  private requestIdCounter = 0;

  constructor(deps: WorkerClientDeps) {
    this.sessionId = deps.sessionId;
    this.sessionNonce = deps.sessionNonce;
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  public get lastHeartbeatTime(): number {
    return this.lastHeartbeatAt;
  }

  public get processIdentity(): ManagedBrowserProcessIdentity | null {
    return this.lastIdentity;
  }

  /** Fork the utility process and await WORKER_READY (10s deadline). */
  public async start(): Promise<void> {
    const fork = this.deps.fork ?? defaultFork;
    const entryPath = this.deps.resolveEntryPath
      ? this.deps.resolveEntryPath()
      : resolveWorkerEntryPath();
    const worker = fork(entryPath, [this.sessionId, this.sessionNonce]);
    this.worker = worker;
    worker.on("message", (raw) => this.handleMessage(raw));
    worker.on("exit", (code) => {
      void this.cleanup(`exit:${code ?? "unknown"}`);
    });
    worker.on("error", (error) => {
      log.warn(
        `[ManagedBrowserWorkerClient:${this.sessionId}] worker error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
    await this.waitFor(
      (msg) => msg.type === "WORKER_READY",
      MANAGED_BROWSER_TIMEOUTS.workerReadyMs
    ).catch(async (error: Error) => {
      await this.cleanup("worker_start_timeout");
      throw error;
    });
  }

  /**
   * Wait for the next UNSOLICITED event matching `accept` (WORKER_READY,
   * spontaneous state changes). Correlated replies also satisfy waiters if
   * no pending request claims them first.
   */
  public waitFor(
    accept: (message: ManagedBrowserOutboundMessage) => boolean,
    timeoutMs: number
  ): Promise<ManagedBrowserOutboundMessage> {
    return new Promise<ManagedBrowserOutboundMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waiters.findIndex((w) => w.accept === accept);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        reject(new Error("worker_event_timeout"));
      }, timeoutMs);
      this.waiters.push({ resolve, reject, timeout, accept });
    });
  }

  /**
   * Send a request and resolve on the first correlated, schema-valid
   * response. WORKER_ERROR for the same requestId rejects.
   */
  public async request(
    message: WorkerRequestEnvelope,
    timeoutMs: number,
    accept: (message: ManagedBrowserOutboundMessage) => boolean
  ): Promise<ManagedBrowserOutboundMessage> {
    const worker = this.worker;
    if (!worker) {
      throw new Error("worker_not_started");
    }
    this.requestIdCounter += 1;
    const requestId = `req-${this.sessionId}-${this.requestIdCounter}`;
    this.sequence += 1;
    const full = {
      protocolVersion: 1,
      sessionId: this.sessionId,
      requestId,
      sequence: this.sequence,
      ...message,
    } as unknown as ManagedBrowserInboundMessage;

    return new Promise<ManagedBrowserOutboundMessage>((resolve, reject) => {
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
    });
  }

  public sendStop(
    reason: "user_stop" | "cancelled" | "shutdown" | "error"
  ): Promise<ManagedBrowserOutboundMessage> {
    return this.request(
      { type: "STOP_SESSION", reason },
      MANAGED_BROWSER_TIMEOUTS.gracefulStopMs +
        MANAGED_BROWSER_TIMEOUTS.forceKillAfterGracefulMs,
      (msg) => msg.type === "SESSION_STOPPED"
    );
  }

  /**
   * Graceful stop → forced kill. All terminal paths converge on the single
   * memoized `cleanup` (FR-RUNTIME-012). `stop` memoizes SEPARATELY from
   * `cleanup` — assigning the stop chain to `cleanupPromise` would deadlock
   * (the chain awaits `cleanup`, which would return the still-pending chain).
   */
  public stop(cause: string): Promise<string> {
    if (this.stopPromise) {
      return this.stopPromise;
    }
    this.stopPromise = (async (): Promise<string> => {
      try {
        await this.sendStop(
          cause === "error"
            ? "error"
            : cause === "cancelled"
            ? "cancelled"
            : "user_stop"
        );
      } catch {
        // Graceful window expired — fall through to forced kill.
      }
      return this.cleanup(cause);
    })();
    return this.stopPromise;
  }

  /** Idempotent terminal cleanup: reject pending, kill worker, notify once. */
  public async cleanup(cause: string): Promise<string> {
    if (this.cleanupPromise) {
      return this.cleanupPromise;
    }
    this.cleanupPromise = Promise.resolve(cause).then(async (reason) => {
      for (const [, pending] of this.pending) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("worker_exited"));
      }
      this.pending.clear();
      for (const waiter of this.waiters.splice(0)) {
        clearTimeout(waiter.timeout);
        waiter.reject(new Error("worker_exited"));
      }
      const worker = this.worker;
      if (worker) {
        try {
          worker.kill();
        } catch {
          /* already gone */
        }
        this.worker = null;
      }
      if (!this.exitedFired) {
        this.exitedFired = true;
        this.deps.onExited(reason);
      }
      return reason;
    });
    return this.cleanupPromise;
  }

  // -----------------------------------------------------------------------
  // Inbound handling
  // -----------------------------------------------------------------------

  private handleMessage(raw: unknown): void {
    let parsed: unknown = typeof raw === "string" ? safeJsonParse(raw) : raw;
    const validated = managedBrowserOutboundSchema().safeParse(parsed);
    if (!validated.success) {
      this.malformedCount++;
      log.warn(
        `[ManagedBrowserWorkerClient:${this.sessionId}] dropped malformed outbound message (${this.malformedCount})`
      );
      if (
        this.malformedCount >=
        MANAGED_BROWSER_MESSAGE_LIMITS.maxMalformedMessages
      ) {
        void this.cleanup("worker_protocol_violation");
      }
      return;
    }
    const message = validated.data as ManagedBrowserOutboundMessage;

    if (message.sessionId !== this.sessionId) {
      return; // foreign session — fail closed
    }
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

    if (message.type === "WORKER_HEARTBEAT") {
      this.lastHeartbeatAt = this.now();
      return;
    }
    if (message.type === "REFRESHED_COOKIES") {
      // Private path — never the generic event sink, never the renderer.
      this.deps.onRefreshedCookies(message.cookies as NormalizedCookie[]);
      return;
    }
    if (message.type === "SESSION_READY" && message.identity) {
      this.lastIdentity = message.identity;
      this.lastHeartbeatAt = this.now();
    }

    const pending =
      "requestId" in message ? this.pending.get(message.requestId) : undefined;
    if (pending) {
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
        return;
      }
    }
    // Unsolicited (or unmatched) events: first matching waiter wins.
    const waiterIndex = this.waiters.findIndex((w) => w.accept(message));
    if (waiterIndex >= 0) {
      const [waiter] = this.waiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timeout);
      waiter.resolve(message);
      return;
    }
    (this.deps.onEvent as (m: ManagedBrowserOutboundMessage) => void)(message);
  }
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return null;
  }
}

function defaultFork(
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
  return electron.utilityProcess.fork(entryPath, [...args], {
    stdio: "pipe",
    env: buildPackagedWorkerEnv() as Record<string, string>,
  });
}

/** Resolve the packaged/dev worker entry (ManagedBrowser.js). */
export function resolveWorkerEntryPath(): string {
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
      "ManagedBrowser.js",
      path.join("childprocess", "ManagedBrowser.js"),
      path.join("..", "childprocess", "ManagedBrowser.js"),
    ],
    cwdRelativePaths: [
      path.join("dist", "childprocess", "ManagedBrowser.js"),
      path.join(".vite", "build", "ManagedBrowser.js"),
    ],
  };
  const resolved = resolvePackagedWorkerPath(runtime, options);
  if (resolved) {
    return resolved;
  }
  throw new Error(
    `Managed browser worker file not found. Tried: ${getPackagedWorkerPathCandidates(
      runtime,
      options
    ).join(", ")}`
  );
}
