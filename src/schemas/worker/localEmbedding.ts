"use strict";
import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";
import {
  LOCAL_EMBEDDING_MAX_BATCH_SIZE,
  LOCAL_EMBEDDING_MAX_CHARS_PER_ITEM,
} from "@/childprocess/embedding/LocalEmbeddingWorkerTypes";

/**
 * Local embedding worker message contracts.
 *
 * `z.discriminatedUnion("type", ...)` lets TypeScript narrow fields inside each
 * `switch(msg.type)` branch and rejects malformed messages at the process
 * boundary.
 */

// ─── Main → Worker (inbound) ─────────────────────────────────────────────────

const localEmbeddingInitSchema = z.object({
  type: z.literal("initialize"),
  requestId: z.string().min(1),
  modelId: z.string().min(1),
  underlyingModel: z.string().min(1),
});

const localEmbeddingBatchSchema = z.object({
  type: z.literal("embed-batch"),
  requestId: z.string().min(1),
  modelId: z.string().min(1),
  texts: z
    .array(z.string().max(LOCAL_EMBEDDING_MAX_CHARS_PER_ITEM))
    .min(1)
    .max(LOCAL_EMBEDDING_MAX_BATCH_SIZE),
});

const localEmbeddingShutdownSchema = z.object({
  type: z.literal("shutdown"),
  requestId: z.string().min(1),
});

export const localEmbeddingInboundSchema = lazySchema(() =>
  z.discriminatedUnion("type", [
    localEmbeddingInitSchema,
    localEmbeddingBatchSchema,
    localEmbeddingShutdownSchema,
  ])
);

// ─── Worker → Main (outbound) ────────────────────────────────────────────────

const localEmbeddingEmbeddingsSchema = z.array(z.array(z.number()));

export const localEmbeddingOutboundSchema = lazySchema(() =>
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("ready"),
      requestId: z.string().min(1),
      modelId: z.string().min(1),
      dimensions: z.number().int().positive(),
    }),
    z.object({
      type: z.literal("embed-batch-result"),
      requestId: z.string().min(1),
      modelId: z.string().min(1),
      dimensions: z.number().int().positive(),
      embeddings: localEmbeddingEmbeddingsSchema,
    }),
    z.object({
      type: z.literal("error"),
      requestId: z.string().min(1),
      error: z.string().min(1),
    }),
  ])
);
