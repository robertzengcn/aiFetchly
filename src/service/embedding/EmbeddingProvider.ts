"use strict";
import type {
  EmbeddingProviderKind,
  EmbeddingResult,
} from "@/entityTypes/embeddingTypes";

/**
 * Provider-agnostic embedding interface. Both the remote AI server and the
 * local Xenova worker are wrapped behind this contract so RAG orchestration
 * code can route by model ID without knowing the transport.
 */
export interface EmbeddingProvider {
  /** Provider responsible for generating embeddings. */
  readonly provider: EmbeddingProviderKind;
  /** Stable model ID used for routing and persisted metadata. */
  readonly modelName: string;
  /** Vector dimensions this provider produces. */
  readonly dimensions: number;
  /** Embed a single text (e.g. a search query). */
  embedText(text: string): Promise<EmbeddingResult>;
  /** Embed a batch of texts (e.g. document chunks). */
  embedBatch(texts: string[]): Promise<EmbeddingResult[]>;
}
