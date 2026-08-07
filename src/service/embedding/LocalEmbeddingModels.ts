"use strict";
import type {
  EmbeddingModelInfo,
  EmbeddingProviderKind,
} from "@/entityTypes/embeddingTypes";

/**
 * Built-in local embedding model catalog.
 *
 * These string values are the single source of truth for the local Xenova
 * provider. They must not be duplicated elsewhere — provider routing, vector
 * index naming, document metadata, and UI badges all derive from these
 * constants.
 */

export const LOCAL_XENOVA_PROVIDER: EmbeddingProviderKind = "local-xenova";

/**
 * Prefix that namespaces every local Xenova model ID. Provider routing keys off
 * this prefix; it must not collide with remote model IDs.
 */
export const LOCAL_XENOVA_PROVIDER_PREFIX = "local-xenova:";

/** Stable model ID for the first supported local embedding model. */
export const LOCAL_XENOVA_ALL_MINILM_MODEL_ID =
  "local-xenova:Xenova/all-MiniLM-L6-v2";

/** Underlying Transformers.js model identifier. */
export const LOCAL_XENOVA_ALL_MINILM_UNDERLYING_MODEL =
  "Xenova/all-MiniLM-L6-v2";

/** Vector dimensions produced by the local MiniLM model. */
export const LOCAL_XENOVA_ALL_MINILM_DIMENSIONS = 384;

/** UI display label for the local MiniLM model. Presentation text only. */
export const LOCAL_XENOVA_ALL_MINILM_DISPLAY_NAME =
  "Xenova/all-MiniLM-L6-v2 (free)";

/** Human-readable description for the local MiniLM model. */
export const LOCAL_XENOVA_ALL_MINILM_DESCRIPTION =
  "Local CPU embedding model powered by Transformers.js";

/**
 * Returns every built-in local embedding model. The first release ships exactly
 * one model; the array shape allows additional local models to be added later
 * without changing call sites.
 */
export function getLocalEmbeddingModels(): EmbeddingModelInfo[] {
  return [
    {
      name: LOCAL_XENOVA_ALL_MINILM_MODEL_ID,
      displayName: LOCAL_XENOVA_ALL_MINILM_DISPLAY_NAME,
      description: LOCAL_XENOVA_ALL_MINILM_DESCRIPTION,
      dimensions: LOCAL_XENOVA_ALL_MINILM_DIMENSIONS,
      provider: LOCAL_XENOVA_PROVIDER,
      is_free: true,
      available: true,
      underlyingModel: LOCAL_XENOVA_ALL_MINILM_UNDERLYING_MODEL,
    },
  ];
}

/**
 * Normalize legacy local model IDs (bare underlying/display names) to the
 * canonical namespaced ID. Safe for renderer and main process.
 */
export function normalizeLocalEmbeddingModelId(modelId: string): string {
  const normalized = modelId.trim();
  if (
    normalized === LOCAL_XENOVA_ALL_MINILM_UNDERLYING_MODEL ||
    normalized === LOCAL_XENOVA_ALL_MINILM_DISPLAY_NAME
  ) {
    return LOCAL_XENOVA_ALL_MINILM_MODEL_ID;
  }
  return normalized;
}

/** True when the model ID routes to the local Xenova provider. */
export function isLocalXenovaModelId(
  modelId: string | null | undefined
): boolean {
  if (typeof modelId !== "string" || modelId.length === 0) {
    return false;
  }
  return normalizeLocalEmbeddingModelId(modelId).startsWith(
    LOCAL_XENOVA_PROVIDER_PREFIX
  );
}

