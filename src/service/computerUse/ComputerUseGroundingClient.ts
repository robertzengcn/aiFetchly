/**
 * ComputerUseGroundingClient — the host side of the grounding worker
 * protocol (design §5.6; audit A09/A10).
 *
 * Owns the worker process: load with the leased runtime/model version
 * roots, forward ground requests (single in flight), discard stale-session
 * results, and kill the worker when a run cannot be stopped promptly —
 * model reload is the cost of a guaranteed stop.
 *
 * Audit A10: replies are correlated by worker instance + request key. A
 * late reply for a cancelled/finished request can never resolve or reject a
 * newer one, and callbacks from a superseded worker (after unload/reload)
 * are ignored. Reply timeouts and cancels arm a bounded watchdog that kills
 * the worker outright when the run cannot be confirmed stopped.
 *
 * Audit A09: Electron's `UtilityProcess.postMessage` accepts
 * `MessagePortMain[]` in its transfer list — NOT Web-Worker `Transferable`
 * ArrayBuffers. Image bytes are structured-clone copied (never transferred
 * zero-copy); they are still never logged or persisted.
 */
import {
  ComputerUseError,
  type ComputerUseSessionGeneration,
  type GroundingResult,
  type GroundingWorkerErrorCode,
  type GroundingWorkerLoadRequest,
  type GroundingWorkerLoadResult,
  type GroundingWorkerOutboundMessage,
} from "@/entityTypes/computerUseTypes";

/** Structural seam over Electron's utilityProcess child. */
export interface GroundingWorkerProcess {
  postMessage(message: unknown): void;
  on(event: "message", listener: (message: unknown) => void): void;
  once(event: "exit", listener: (code: number) => void): void;
  kill(): void | boolean;
}

export type GroundingWorkerFactory = () => GroundingWorkerProcess;

export interface GroundingClientOptions {
  /** Milliseconds to wait for load/ground replies. Default 120 s. */
  readonly replyTimeoutMs?: number;
  /**
   * Grace period after a cancel for the worker to confirm the run stopped
   * before the watchdog kills it (PRD stop budget: ≤1 s).
   */
  readonly cancelWatchdogMs?: number;
}

