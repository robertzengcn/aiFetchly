"use strict";
import { describe, expect, it, vi } from "vitest";
import { EmbeddingModelCatalogService } from "@/service/embedding/EmbeddingModelCatalogService";
import type { DefaultModelProvider } from "@/service/embedding/EmbeddingModelCatalogService";
import type { RagConfigApi } from "@/api/ragConfigApi";
import {
  LOCAL_XENOVA_ALL_MINILM_DIMENSIONS,
  LOCAL_XENOVA_ALL_MINILM_MODEL_ID,
} from "@/service/embedding/LocalEmbeddingModels";

function makeRemoteModelsResponse() {
  return {
    status: true,
    code: 200,
    msg: "ok",
    data: {
      models: {
        "Qwen/Qwen3-Embedding-4B": {
          name: "Qwen/Qwen3-Embedding-4B",
          description: "remote qwen",
          dimensions: 2560,
        },
        "text-embedding-3-small": {
          name: "text-embedding-3-small",
          description: "remote openai",
          dimensions: 1536,
          is_free: true,
        },
      },
      default_model: "Qwen/Qwen3-Embedding-4B",
      default_dimensions: 2560,
      total_models: 2,
      configured_models: 2,
    },
  };
}

function makeRagConfigApiStub(
  getAvailableEmbeddingModels: () => Promise<unknown>
): RagConfigApi {
  return {
    getAvailableEmbeddingModels,
  } as unknown as RagConfigApi;
}

function makeDefaultProvider(
  getDefaultEmbeddingModel: () => Promise<{
    modelName: string;
    dimension: number;
  } | null>
): DefaultModelProvider {
  return { getDefaultEmbeddingModel };
}

