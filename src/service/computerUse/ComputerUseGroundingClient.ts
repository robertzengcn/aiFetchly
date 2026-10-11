/**
 * ComputerUseGroundingClient — the host side of the grounding worker
 * protocol (design §5.6).
 *
 * Owns the worker process: load with the leased runtime/model version
 * roots, forward ground requests (single in flight), discard stale-session
 * results, and kill the worker when a run cannot be stopped promptly —
 * model reload is the cost of a guaranteed stop.
 */
import {
  ComputerUseError,
  type ComputerUseSessionGeneration,
  type GroundingResult,
  type GroundingWorkerLoadRequest,
  type GroundingWorkerLoadResult,
  type GroundingWorkerOutboundMessage,
} from "@/entityTypes/computerUseTypes";

/** Structural seam over Electron's utilityProcess child. */
export interface GroundingWorkerProcess {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  on(event: "message", listener: (message: unknown) => void): void;
  once(event: "exit", listener: (code: number) => void): void;
  kill(): void | boolean;
}

export type GroundingWorkerFactory = () => GroundingWorkerProcess;

export interface GroundingClientOptions {
  /** Milliseconds to wait for load/ground replies. Default 120 s. */
  readonly replyTimeoutMs?: number;
  readonly clock?: () => number;
}

interface PendingReply<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
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
  private loadReply: PendingReply<GroundingWorkerLoadResult> | null = null;
  private groundReply: PendingReply<GroundingResult> | null = null;
  private unloadReply: PendingReply<void> | null = null;
  private readonly replyTimeoutMs: number;
  private readonly clock: () => number;
  /** Results for generations below this are discarded silently (§5.6). */
  private minimumGeneration = 0;

  constructor(
    private readonly forkWorker: GroundingWorkerFactory,
    options: GroundingClientOptions = {}
  ) {
    this.replyTimeoutMs = options.replyTimeoutMs ?? 120_000;
    this.clock = options.clock ?? (() => Date.now());
  }

  /** Raise the generation floor: late old-session results are discarded. */
  raiseGenerationFloor(generation: ComputerUseSessionGeneration): void {
    if (generation > this.minimumGeneration) {
      this.minimumGeneration = generation;
    }
  }

  /** Load an adapter in the worker with the leased version roots. */
  async load(request: GroundingWorkerLoadRequest): Promise<GroundingWorkerLoadResult> {
    if (this.worker) {
      throw new ComputerUseError("model_not_ready", "worker already loaded");
    }
    const worker = this.forkWorker();
    this.worker = worker;
    worker.on("message", (raw) => this.handleMessage(raw));
    worker.once("exit", () => this.handleExit());

    const reply = this.awaitReply<GroundingWorkerLoadResult>();
    this.loadReply = reply;
    worker.postMessage({ type: "load", payload: request });
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
    if (!this.worker) {
      throw new ComputerUseError("model_not_ready", "worker is not loaded");
    }
    if (this.groundReply) {
      throw new ComputerUseError(
        "model_not_ready",
        "another grounding request is in flight"
      );
    }
    const reply = this.awaitReply<GroundingResult>();
    this.groundReply = reply;
    // Transfer the image buffer (zero-copy) — never copied, never logged.
    this.worker.postMessage(
      {
        type: "ground",
        payload: { ...request, imageBytes: request.imageBytes },
      },
      [request.imageBytes]
    );
    try {
      return await reply.promise;
    } finally {
      this.groundReply = null;
    }
  }

  /** Cancel an in-flight request; the pending promise rejects. */
  cancel(requestKey: string): void {
    this.worker?.postMessage({ type: "cancel", requestKey });
    const reply = this.groundReply;
    if (reply) {
      this.groundReply = null;
      clearTimeout(reply.timer);
      reply.reject(new ComputerUseError("execution_uncertain", "grounding cancelled"));
    }
  }

  /** Graceful unload: releases sessions/memory and exits the worker. */
  async unload(): Promise<void> {
    const worker = this.worker;
    if (!worker) return;
    const reply = this.awaitReply<void>();
    this.unloadReply = reply;
    worker.postMessage({ type: "unload" });
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

  private handleMessage(raw: unknown): void {
    const message = raw as GroundingWorkerOutboundMessage;
    switch (message.type) {
      case "loaded": {
        const reply = this.loadReply;
        this.loadReply = null;
        if (reply) {
          clearTimeout(reply.timer);
          reply.resolve(message.payload);
        }
        return;
      }
      case "result": {
        // Stale-generation discard: a late old-session result never reaches
        // the planner or creates a target handle.
        if (message.payload.generation <= this.minimumGeneration) {
          const reply = this.groundReply;
          this.groundReply = null;
          if (reply) {
            clearTimeout(reply.timer);
            reply.reject(
              new ComputerUseError("target_stale", "result generation is stale")
            );
          }
          return;
        }
        const reply = this.groundReply;
        this.groundReply = null;
        if (reply) {
          clearTimeout(reply.timer);
          reply.resolve(message.payload);
        }
        return;
      }
      case "error": {
        const loadReply = this.loadReply;
        if (loadReply && message.payload.requestKey === "load") {
          this.loadReply = null;
          clearTimeout(loadReply.timer);
          loadReply.reject(
            new ComputerUseError("model_not_ready", message.payload.message)
          );
          return;
        }
        const reply = this.groundReply;
        this.groundReply = null;
        if (reply) {
          clearTimeout(reply.timer);
          reply.reject(
            new ComputerUseError(
              mapWorkerError(message.payload.code),
              message.payload.message
            )
          );
        }
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

  private handleExit(): void {
    this.rejectPending(
      new ComputerUseError("backend_unavailable", "grounding worker exited")
    );
    this.worker = null;
  }

  private rejectPending(error: Error): void {
    for (const reply of [this.loadReply, this.groundReply, this.unloadReply]) {
      if (reply) {
        clearTimeout(reply.timer);
        reply.reject(error);
      }
    }
    this.loadReply = null;
    this.groundReply = null;
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

  private awaitReply<T>(): PendingReply<T> & { promise: Promise<T> } {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const timer = setTimeout(() => {
      reject(
        new ComputerUseError(
          "execution_uncertain",
          "grounding worker reply timed out"
        )
      );
    }, this.replyTimeoutMs);
    timer.unref?.();
    return { resolve, reject, timer, promise };
  }
}

function mapWorkerError(
  code: import("@/entityTypes/computerUseTypes").GroundingWorkerErrorCode
): import("@/entityTypes/computerUseTypes").ComputerUseErrorCode {
  switch (code) {
    case "model_not_ready":
      return "model_not_ready";
    case "backend_unavailable":
      return "backend_unavailable";
    case "cancelled":
      return "execution_uncertain";
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
