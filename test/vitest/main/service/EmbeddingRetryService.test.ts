"use strict";
import { describe, expect, it } from "vitest";
import { EmbeddingRetryService } from "@/service/embedding/EmbeddingRetryService";
import type { EmbeddingProvider } from "@/service/embedding/EmbeddingProvider";

function makeProvider(
  impl: (texts: string[]) => Promise<number>
): EmbeddingProvider {
  return {
    provider: "remote-api",
    modelName: "remote-model",
    dimensions: 8,
    embedText: (text: string) =>
      impl([text]).then((n) => ({
        text,
        embedding: [n],
        dimensions: 8,
        model: "remote-model",
        provider: "remote-api" as const,
      })),
    embedBatch: (texts: string[]) =>
      impl(texts).then((n) =>
        texts.map((text) => ({
          text,
          embedding: [n],
          dimensions: 8,
          model: "remote-model",
          provider: "remote-api" as const,
        }))
      ),
  };
}

describe("EmbeddingRetryService", () => {
  it("returns the result on the first successful attempt without sleeping", async () => {
    const sleeps: number[] = [];
    const retry = new EmbeddingRetryService(
      { maxAttempts: 3, delaysMs: [500, 1500] },
      async (ms) => {
        sleeps.push(ms);
      }
    );
    const provider = makeProvider(async () => 42);

    const result = await retry.embedBatch(provider, ["a"]);
    expect(result[0].embedding).toEqual([42]);
    expect(sleeps).toHaveLength(0);
  });

  it("retries a retryable failure and succeeds on a later attempt", async () => {
    const sleeps: number[] = [];
    const retry = new EmbeddingRetryService(
      { maxAttempts: 3, delaysMs: [500, 1500] },
      async (ms) => {
        sleeps.push(ms);
      }
    );
    let attempts = 0;
    const provider = makeProvider(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("network timeout");
      }
      return 7;
    });

    const result = await retry.embedBatch(provider, ["a"]);
    expect(result[0].embedding).toEqual([7]);
    expect(attempts).toBe(3);
    expect(sleeps).toEqual([500, 1500]);
  });

  it("throws after exhausting retries for a persistently retryable failure", async () => {
    const retry = new EmbeddingRetryService(
      { maxAttempts: 3, delaysMs: [10, 20] },
      async (_ms: number) => {
        void _ms;
      }
    );
    let attempts = 0;
    const provider = makeProvider(async () => {
      attempts++;
      throw new Error("500 internal server error");
    });

    await expect(retry.embedBatch(provider, ["a"])).rejects.toThrow(
      "500 internal server error"
    );
    expect(attempts).toBe(3);
  });

  it("does not retry non-retryable (entitlement) failures", async () => {
    const retry = new EmbeddingRetryService(
      { maxAttempts: 3, delaysMs: [10, 20] },
      async (_ms: number) => {
        void _ms;
      }
    );
    let attempts = 0;
    const provider = makeProvider(async () => {
      attempts++;
      throw new Error("AI features are not enabled. Please upgrade your plan.");
    });

    await expect(retry.embedBatch(provider, ["a"])).rejects.toThrow(
      "not enabled"
    );
    expect(attempts).toBe(1);
  });

  it("does not retry an invalid-model error", async () => {
    const retry = new EmbeddingRetryService(
      { maxAttempts: 3, delaysMs: [10, 20] },
      async (_ms: number) => {
        void _ms;
      }
    );
    let attempts = 0;
    const provider = makeProvider(async () => {
      attempts++;
      throw new Error("Invalid model name 'bogus'");
    });

    await expect(retry.embedBatch(provider, ["a"])).rejects.toThrow(
      "Invalid model"
    );
    expect(attempts).toBe(1);
  });
});
