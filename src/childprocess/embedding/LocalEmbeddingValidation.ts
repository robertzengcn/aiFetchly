"use strict";
import {
  LOCAL_EMBEDDING_MAX_BATCH_SIZE,
  LOCAL_EMBEDDING_MAX_CHARS_PER_ITEM,
} from "@/childprocess/embedding/LocalEmbeddingWorkerTypes";
import { LOCAL_XENOVA_ALL_MINILM_DIMENSIONS } from "@/service/embedding/LocalEmbeddingModels";

/**
 * Pure validation helpers for the local embedding worker.
 *
 * Extracted from the worker entry point so they can be unit-tested without
 * spawning a process. These enforce the worker's input and output boundaries:
 * inbound text batches are bounded and well-typed, and produced vectors match
 * the expected MiniLM shape with finite values.
 */

/**
 * Validate and normalize an inbound `texts` array.
 * @throws Error when the value is not a non-empty array of strings within limits.
 */
export function validateBatchTexts(texts: unknown): string[] {
  if (!Array.isArray(texts)) {
    throw new Error("texts must be an array");
  }
  if (texts.length === 0) {
    throw new Error("texts must not be empty");
  }
  if (texts.length > LOCAL_EMBEDDING_MAX_BATCH_SIZE) {
    throw new Error(
      `Batch size ${texts.length} exceeds maximum ${LOCAL_EMBEDDING_MAX_BATCH_SIZE}`
    );
  }
  const result: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    const item = texts[i];
    if (typeof item !== "string") {
      throw new Error(`texts[${i}] is not a string`);
    }
    if (item.length > LOCAL_EMBEDDING_MAX_CHARS_PER_ITEM) {
      throw new Error(
        `texts[${i}] exceeds ${LOCAL_EMBEDDING_MAX_CHARS_PER_ITEM} characters`
      );
    }
    result.push(item);
  }
  return result;
}

/**
 * Validate that a transformers.js tensor output is a finite 2D number matrix
 * with the expected row count and per-row MiniLM dimension (384).
 * @throws Error when the shape is wrong or any value is non-finite.
 */
export function validateEmbeddingMatrix(
  raw: unknown,
  expectedRowCount: number
): number[][] {
  if (!Array.isArray(raw)) {
    throw new Error("Embedding output is not an array");
  }
  if (raw.length !== expectedRowCount) {
    throw new Error(
      `Embedding row count ${raw.length} does not match input count ${expectedRowCount}`
    );
  }
  const result: number[][] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (!Array.isArray(row)) {
      throw new Error(`Embedding row ${i} is not an array`);
    }
    if (row.length !== LOCAL_XENOVA_ALL_MINILM_DIMENSIONS) {
      throw new Error(
        `Embedding row ${i} has ${row.length} dimensions; expected ${LOCAL_XENOVA_ALL_MINILM_DIMENSIONS}`
      );
    }
    const numericRow: number[] = [];
    for (let j = 0; j < row.length; j++) {
      const value = row[j];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(
          `Embedding row ${i} column ${j} is not a finite number`
        );
      }
      numericRow.push(value);
    }
    result.push(numericRow);
  }
  return result;
}

/**
 * Extract the underlying Transformers.js model id from a namespaced local id.
 * The first release ships only `local-xenova:Xenova/all-MiniLM-L6-v2`, so an
 * unknown prefix safely falls back to the MiniLM model.
 */
export function underlyingModelFromModelId(modelId: string): string {
  const prefix = "local-xenova:";
  if (modelId.startsWith(prefix)) {
    const stripped = modelId.slice(prefix.length);
    if (stripped.length > 0) {
      return stripped;
    }
  }
  return "Xenova/all-MiniLM-L6-v2";
}
