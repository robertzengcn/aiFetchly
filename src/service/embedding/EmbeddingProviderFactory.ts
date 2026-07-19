"use strict";
import type { EmbeddingProvider } from "@/service/embedding/EmbeddingProvider";
import { RemoteEmbeddingProvider } from "@/service/embedding/RemoteEmbeddingProvider";
import { LocalXenovaEmbeddingProvider } from "@/service/embedding/LocalXenovaEmbeddingProvider";
import { RagConfigApi } from "@/api/ragConfigApi";
import { LocalEmbeddingWorkerClient } from "@/service/embedding/LocalEmbeddingWorkerClient";
import { isLocalXenovaModel } from "@/service/embedding/EmbeddingModelId";

/**
 * Optional dependency injection seam for the factory. In production both
 * defaults are used; tests inject fakes.
 */
export interface EmbeddingProviderDeps {
  ragConfigApi?: RagConfigApi;
  workerClient?: LocalEmbeddingWorkerClient;
}

/**
 * Routes a model ID to the correct embedding provider.
 *
 *   local-xenova:* -> LocalXenovaEmbeddingProvider (child worker)
 *   anything else  -> RemoteEmbeddingProvider (remote AI server)
 */
export class EmbeddingProviderFactory {
  constructor(private readonly deps: EmbeddingProviderDeps = {}) {}

  create(modelName: string, dimensions: number): EmbeddingProvider {
    if (isLocalXenovaModel(modelName)) {
      return new LocalXenovaEmbeddingProvider(
        modelName,
        dimensions,
        this.deps.workerClient
      );
    }
    return new RemoteEmbeddingProvider(
      modelName,
      dimensions,
      this.deps.ragConfigApi
    );
  }
}