interface PendingGround {
  readonly requestKey: string;
  readonly workerId: number;
  resolve: (value: GroundingResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  /** Watchdog armed by cancel(); kills the worker if the run won't stop. */
  watchdog: ReturnType<typeof setTimeout> | null;
  readonly promise: Promise<GroundingResult>;
}

interface PendingLoad {
  readonly workerId: number;
  resolve: (value: GroundingWorkerLoadResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  readonly promise: Promise<GroundingWorkerLoadResult>;
}

export interface GroundingRequestInput {
  readonly requestKey: string;
  readonly generation: ComputerUseSessionGeneration;
  readonly observationId: string;
  readonly imageBytes: ArrayBuffer;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly targetDescription: string;
  readonly crop?: { x: number; y: number; width: number; height: number };
  readonly maxPixels: number;
}

export class ComputerUseGroundingClient {
  private worker: GroundingWorkerProcess | null = null;
  /** Monotonic worker instance id: callbacks from older ids are ignored. */
  private workerId = 0;
  private loadReply: PendingLoad | null = null;
  private readonly groundReplies = new Map<string, PendingGround>();
  private unloadReply: {
    resolve: () => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private readonly replyTimeoutMs: number;
  private readonly cancelWatchdogMs: number;
  /** Results for generations below this are discarded silently (§5.6). */
  private minimumGeneration = 0;

  constructor(
    private readonly forkWorker: GroundingWorkerFactory,
    options: GroundingClientOptions = {}
  ) {
    this.replyTimeoutMs = options.replyTimeoutMs ?? 120_000;
    this.cancelWatchdogMs = options.cancelWatchdogMs ?? 1_000;
  }

  /** Raise the generation floor: late old-session results are discarded. */
  raiseGenerationFloor(generation: ComputerUseSessionGeneration): void {
    if (generation > this.minimumGeneration) {
      this.minimumGeneration = generation;
    }
  }

  /** Load an adapter in the worker with the leased version roots. */
  async load(
    request: GroundingWorkerLoadRequest
  ): Promise<GroundingWorkerLoadResult> {
    if (this.worker) {
      throw new ComputerUseError("model_not_ready", "worker already loaded");
    }
    const worker = this.forkWorker();
    const workerId = ++this.workerId;
    this.worker = worker;
    worker.on("message", (raw) => this.handleMessage(raw, workerId));
    worker.once("exit", () => this.handleExit(workerId));

    const reply = this.awaitLoadReply(workerId);
    this.loadReply = reply;
    try {
      worker.postMessage({ type: "load", payload: request });
    } catch (error) {
      this.loadReply = null;
      clearTimeout(reply.timer);
      this.destroyWorker();
      throw normalizeSpawnError(error);
    }
    try {
      return await reply.promise;
    } catch (error) {
      this.loadReply = null;
      this.destroyWorker();
      throw error;
    }
  }

  /**
   * Ground one image. Single in flight; concurrent requests fail fast with
   * `model_not_ready` until the current one settles.
   */
  async ground(request: GroundingRequestInput): Promise<GroundingResult> {
    const worker = this.worker;
    if (!worker) {
      throw new ComputerUseError("model_not_ready", "worker is not loaded");
    }
    if (this.groundReplies.size > 0) {
      // Queue depth 1 (design §5.6): one run at a time, regardless of key.
      throw new ComputerUseError(
        "model_not_ready",
        "another grounding request is in flight"
      );
    }
    const workerId = this.workerId;
    const reply = this.awaitGroundReply(request.requestKey, workerId);
    this.groundReplies.set(request.requestKey, reply);
    // Structured-clone copy (Electron postMessage transfer lists accept
    // MessagePortMain only — audit A09).
    try {
      worker.postMessage({
        type: "ground",
        payload: { ...request, imageBytes: request.imageBytes },
      });
    } catch (error) {
      this.groundReplies.delete(request.requestKey);
      clearTimeout(reply.timer);
      throw normalizeSpawnError(error);
    }
    try {
      return await reply.promise;
    } finally {
      this.groundReplies.delete(request.requestKey);
    }
  }

  /**
   * Cancel an in-flight request: notify the worker, reject the pending
   * promise, and arm a bounded watchdog that kills the worker outright if
   * the run cannot be confirmed stopped (audit A10).
   */
  cancel(requestKey: string): void {
    const reply = this.groundReplies.get(requestKey);
    if (!reply) return;
    this.worker?.postMessage({ type: "cancel", requestKey });
    this.groundReplies.delete(requestKey);
    clearTimeout(reply.timer);
    if (reply.watchdog) clearTimeout(reply.watchdog);
    reply.reject(new ComputerUseError("execution_uncertain", "grounding cancelled"));
    // Watchdog: the worker's cooperative cancel may not stop a native ONNX
    // run; kill the process when the stop budget expires (design §5.6).
    // Only the worker the run belonged to may be killed — a reloaded
    // successor must survive (audit A10).
    const cancelledWorkerId = reply.workerId;
    reply.watchdog = setTimeout(() => {
      if (this.workerId === cancelledWorkerId) {
        this.killNow();
      }
    }, this.cancelWatchdogMs);
    reply.watchdog.unref?.();
  }

  /** Graceful unload: releases sessions/memory and exits the worker. */
  async unload(): Promise<void> {
    const worker = this.worker;
    if (!worker) return;
    const reply = this.awaitUnloadReply();
    this.unloadReply = reply;
    try {
      worker.postMessage({ type: "unload" });
    } catch (error) {
      this.unloadReply = null;
      clearTimeout(reply.timer);
      this.destroyWorker();
      throw normalizeSpawnError(error);
    }
    await reply.promise.catch(() => undefined);
    this.destroyWorker();
  }

  /**
   * Immediate stop path: kill the worker outright. Used by the supervisor
   * when a run cannot be terminated promptly (≤1 s PRD target).
   */
  killNow(): void {
    this.rejectPending(
      new ComputerUseError("execution_uncertain", "grounding worker killed")
    );
    this.destroyWorker();
  }

  get isLoaded(): boolean {
    return this.worker !== null;
  }

  private handleMessage(raw: unknown, workerId: number): void {
    // Audit A10: callbacks from a superseded worker never touch new state.
    if (workerId !== this.workerId) return;
    const message = parseOutboundMessage(raw);
    if (!message) return; // malformed payload: ignore, never poison pending

    switch (message.type) {
      case "loaded": {
        const reply = this.loadReply;
        this.loadReply = null;
        if (reply && reply.workerId === workerId) {
          clearTimeout(reply.timer);
          reply.resolve(message.payload);
        }
        return;
      }
      case "result": {
        const reply = this.groundReplies.get(message.payload.requestKey);
        if (!reply || reply.workerId !== workerId) {
          return; // late reply for a finished/cancelled request: discard
        }
        this.groundReplies.delete(message.payload.requestKey);
        clearTimeout(reply.timer);
        if (reply.watchdog) clearTimeout(reply.watchdog);
        // Stale-generation discard: a late old-session result never reaches
        // the planner or creates a target handle.
        if (message.payload.generation <= this.minimumGeneration) {
          reply.reject(
            new ComputerUseError("target_stale", "result generation is stale")
          );
          return;
        }
        reply.resolve(message.payload);
        return;
      }
      case "error": {
        if (message.payload.requestKey === "load") {
          const reply = this.loadReply;
          this.loadReply = null;
          if (reply && reply.workerId === workerId) {
            clearTimeout(reply.timer);
            reply.reject(
              new ComputerUseError("model_not_ready", message.payload.message)
            );
          }
          return;
        }
        const reply = this.groundReplies.get(message.payload.requestKey);
        if (!reply || reply.workerId !== workerId) return;
        this.groundReplies.delete(message.payload.requestKey);
        clearTimeout(reply.timer);
        if (reply.watchdog) clearTimeout(reply.watchdog);
        reply.reject(
          new ComputerUseError(
            mapWorkerError(message.payload.code),
            message.payload.message
          )
        );
        return;
      }
      case "unloaded": {
        const reply = this.unloadReply;
        this.unloadReply = null;
        if (reply) {
          clearTimeout(reply.timer);
          reply.resolve();
        }
        return;
      }
    }
  }

  private handleExit(workerId: number): void {
    if (workerId !== this.workerId) return; // an OLD worker's exit
    this.rejectPending(
      new ComputerUseError("backend_unavailable", "grounding worker exited")
    );
    this.worker = null;
  }

  private rejectPending(error: Error): void {
    if (this.loadReply) {
      clearTimeout(this.loadReply.timer);
      this.loadReply.reject(error);
    }
    this.loadReply = null;
    for (const reply of this.groundReplies.values()) {
      clearTimeout(reply.timer);
      if (reply.watchdog) clearTimeout(reply.watchdog);
      reply.reject(error);
    }
    this.groundReplies.clear();
    if (this.unloadReply) {
      clearTimeout(this.unloadReply.timer);
      this.unloadReply.resolve();
    }
    this.unloadReply = null;
  }

  private destroyWorker(): void {
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      try {
        worker.kill();
      } catch {
        /* already dead */
      }
    }
  }

