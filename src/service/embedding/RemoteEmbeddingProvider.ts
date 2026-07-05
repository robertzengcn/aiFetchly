"use strict";
import { RagConfigApi } from "@/api/ragConfigApi";
import type { EmbeddingResult as ApiEmbeddingResult } from "@/api/ragConfigApi";
import type {
  EmbeddingProviderKind,
  EmbeddingResult,
} from "@/entityTypes/embeddingTypes";
import type { EmbeddingProvider } from "@/service/embedding/EmbeddingProvider";

/**
 * Embedding provider that delegates to the remote AI server via
 * `RagConfigApi.generateEmbedding`. Used for every non-local model ID.
 */
export class RemoteEmbeddingProvider implements EmbeddingProvider {
  readonly provider: EmbeddingProviderKind = "remote-api";

  constructor(
    readonly modelName: string,
    readonly dimensions: number,
    private readonly ragConfigApi: RagConfigApi = new RagConfigApi()
  ) {}

  async embedText(text: string): Promise<EmbeddingResult> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    if (texts.length === 0) {
      return [];
    }
    const response = await this.ragConfigApi.generateEmbedding(
      texts,
      this.modelName
    );
    if (!response.status || !response.data) {
      throw new Error(
        response.msg || "Remote embedding request failed"
      );
    }
    return response.data.map(
      (item: ApiEmbeddingResult): EmbeddingResult => ({
        text: item.text,
        embedding: item.embedding,
        dimensions: item.dimensions,
        model: item.model,
        provider: "remote-api",
      })
    );
  }
}