describe("EmbeddingModelCatalogService", () => {
  it("appends exactly one local model to the remote response", async () => {
    const api = makeRagConfigApiStub(async () => makeRemoteModelsResponse());
    const catalog = new EmbeddingModelCatalogService(
      api,
      makeDefaultProvider(async () => null)
    );

    const list = await catalog.listModels();

    expect(Object.keys(list.models)).toContain("Qwen/Qwen3-Embedding-4B");
    expect(Object.keys(list.models)).toContain("text-embedding-3-small");
    expect(Object.keys(list.models)).toContain(LOCAL_XENOVA_ALL_MINILM_MODEL_ID);
    const localIds = Object.keys(list.models).filter(
      (id) => id === LOCAL_XENOVA_ALL_MINILM_MODEL_ID
    );
    expect(localIds).toHaveLength(1);
  });

  it("returns the local model with 384 dimensions and is_free true", async () => {
    const api = makeRagConfigApiStub(async () => makeRemoteModelsResponse());
    const catalog = new EmbeddingModelCatalogService(
      api,
      makeDefaultProvider(async () => null)
    );

    const list = await catalog.listModels();
    const local = list.models[LOCAL_XENOVA_ALL_MINILM_MODEL_ID];

    expect(local).toBeDefined();
    expect(local?.dimensions).toBe(LOCAL_XENOVA_ALL_MINILM_DIMENSIONS);
    expect(local?.is_free).toBe(true);
    expect(local?.provider).toBe("local-xenova");
    expect(local?.available).toBe(true);
    expect(local?.displayName).toBe("Xenova/all-MiniLM-L6-v2 (free)");
  });

  it("normalizes remote models with provider remote-api and available true", async () => {
    const api = makeRagConfigApiStub(async () => makeRemoteModelsResponse());
    const catalog = new EmbeddingModelCatalogService(
      api,
      makeDefaultProvider(async () => null)
    );

    const list = await catalog.listModels();
    const remote = list.models["Qwen/Qwen3-Embedding-4B"];

    expect(remote?.provider).toBe("remote-api");
    expect(remote?.available).toBe(true);
    expect(remote?.is_free).toBe(false);
    expect(remote?.displayName).toBe("Qwen/Qwen3-Embedding-4B");
  });

  it("returns a local-only catalog when the remote API throws", async () => {
    const api = makeRagConfigApiStub(async () => {
      throw new Error("network down");
    });
    const catalog = new EmbeddingModelCatalogService(
      api,
      makeDefaultProvider(async () => null)
    );

    const list = await catalog.listModels();

    expect(Object.keys(list.models)).toEqual([LOCAL_XENOVA_ALL_MINILM_MODEL_ID]);
    expect(list.total_models).toBe(1);
    expect(list.default_model).toBe(LOCAL_XENOVA_ALL_MINILM_MODEL_ID);
  });

  it("returns a local-only catalog when the remote response is unsuccessful", async () => {
    const api = makeRagConfigApiStub(async () => ({
      status: false,
      code: 500,
      msg: "server error",
      data: undefined,
    }));
    const catalog = new EmbeddingModelCatalogService(
      api,
      makeDefaultProvider(async () => null)
    );

    const list = await catalog.listModels();
    expect(Object.keys(list.models)).toEqual([LOCAL_XENOVA_ALL_MINILM_MODEL_ID]);
  });

  it("does not contact the remote API when remote models are disabled", async () => {
    const getAvailableEmbeddingModels = vi.fn(async () =>
      makeRemoteModelsResponse()
    );
    const api = makeRagConfigApiStub(getAvailableEmbeddingModels);
    const catalog = new EmbeddingModelCatalogService(
      api,
      makeDefaultProvider(async () => null)
    );

    const list = await catalog.listModels({ includeRemote: false });

    expect(getAvailableEmbeddingModels).not.toHaveBeenCalled();
    expect(Object.keys(list.models)).toEqual([LOCAL_XENOVA_ALL_MINILM_MODEL_ID]);
    expect(list.default_model).toBe(LOCAL_XENOVA_ALL_MINILM_MODEL_ID);
    expect(list.models[LOCAL_XENOVA_ALL_MINILM_MODEL_ID]?.dimensions).toBe(384);
  });

  it("prefers the persisted default when it exists in the merged list", async () => {
    const api = makeRagConfigApiStub(async () => makeRemoteModelsResponse());
    const catalog = new EmbeddingModelCatalogService(
      api,
      makeDefaultProvider(async () => ({
        modelName: "text-embedding-3-small",
        dimension: 1536,
      }))
    );

    const list = await catalog.listModels();
    expect(list.default_model).toBe("text-embedding-3-small");
  });

  it("falls back to the remote default when no persisted setting exists", async () => {
    const api = makeRagConfigApiStub(async () => makeRemoteModelsResponse());
    const catalog = new EmbeddingModelCatalogService(
      api,
      makeDefaultProvider(async () => null)
    );

    const list = await catalog.listModels();
    expect(list.default_model).toBe("Qwen/Qwen3-Embedding-4B");
  });

  it("getModel resolves a local model without calling the remote API", async () => {
    const spy = vi.fn(async () => makeRemoteModelsResponse());
    const api = makeRagConfigApiStub(spy);
    const catalog = new EmbeddingModelCatalogService(
      api,
      makeDefaultProvider(async () => null)
    );

    const model = await catalog.getModel(LOCAL_XENOVA_ALL_MINILM_MODEL_ID);

    expect(model?.name).toBe(LOCAL_XENOVA_ALL_MINILM_MODEL_ID);
    expect(model?.dimensions).toBe(LOCAL_XENOVA_ALL_MINILM_DIMENSIONS);
    expect(spy).not.toHaveBeenCalled();
  });

  it("getModel returns null for an unknown remote model", async () => {
    const api = makeRagConfigApiStub(async () => makeRemoteModelsResponse());
    const catalog = new EmbeddingModelCatalogService(
      api,
      makeDefaultProvider(async () => null)
    );

    const model = await catalog.getModel("does-not-exist");
    expect(model).toBeNull();
  });

  it("isLocalModel matches the local provider prefix", () => {
    const catalog = new EmbeddingModelCatalogService(
      makeRagConfigApiStub(async () => makeRemoteModelsResponse()),
      makeDefaultProvider(async () => null)
    );
    expect(catalog.isLocalModel(LOCAL_XENOVA_ALL_MINILM_MODEL_ID)).toBe(true);
    expect(catalog.isLocalModel("Qwen/Qwen3-Embedding-4B")).toBe(false);
  });
});