  private awaitLoadReply(workerId: number): PendingLoad {
    let resolve!: (value: GroundingWorkerLoadResult) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<GroundingWorkerLoadResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const timer = setTimeout(() => {
      reject(new ComputerUseError("execution_uncertain", "grounding worker reply timed out"));
    }, this.replyTimeoutMs);
    timer.unref?.();
    return { workerId, resolve, reject, timer, promise };
  }

  private awaitGroundReply(requestKey: string, workerId: number): PendingGround {
    let resolve!: (value: GroundingResult) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<GroundingResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const timer = setTimeout(() => {
      // Timeout means the run is unaccounted for: kill the worker (audit A10).
      this.killNow();
      reject(new ComputerUseError("execution_uncertain", "grounding worker reply timed out"));
    }, this.replyTimeoutMs);
    timer.unref?.();
    return {
      requestKey,
      workerId,
      resolve,
      reject,
      timer,
      watchdog: null,
      promise,
    };
  }

  private awaitUnloadReply(): {
    resolve: () => void;
    timer: ReturnType<typeof setTimeout>;
    promise: Promise<void>;
  } {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
      resolve = res;
    });
    const timer = setTimeout(resolve, this.replyTimeoutMs);
    timer.unref?.();
    return { resolve, timer, promise };
  }
}

/** Runtime shape validation of a worker reply (audit A10). */
function parseOutboundMessage(raw: unknown): GroundingWorkerOutboundMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (record.type === "loaded" && typeof record.payload === "object" && record.payload !== null) {
    return raw as GroundingWorkerOutboundMessage;
  }
  if (record.type === "unloaded") return raw as GroundingWorkerOutboundMessage;
  if (
    (record.type === "result" || record.type === "error") &&
    typeof record.payload === "object" &&
    record.payload !== null
  ) {
    return raw as GroundingWorkerOutboundMessage;
  }
  return null;
}

function normalizeSpawnError(error: unknown): ComputerUseError {
  return new ComputerUseError(
    "backend_unavailable",
    `grounding worker post failed: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
}

function mapWorkerError(
  code: GroundingWorkerErrorCode
): import("@/entityTypes/computerUseTypes").ComputerUseErrorCode {
  switch (code) {
    case "model_not_ready":
      return "model_not_ready";
    case "backend_unavailable":
      return "backend_unavailable";
    case "cancelled":
    case "timeout":
      return "execution_uncertain";
    case "memory":
      return "model_not_ready";
    case "request_invalid":
      return "coordinates_invalid";
    case "output_invalid":
    case "adapter_not_found":
    default:
      return "unknown_error";
  }
}
