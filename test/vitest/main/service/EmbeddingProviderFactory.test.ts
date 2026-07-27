"use strict";
import { describe, expect, it } from "vitest";
import { EmbeddingProviderFactory } from "@/service/embedding/EmbeddingProviderFactory";
import { LocalXenovaEmbeddingProvider } from "@/service/embedding/LocalXenovaEmbeddingProvider";
import { RemoteEmbeddingProvider } from "@/service/embedding/RemoteEmbeddingProvider";
import {
  LOCAL_XENOVA_ALL_MINILM_MODEL_ID,
  LOCAL_XENOVA_ALL_MINILM_UNDERLYING_MODEL,
} from "@/service/embedding/LocalEmbeddingModels";

describe("EmbeddingProviderFactory", () => {
  it("returns a local provider for a local-xenova model ID", () => {
    const factory = new EmbeddingProviderFactory();
    const provider = factory.create(LOCAL_XENOVA_ALL_MINILM_MODEL_ID, 384);
    expect(provider).toBeInstanceOf(LocalXenovaEmbeddingProvider);
    expect(provider.provider).toBe("local-xenova");
    expect(provider.modelName).toBe(LOCAL_XENOVA_ALL_MINILM_MODEL_ID);
    expect(provider.dimensions).toBe(384);
  });

  it("returns a remote provider for a remote model ID", () => {
    const factory = new EmbeddingProviderFactory();
    const provider = factory.create("Qwen/Qwen3-Embedding-4B", 2560);
    expect(provider).toBeInstanceOf(RemoteEmbeddingProvider);
    expect(provider.provider).toBe("remote-api");
    expect(provider.modelName).toBe("Qwen/Qwen3-Embedding-4B");
    expect(provider.dimensions).toBe(2560);
  });

  it("canonicalizes legacy local model names before constructing the provider", () => {
    const factory = new EmbeddingProviderFactory();
    const provider = factory.create(LOCAL_XENOVA_ALL_MINILM_UNDERLYING_MODEL, 384);
    expect(provider).toBeInstanceOf(LocalXenovaEmbeddingProvider);
    expect(provider.provider).toBe("local-xenova");
    expect(provider.modelName).toBe(LOCAL_XENOVA_ALL_MINILM_MODEL_ID);
  });

  it("passes injected dependencies through to the constructed provider", () => {
    const fakeApi = { generateEmbedding: () => undefined } as unknown;
    const factory = new EmbeddingProviderFactory({
      ragConfigApi: fakeApi as never,
    });
    const provider = factory.create("text-embedding-3-small", 1536);
    expect(provider).toBeInstanceOf(RemoteEmbeddingProvider);
  });
});
