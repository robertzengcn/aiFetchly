"use strict";
import { describe, expect, it } from "vitest";
import {
  underlyingModelFromModelId,
  validateBatchTexts,
  validateEmbeddingMatrix,
} from "@/childprocess/embedding/LocalEmbeddingValidation";
import {
  LOCAL_EMBEDDING_MAX_BATCH_SIZE,
  LOCAL_EMBEDDING_MAX_CHARS_PER_ITEM,
} from "@/childprocess/embedding/LocalEmbeddingWorkerTypes";
import { LOCAL_XENOVA_ALL_MINILM_DIMENSIONS } from "@/service/embedding/LocalEmbeddingModels";

function row(value: number, length = LOCAL_XENOVA_ALL_MINILM_DIMENSIONS): number[] {
  return new Array(length).fill(value);
}

describe("LocalEmbeddingValidation", () => {
  describe("validateBatchTexts", () => {
    it("accepts a valid non-empty string array", () => {
      expect(validateBatchTexts(["a", "b"])).toEqual(["a", "b"]);
    });

    it("rejects a non-array", () => {
      expect(() => validateBatchTexts("not-array")).toThrow();
      expect(() => validateBatchTexts({})).toThrow();
    });

    it("rejects an empty array", () => {
      expect(() => validateBatchTexts([])).toThrow("empty");
    });

    it("rejects a batch larger than the maximum", () => {
      const oversized = new Array(LOCAL_EMBEDDING_MAX_BATCH_SIZE + 1).fill("x");
      expect(() => validateBatchTexts(oversized)).toThrow("exceeds maximum");
    });

    it("rejects non-string items", () => {
      expect(() => validateBatchTexts(["a", 42 as unknown])).toThrow(
        "is not a string"
      );
    });

    it("rejects items exceeding the max character length", () => {
      const tooLong = "x".repeat(LOCAL_EMBEDDING_MAX_CHARS_PER_ITEM + 1);
      expect(() => validateBatchTexts([tooLong])).toThrow("exceeds");
    });
  });

  describe("validateEmbeddingMatrix", () => {
    it("accepts a finite matrix with the expected shape", () => {
      const matrix = [row(0.1), row(0.2)];
      const result = validateEmbeddingMatrix(matrix, 2);
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveLength(LOCAL_XENOVA_ALL_MINILM_DIMENSIONS);
    });

    it("rejects a non-array", () => {
      expect(() => validateEmbeddingMatrix("nope", 1)).toThrow("not an array");
    });

    it("rejects a row count mismatch", () => {
      expect(() => validateEmbeddingMatrix([row(0.1)], 2)).toThrow(
        "row count"
      );
    });

    it("rejects a row whose dimension is not 384", () => {
      const badRow = new Array(LOCAL_XENOVA_ALL_MINILM_DIMENSIONS - 1).fill(0.1);
      expect(() => validateEmbeddingMatrix([badRow], 1)).toThrow("dimensions");
    });

    it("rejects non-finite values", () => {
      const badRow = row(0.1);
      badRow[5] = Number.NaN;
      expect(() => validateEmbeddingMatrix([badRow], 1)).toThrow(
        "not a finite number"
      );
    });

    it("rejects a non-numeric value", () => {
      const badRow = row(0.1);
      badRow[3] = "x" as unknown as number;
      expect(() => validateEmbeddingMatrix([badRow], 1)).toThrow(
        "not a finite number"
      );
    });
  });

  describe("underlyingModelFromModelId", () => {
    it("strips the local-xenova prefix", () => {
      expect(
        underlyingModelFromModelId("local-xenova:Xenova/all-MiniLM-L6-v2")
      ).toBe("Xenova/all-MiniLM-L6-v2");
    });

    it("falls back to the MiniLM model for an unknown prefix", () => {
      expect(underlyingModelFromModelId("something-else:foo")).toBe(
        "Xenova/all-MiniLM-L6-v2"
      );
    });
  });
});
