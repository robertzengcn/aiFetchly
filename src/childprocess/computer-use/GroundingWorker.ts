/**
 * GroundingWorker — the app-owned ONNX grounding worker entry
 * (design §5.6). Spawned by the supervisor via `utilityProcess.fork` with
 * `buildPackagedWorkerEnv` and `resolvePackagedWorkerPath`.
 *
 * Protocol (single in flight, queue depth 1):
 *   host → worker: load | ground | cancel | unload
 *   worker → host: loaded | result | error | unloaded
 *
 * Image bytes arrive as ArrayBuffer over the worker port and are never
 * logged. The worker cannot execute desktop input, access the database,
 * authorize actions, send network requests, or convert to desktop
 * coordinates (§5.9.1). Any result whose session generation is stale is
 * discarded by the host, never by trusting the worker.
 */
import {
  GroundingAdapterError,
  type GroundingModelAdapter,
} from "@/childprocess/computer-use/grounding/GroundingModelAdapter";
import { createAdapter } from "@/childprocess/computer-use/grounding/GroundingAdapterRegistry";
import type {
  GroundingResult,
  GroundingWorkerErrorCode,
  GroundingWorkerGroundRequest,
  GroundingWorkerInboundMessage,
  GroundingWorkerLoadRequest,
  GroundingWorkerOutboundMessage,
} from "@/entityTypes/computerUseTypes";

/** Transport seam: the utilityProcess parent port in production. */
export interface WorkerMessageSender {
  (message: GroundingWorkerOutboundMessage, transfer?: Transferable[]): void;
}

export class GroundingWorkerServer {
  private adapter: GroundingModelAdapter | null = null;
  private inFlight: string | null = null;
  private loadedProvider = "cpu";

  constructor(private readonly send: WorkerMessageSender) {}

  async handle(message: GroundingWorkerInboundMessage): Promise<void> {
    switch (message.type) {
      case "load":
        await this.handleLoad(message.payload.adapterId, message.payload);
        return;
      case "ground":
        await this.handleGround(message.payload);
        return;
      case "cancel":
        this.adapter?.cancel(message.requestKey);
        if (this.inFlight === message.requestKey) {
          this.inFlight = null;
        }
        return;
      case "unload":
        await this.handleUnload();
        return;
    }
  }

  private async handleLoad(
    adapterId: string,
    payload: GroundingWorkerLoadRequest
  ): Promise<void> {
    const adapter = createAdapter(adapterId);
    if (!adapter) {
      this.send({
        type: "error",
        payload: {
          requestKey: "load",
          code: "adapter_not_found",
          message: `adapter ${adapterId} is not registered in this build`,
        },
      });
      return;
    }
    try {
      const loadResult = await adapter.load({
        runtimeRoot: payload.runtimeRoot,
        runtimeVersion: payload.runtimeVersion,
        modelRoot: payload.modelRoot,
        modelVersion: payload.modelVersion,
        preferredProviders: payload.preferredProviders,
        calibration: payload.calibration,
      });
      this.adapter = adapter;
      this.loadedProvider = loadResult.provider;
      this.send({ type: "loaded", payload: { ...loadResult, adapterId: payload.adapterId } });
    } catch (error) {
      this.send({
        type: "error",
        payload: {
          requestKey: "load",
          code: mapToErrorCode(error),
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private async handleGround(payload: GroundingWorkerGroundRequest): Promise<void> {
    if (!this.adapter) {
      this.send({
        type: "error",
        payload: {
          requestKey: payload.requestKey,
          code: "model_not_ready",
          message: "worker has no loaded adapter",
        },
      });
      return;
    }
    if (this.inFlight && this.inFlight !== payload.requestKey) {
      // Queue depth 1: refuse concurrent grounding rather than queueing.
      this.send({
        type: "error",
        payload: {
          requestKey: payload.requestKey,
          code: "request_invalid",
          message: "another grounding request is in flight",
        },
      });
      return;
    }
    this.inFlight = payload.requestKey;
    try {
      const result = await this.adapter.ground(payload);
      if (this.inFlight !== payload.requestKey) {
        return; // cancelled while running — drop the result
      }
      this.inFlight = null;
      const identity = this.adapter.identity(this.loadedProvider);
      const groundingResult: GroundingResult = {
        requestKey: payload.requestKey,
        generation: payload.generation,
        observationId: payload.observationId,
        candidates: result.candidates,
        transform: result.transform,
        identity,
        timings: result.timings,
        outcome: result.outcome,
      };
      this.send({ type: "result", payload: groundingResult });
    } catch (error) {
      this.inFlight = null;
      this.send({
        type: "error",
        payload: {
          requestKey: payload.requestKey,
          code: mapToErrorCode(error),
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private async handleUnload(): Promise<void> {
    const adapter = this.adapter;
    this.adapter = null;
    this.inFlight = null;
    await adapter?.unload().catch(() => undefined);
    this.send({ type: "unloaded" });
  }
}

function mapToErrorCode(error: unknown): GroundingWorkerErrorCode {
  if (error instanceof GroundingAdapterError) {
    return error.adapterError.code;
  }
  return "output_invalid";
}

/* --------------------------- utilityProcess entry --------------------------- */

/**
 * Electron's utilityProcess parent port delivers MessageEvent envelopes, not
 * bare payloads: the listener receives `{ data }` (audit A09). Declared
 * locally like every other worker (PythonRuntimeWorker precedent).
 */
interface ParentPortMessageEvent {
  data: unknown;
}

type UtilityParentPort = {
  on(event: "message", listener: (event: ParentPortMessageEvent) => void): void;
  postMessage(message: unknown): void;
};

function getUtilityParentPort(): UtilityParentPort | null {
  if (typeof process === "undefined") return null;
  const candidate = (process as { parentPort?: unknown }).parentPort;
  if (!candidate || typeof candidate !== "object") return null;
  const port = candidate as Partial<UtilityParentPort>;
  if (typeof port.on !== "function" || typeof port.postMessage !== "function") {
    return null;
  }
  return port as UtilityParentPort;
}

/** Runtime shape validation of an inbound host message (audit A09). */
function parseInboundMessage(raw: unknown): GroundingWorkerInboundMessage | null {
  if (typeof raw !== "string") {
    // UtilityProcess.postMessage structured-clones objects directly.
    if (isInboundMessageShape(raw)) return raw as GroundingWorkerInboundMessage;
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isInboundMessageShape(parsed)) {
      return parsed as GroundingWorkerInboundMessage;
    }
  } catch {
    /* fall through */
  }
  return null;
}

function isInboundMessageShape(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.type === "load" &&
      typeof record.payload === "object" &&
      record.payload !== null) ||
    (record.type === "ground" &&
      typeof record.payload === "object" &&
      record.payload !== null) ||
    (record.type === "cancel" && typeof record.requestKey === "string") ||
    record.type === "unload"
  );
}

/** Entry point when spawned as an Electron utilityProcess. */
const parentPort = getUtilityParentPort();
if (parentPort) {
  const server = new GroundingWorkerServer((message) => {
    parentPort.postMessage(message);
  });
  parentPort.on("message", (event: ParentPortMessageEvent) => {
    const message = parseInboundMessage(event.data);
    if (!message) return; // malformed envelope: ignore, never crash the worker
    void server.handle(message).catch(() => undefined);
  });
}
