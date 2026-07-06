"use strict";
import { describe, expect, it, beforeEach, vi } from "vitest";

// Shared spies so the hoisted module mock can report what the local provider
// actually did.
const spies = vi.hoisted(() => ({
  localEmbedText: vi.fn(),
  factoryCreate: vi.fn(),
}));

// Stub local provider returned by the mocked factory.
const stubLocalProvider = {
  provider: "local-xenova" as const,
  modelName: "local-xenova:Xenova/all-MiniLM-L6-v2",
  dimensions: 384,
  embedText: spies.localEmbedText,
  embedBatch: vi.fn(),
};

vi.mock("@/service/embedding/EmbeddingProviderFactory", () => ({
  EmbeddingProviderFactory: vi.fn().mockImplementation(() => ({
    create: spies.factoryCreate.mockReturnValue(stubLocalProvider),
  })),
}));

vi.mock("@/service/VectorStoreService", () => ({
  VectorStoreService: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    isInitialized: vi.fn().mockReturnValue(true),
  })),
}));

vi.mock("@/api/ragConfigApi", () => ({
  RagConfigApi: vi.fn().mockImplementation(() => ({
    getAvailableEmbeddingModels: vi.fn().mockResolvedValue({
      status: true,
      code: 200,
      msg: "ok",
      data: {
        models: {
          "Qwen/Qwen3-Embedding-4B": {
            name: "Qwen/Qwen3-Embedding-4B",
            description: "remote",
            dimensions: 2560,
          },
        },
        default_model: "Qwen/Qwen3-Embedding-4B",
        total_models: 1,
        configured_models: 1,
      },
    }),
    generateEmbedding: vi.fn().mockResolvedValue({
      status: true,
      code: 200,
      msg: "ok",
      data: [
        {
          text: "query",
          embedding: new Array(2560).fill(0.2),
          dimensions: 2560,
          model: "Qwen/Qwen3-Embedding-4B",
        },
      ],
    }),
  })),
}));

import { VectorSearchService } from "@/service/VectorSearchService";
import { VectorStoreService } from "@/service/VectorStoreService";
import { LOCAL_XENOVA_ALL_MINILM_MODEL_ID } from "@/service/embedding/LocalEmbeddingModels";

interface QueryEmbeddingAccessor {
  generateQueryEmbeddingForModel(
    query: string,
    modelName: string,
    expectedDimensions: number
  ): Promise<number[] | null>;
}

describe("VectorSearchService query provider routing", () => {
  let service: VectorSearchService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default local provider success.
    spies.localEmbedText.mockResolvedValue({
      text: "query",
      embedding: new Array(384).fill(0.1),
      dimensions: 384,
      model: LOCAL_XENOVA_ALL_MINILM_MODEL_ID,
      provider: "local-xenova",
    });
    service = new VectorSearchService(new VectorStoreService());
  });

  it("uses the local provider for a local-indexed model", async () => {
    const accessor = service as unknown as QueryEmbeddingAccessor;
    const vector = await accessor.generateQueryEmbeddingForModel(
      "query",
      LOCAL_XENOVA_ALL_MINILM_MODEL_ID,
      384
    );

    expect(spies.factoryCreate).toHaveBeenCalled();
    expect(spies.localEmbedText).toHaveBeenCalledWith("query");
    expect(vector).toHaveLength(384);
  });

  it("does not use the local provider for a remote-indexed model", async () => {
    const accessor = service as unknown as QueryEmbeddingAccessor;
    const vector = await accessor.generateQueryEmbeddingForModel(
      "query",
      "Qwen/Qwen3-Embedding-4B",
      2560
    );

    // Remote model goes through the existing remote candidate path; the local
    // provider must not be invoked.
    expect(spies.factoryCreate).not.toHaveBeenCalled();
    expect(spies.localEmbedText).not.toHaveBeenCalled();
    expect(vector).toHaveLength(2560);
  });

  it("returns null (skip) when the local provider throws", async () => {
    spies.localEmbedText.mockRejectedValue(new Error("worker unavailable"));
    const accessor = service as unknown as QueryEmbeddingAccessor;
    const vector = await accessor.generateQueryEmbeddingForModel(
      "query",
      LOCAL_XENOVA_ALL_MINILM_MODEL_ID,
      384
    );
    expect(vector).toBeNull();
  });
});
