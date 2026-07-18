"use strict";

/**
 * IPC contract for the local embedding worker (`src/childprocess/embedding/LocalEmbeddingWorker.ts`).
 *
 * The worker is spawned by `LocalEmbeddingWorkerClient` via Electron's
 * `utilityProcess.fork`. Messages are JSON-stringified on the wire (matching the
 * SkillWorker convention). The worker never touches SQLite, TypeORM, or vector
 * store modules — it only loads `@xenova/transformers` and returns vectors.
 */

// ─── Protocol limits (conservative for CPU-only first release) ───────────────

/** Maximum number of texts accepted in a single embed-batch request. */
export const LOCAL_EMBEDDING_MAX_BATCH_SIZE = 32;

/** Maximum character length accepted for a single text item. */
export const LOCAL_EMBEDDING_MAX_CHARS_PER_ITEM = 16_000;

/** Worker request timeout used by the client when awaiting a response. */
export const LOCAL_EMBEDDING_REQUEST_TIMEOUT_MS = 120_000;

// ─── Main → Worker (inbound) ─────────────────────────────────────────────────

export interface LocalEmbeddingInitMessage {
  type: "initialize";
  requestId: string;
  modelId: string;
  underlyingModel: string;
}

export interface LocalEmbeddingBatchMessage {
  type: "embed-batch";
  requestId: string;
  modelId: string;
  texts: string[];
}

export interface LocalEmbeddingShutdownMessage {
  type: "shutdown";
  requestId: string;
}

export type LocalEmbeddingInboundMessage =
  | LocalEmbeddingInitMessage
  | LocalEmbeddingBatchMessage
  | LocalEmbeddingShutdownMessage;

// ─── Worker → Main (outbound) ────────────────────────────────────────────────

export interface LocalEmbeddingReadyMessage {
  type: "ready";
  requestId: string;
  modelId: string;
  dimensions: number;
}

export interface LocalEmbeddingBatchResultMessage {
  type: "embed-batch-result";
  requestId: string;
  modelId: string;
  dimensions: number;
  embeddings: number[][];
}

export interface LocalEmbeddingErrorMessage {
  type: "error";
  requestId: string;
  error: string;
}

export type LocalEmbeddingOutboundMessage =
  | LocalEmbeddingReadyMessage
  | LocalEmbeddingBatchResultMessage
  | LocalEmbeddingErrorMessage;

// ─── Client-side payload helpers ─────────────────────────────────────────────

export interface LocalEmbeddingReadyPayload {
  modelId: string;
  dimensions: number;
}

export interface LocalEmbeddingBatchPayload {
  modelId: string;
  dimensions: number;
  embeddings: number[][];
}
