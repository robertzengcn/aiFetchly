"use strict";
import type {
  EmbeddingProviderKind,
  EmbeddingResult,
} from "@/entityTypes/embeddingTypes";
import type { EmbeddingProvider } from "@/service/embedding/EmbeddingProvider";
import { LocalEmbeddingWorkerClient } from "@/service/embedding/LocalEmbeddingWorkerClient";

/**
 * Embedding provider that runs `@xenova/transformers` in a child worker process
 * via `LocalEmbeddingWorkerClient`. Used for every `local-xenova:*` model ID.
 *
 * The provider holds no model state itself — the worker caches the pipeline.
 */
export class LocalXenovaEmbeddingProvider implements EmbeddingProvider {
  readonly provider: EmbeddingProviderKind = "local-xenova";

  constructor(
    readonly modelName: string,
    readonly dimensions: number,
    private readonly workerClient: LocalEmbeddingWorkerClient = LocalEmbeddingWorkerClient.getInstance()
  ) {}

  async embedText(text: string): Promise<EmbeddingResult> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    if (texts.length === 0) {
      return [];
    }
    const result = await this.workerClient.embedBatch(this.modelName, texts);
    return result.embeddings.map(
      (embedding: number[], index: number): EmbeddingResult => ({
        text: texts[index] ?? "",
        embedding,
        dimensions: result.dimensions,
        model: this.modelName,
        provider: "local-xenova",
      })
    );
  }
}
