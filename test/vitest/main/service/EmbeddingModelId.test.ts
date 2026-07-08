"use strict";
import { describe, expect, it } from "vitest";
import {
  getEmbeddingProvider,
  getUnderlyingLocalModel,
  isLocalXenovaModel,
  makeVectorModelKey,
  parseStoredEmbeddingModel,
  toPathSafeModelKey,
} from "@/service/embedding/EmbeddingModelId";
import { LOCAL_XENOVA_ALL_MINILM_MODEL_ID } from "@/service/embedding/LocalEmbeddingModels";

describe("EmbeddingModelId", () => {
  describe("getEmbeddingProvider", () => {
    it("resolves a local-xenova model ID to the local provider", () => {
      expect(getEmbeddingProvider(LOCAL_XENOVA_ALL_MINILM_MODEL_ID)).toBe(
        "local-xenova"
      );
    });

    it("resolves a remote model ID to remote-api", () => {
      expect(getEmbeddingProvider("Qwen/Qwen3-Embedding-4B")).toBe("remote-api");
      expect(getEmbeddingProvider("text-embedding-3-small")).toBe("remote-api");
    });

    it("treats empty or non-string input as remote-api", () => {
      expect(getEmbeddingProvider("")).toBe("remote-api");
      expect(getEmbeddingProvider(null)).toBe("remote-api");
      expect(getEmbeddingProvider(undefined)).toBe("remote-api");
    });
  });

  describe("isLocalXenovaModel", () => {
    it("is true for the local model ID", () => {
      expect(isLocalXenovaModel(LOCAL_XENOVA_ALL_MINILM_MODEL_ID)).toBe(true);
    });

    it("is false for remote model IDs", () => {
      expect(isLocalXenovaModel("Qwen/Qwen3-Embedding-4B")).toBe(false);
    });
  });

  describe("getUnderlyingLocalModel", () => {
    it("strips the local-xenova prefix", () => {
      expect(getUnderlyingLocalModel(LOCAL_XENOVA_ALL_MINILM_MODEL_ID)).toBe(
        "Xenova/all-MiniLM-L6-v2"
      );
    });

    it("returns null for remote model IDs", () => {
      expect(getUnderlyingLocalModel("Qwen/Qwen3-Embedding-4B")).toBeNull();
    });

    it("returns null for a malformed local prefix", () => {
      expect(getUnderlyingLocalModel("local-xenova:")).toBeNull();
    });
  });

  describe("toPathSafeModelKey", () => {
    it("produces a key with no '/' or ':' for the local model ID", () => {
      const key = toPathSafeModelKey(LOCAL_XENOVA_ALL_MINILM_MODEL_ID);
      expect(key).not.toContain("/");
      expect(key).not.toContain(":");
      expect(key.startsWith("local-xenova_xenova_all-minilm-l6-v2_")).toBe(true);
    });

    it("is deterministic for the same input", () => {
      expect(toPathSafeModelKey(LOCAL_XENOVA_ALL_MINILM_MODEL_ID)).toBe(
        toPathSafeModelKey(LOCAL_XENOVA_ALL_MINILM_MODEL_ID)
      );
    });

    it("produces distinct keys for distinct model IDs", () => {
      expect(toPathSafeModelKey("local-xenova:Xenova/all-MiniLM-L6-v2")).not.toBe(
        toPathSafeModelKey("text-embedding-3-small")
      );
    });
  });

  describe("makeVectorModelKey", () => {
    it("appends the dimension to the path-safe key", () => {
      const key = makeVectorModelKey(LOCAL_XENOVA_ALL_MINILM_MODEL_ID, 384);
      expect(key.endsWith("_384")).toBe(true);
      expect(key).not.toContain("/");
      expect(key).not.toContain(":");
    });
  });

  describe("parseStoredEmbeddingModel", () => {
    it("parses a remote stored value with a slash in the model name", () => {
      expect(parseStoredEmbeddingModel("Qwen/Qwen3-Embedding-4B:2560")).toEqual({
        modelName: "Qwen/Qwen3-Embedding-4B",
        dimension: 2560,
      });
    });

    it("parses a local namespaced stored value that contains multiple colons", () => {
      expect(
        parseStoredEmbeddingModel(
          "local-xenova:Xenova/all-MiniLM-L6-v2:384"
        )
      ).toEqual({
        modelName: "local-xenova:Xenova/all-MiniLM-L6-v2",
        dimension: 384,
      });
    });

    it("returns null for a value without a dimension", () => {
      expect(parseStoredEmbeddingModel("some-model")).toBeNull();
    });

    it("returns null for a non-positive dimension", () => {
      expect(parseStoredEmbeddingModel("some-model:0")).toBeNull();
      expect(parseStoredEmbeddingModel("some-model:-3")).toBeNull();
    });

    it("returns null for empty input", () => {
      expect(parseStoredEmbeddingModel("")).toBeNull();
      expect(parseStoredEmbeddingModel(null)).toBeNull();
      expect(parseStoredEmbeddingModel(undefined)).toBeNull();
    });
  });
});
