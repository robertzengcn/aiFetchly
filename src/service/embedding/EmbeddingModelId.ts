"use strict";
import { createHash } from "node:crypto";
import type { EmbeddingProviderKind } from "@/entityTypes/embeddingTypes";
import {
  LOCAL_XENOVA_ALL_MINILM_DISPLAY_NAME,
  LOCAL_XENOVA_ALL_MINILM_MODEL_ID,
  LOCAL_XENOVA_ALL_MINILM_UNDERLYING_MODEL,
  LOCAL_XENOVA_PROVIDER,
  LOCAL_XENOVA_PROVIDER_PREFIX,
} from "@/service/embedding/LocalEmbeddingModels";

/**
 * Normalize model IDs that were persisted by older versions of the app.
 * Local models were initially exposed using their display/underlying name;
 * those values must be upgraded before provider routing takes place.
 */
export function normalizeEmbeddingModelId(modelId: string): string {
  const normalized = modelId.trim();
  if (
    normalized === LOCAL_XENOVA_ALL_MINILM_UNDERLYING_MODEL ||
    normalized === LOCAL_XENOVA_ALL_MINILM_DISPLAY_NAME
  ) {
    return LOCAL_XENOVA_ALL_MINILM_MODEL_ID;
  }
  return normalized;
}

/**
 * Helpers for embedding model identifiers.
 *
 * Model IDs are load-bearing: they drive provider routing, vector index
 * filenames, persisted document metadata, and query-time model grouping. The
 * `(free)` suffix and other display text must never be parsed for routing —
 * only the stable namespaced ID is meaningful here.
 */

/**
 * Resolve the provider responsible for a model ID.
 *
 * `local-xenova:*` IDs route to the local provider; everything else is treated
 * as a remote API model.
 */
export function getEmbeddingProvider(
  modelId: string | null | undefined
): EmbeddingProviderKind {
  if (typeof modelId !== "string" || modelId.length === 0) {
    return "remote-api";
  }
  if (
    normalizeEmbeddingModelId(modelId).startsWith(LOCAL_XENOVA_PROVIDER_PREFIX)
  ) {
    return LOCAL_XENOVA_PROVIDER;
  }
  return "remote-api";
}

/** True when the model ID routes to the local Xenova provider. */
export function isLocalXenovaModel(modelId: string | null | undefined): boolean {
  return getEmbeddingProvider(modelId) === LOCAL_XENOVA_PROVIDER;
}

/**
 * Extract the underlying Transformers.js model identifier from a local model ID.
 * Returns null for remote model IDs or malformed local IDs.
 *
 * Example: "local-xenova:Xenova/all-MiniLM-L6-v2" -> "Xenova/all-MiniLM-L6-v2"
 */
export function getUnderlyingLocalModel(
  modelId: string | null | undefined
): string | null {
  if (!isLocalXenovaModel(modelId)) {
    return null;
  }
  const canonicalModelId = normalizeEmbeddingModelId(modelId as string);
  const underlying = canonicalModelId.slice(
    LOCAL_XENOVA_PROVIDER_PREFIX.length
  );
  return underlying.length > 0 ? underlying : null;
}

/**
 * Convert a model ID into a deterministic, filesystem-safe key.
 *
 * Model IDs contain `/` and `:` which are unsafe in filenames. This produces a
 * lowercase key with non `[a-z0-9._-]` characters collapsed to `_` plus a short
 * SHA-256 suffix of the original ID to guarantee uniqueness and avoid
 * collisions between similarly-named models.
 *
 * Example: "local-xenova:Xenova/all-MiniLM-L6-v2"
 *          -> "local-xenova_xenova_all-minilm-l6-v2_a1b2c3d4"
 */
export function toPathSafeModelKey(modelId: string): string {
  const sanitized = modelId
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const hash = createHash("sha256").update(modelId).digest("hex").slice(0, 8);
  return `${sanitized}_${hash}`;
}

/**
 * Build the deterministic vector-store key for a model + dimension pair.
 * Used wherever a vector index must be named or looked up by model.
 */
export function makeVectorModelKey(modelId: string, dimensions: number): string {
  return `${toPathSafeModelKey(modelId)}_${dimensions}`;
}

/**
 * Parse a persisted `"modelName:dimension"` setting value by splitting on the
 * LAST colon.
 *
 * Splitting on the last colon (rather than every colon) lets model IDs
 * themselves contain colons, which the local namespaced IDs do:
 *
 *   "local-xenova:Xenova/all-MiniLM-L6-v2:384"
 *   -> modelName="local-xenova:Xenova/all-MiniLM-L6-v2", dimension=384
 *
 * Returns null for malformed input so callers can fall back to a default.
 */
export function parseStoredEmbeddingModel(
  value: string | null | undefined
): { modelName: string; dimension: number } | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const separatorIndex = value.lastIndexOf(":");
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    return null;
  }
  const modelName = value.slice(0, separatorIndex).trim();
  const dimensionStr = value.slice(separatorIndex + 1).trim();
  if (modelName.length === 0) {
    return null;
  }
  const dimension = Number.parseInt(dimensionStr, 10);
  if (Number.isNaN(dimension) || dimension <= 0) {
    return null;
  }
  return { modelName, dimension };
}
