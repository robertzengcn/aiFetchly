"use strict";
/**
 * Local embedding worker.
 *
 * Runs in an Electron `utilityProcess` spawned by `LocalEmbeddingWorkerClient`.
 * Loads `@xenova/transformers`, caches the pipeline after first load, and
 * produces mean-pooled, L2-normalized embeddings.
 *
 * Hard rules (per architecture):
 *  - no SQLite / TypeORM / vector-store imports
 *  - no remote AI calls
 *  - never receives document or database paths — only the text to embed
 *  - validates every inbound message and every produced vector before returning
 */
import { pipeline } from "@xenova/transformers";
import { LOCAL_XENOVA_ALL_MINILM_DIMENSIONS } from "@/service/embedding/LocalEmbeddingModels";
import {
  type LocalEmbeddingBatchMessage,
  type LocalEmbeddingInboundMessage,
  type LocalEmbeddingInitMessage,
  type LocalEmbeddingOutboundMessage,
} from "@/childprocess/embedding/LocalEmbeddingWorkerTypes";
import { localEmbeddingInboundSchema } from "@/schemas/worker/localEmbedding";
import {
  underlyingModelFromModelId,
  validateBatchTexts,
  validateEmbeddingMatrix,
} from "@/childprocess/embedding/LocalEmbeddingValidation";

interface ParentPortMessageEvent {
  data: string;
}

interface WorkerParentPort {
  on: (
    event: "message",
    handler: (event: ParentPortMessageEvent) => void | Promise<void>
  ) => void;
  postMessage: (message: string) => void;
}

const parentPort = (process as unknown as { parentPort?: WorkerParentPort })
  .parentPort;

// Pipeline is cached after first successful load. Keyed by underlying model so
// re-initializing with the same model is a no-op.
type CachedExtractor = {
  underlyingModel: string;
  // The transformers.js pipeline return type is a complex callable; we only
  // need to invoke it and read `.tolist()` off the result.
  run: (
    texts: string[],
    options: { pooling: "mean"; normalize: boolean }
  ) => Promise<{ tolist(): unknown }>;
};

let cachedExtractor: CachedExtractor | null = null;
const activeRequestIds = new Set<string>();

function postMessageSafe(message: LocalEmbeddingOutboundMessage): void {
  if (!parentPort) {
    return;
  }
  try {
    parentPort.postMessage(JSON.stringify(message));
  } catch (postError) {
    const errorMessage =
      postError instanceof Error ? postError.message : String(postError);
    console.error(
      `[LocalEmbeddingWorker] Failed to post message: ${errorMessage}`
    );
  }
}

function sendError(requestId: string, errorMessage: string): void {
  postMessageSafe({ type: "error", requestId, error: errorMessage });
}

function sendFatalErrorToActiveRequests(error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  for (const requestId of activeRequestIds) {
    postMessageSafe({ type: "error", requestId, error: errorMessage });
  }
}

async function getOrCreateExtractor(
  underlyingModel: string
): Promise<CachedExtractor> {
  if (cachedExtractor && cachedExtractor.underlyingModel === underlyingModel) {
    return cachedExtractor;
  }
  const extractor = await pipeline("feature-extraction", underlyingModel);
  cachedExtractor = {
    underlyingModel,
    run: extractor as CachedExtractor["run"],
  };
  return cachedExtractor;
}

async function handleInitialize(
  message: LocalEmbeddingInitMessage
): Promise<void> {
  await getOrCreateExtractor(message.underlyingModel);
  postMessageSafe({
    type: "ready",
    requestId: message.requestId,
    modelId: message.modelId,
    dimensions: LOCAL_XENOVA_ALL_MINILM_DIMENSIONS,
  });
}

async function handleEmbedBatch(
  message: LocalEmbeddingBatchMessage
): Promise<void> {
  // Lazy auto-init in case initialize was skipped or the cache was cleared.
  const underlyingModel = underlyingModelFromModelId(message.modelId);
  const extractor = await getOrCreateExtractor(underlyingModel);
  const texts = validateBatchTexts(message.texts);

  const output = await extractor.run(texts, {
    pooling: "mean",
    normalize: true,
  });
  const embeddings = validateEmbeddingMatrix(output.tolist(), texts.length);

  postMessageSafe({
    type: "embed-batch-result",
    requestId: message.requestId,
    modelId: message.modelId,
    dimensions: LOCAL_XENOVA_ALL_MINILM_DIMENSIONS,
    embeddings,
  });
}

async function dispatch(raw: unknown): Promise<void> {
  const parsed = localEmbeddingInboundSchema().safeParse(raw);
  if (!parsed.success) {
    // Try to recover a requestId so the client can reject its pending promise.
    const maybeRequestId =
      typeof raw === "object" &&
      raw !== null &&
      "requestId" in raw &&
      typeof (raw as { requestId?: unknown }).requestId === "string"
        ? (raw as { requestId: string }).requestId
        : "unknown";
    sendError(
      maybeRequestId,
      `Invalid inbound message: ${parsed.error.message}`
    );
    return;
  }

  const message = parsed.data as LocalEmbeddingInboundMessage;
  const { requestId } = message;
  activeRequestIds.add(requestId);

  try {
    switch (message.type) {
      case "initialize":
        await handleInitialize(message);
        break;
      case "embed-batch":
        await handleEmbedBatch(message);
        break;
      case "shutdown":
        // Acknowledge shutdown by exiting cleanly.
        activeRequestIds.delete(requestId);
        process.exit(0);
        break;
      default:
        // Exhaustiveness guard — unreachable for a discriminated union.
        sendError(requestId, `Unknown message type`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    sendError(requestId, errorMessage);
  } finally {
    activeRequestIds.delete(requestId);
  }
}

if (parentPort) {
  parentPort.on("message", async (event: ParentPortMessageEvent) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch (parseError) {
      const errorMessage =
        parseError instanceof Error ? parseError.message : String(parseError);
      console.error(`[LocalEmbeddingWorker] Non-JSON inbound: ${errorMessage}`);
      sendError("unknown", "Inbound message is not valid JSON");
      return;
    }
    await dispatch(parsed);
  });
}

process.on("uncaughtException", (error: unknown) => {
  console.error("[LocalEmbeddingWorker] Uncaught exception:", error);
  sendFatalErrorToActiveRequests(error);
  process.exit(1);
});

process.on("unhandledRejection", (reason: unknown) => {
  console.error("[LocalEmbeddingWorker] Unhandled rejection:", reason);
  sendFatalErrorToActiveRequests(reason);
  process.exit(1);
});
