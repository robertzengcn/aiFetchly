import { describe, it, expect } from "vitest";
import { OpenAICompatibleProviderClient } from "@/service/aiProvider/OpenAICompatibleProviderClient";
import { AIProviderError } from "@/service/aiProvider/AIProviderError";
import type { LocalAIProviderConfig } from "@/entityTypes/aiProviderTypes";

const CONFIG: LocalAIProviderConfig = {
  preset: "ollama",
  name: "Ollama",
  baseUrl: "http://localhost:11434/v1",
  defaultModel: "llama3.1",
  apiKeyConfigured: false,
};

/**
 * A fetch that never resolves on its own but honors the AbortSignal (like real
 * fetch), so the client's timeout/abort wiring can unblock it. Simulates a
 * provider that accepts the connection then never responds.
 */
function signalAwareHangingFetch(): typeof fetch {
  return ((url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const sig = init?.signal as AbortSignal | undefined;
      const fail = (): void => {
        const err = new Error("The operation was aborted.");
        err.name = "AbortError";
        reject(err);
      };
      if (sig) {
        if (sig.aborted) {
          fail();
        } else {
          sig.addEventListener("abort", fail, { once: true });
        }
      }
      // otherwise: never resolves
    })) as unknown as typeof fetch;
}

describe("OpenAICompatibleProviderClient timeouts", () => {
  it("rejects with a timeout network error when the provider never responds", async () => {
    const client = new OpenAICompatibleProviderClient(
      CONFIG,
      "",
      signalAwareHangingFetch(),
      undefined,
      /* responseTimeoutMs */ 20
    );
    const start = Date.now();
    await expect(
      client.complete({ messages: [{ role: "user", content: "hi" }] })
    ).rejects.toThrow(/too long/i);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("surfaces the timeout as an AIProviderError (network)", async () => {
    const client = new OpenAICompatibleProviderClient(
      CONFIG,
      "",
      signalAwareHangingFetch(),
      undefined,
      20
    );
    try {
      await client.complete({ messages: [{ role: "user", content: "hi" }] });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect((err as AIProviderError).code).toBe("network");
    }
  });

  it("preserves a caller-initiated abort as an AbortError (not the timeout message)", async () => {
    const controller = new AbortController();
    const client = new OpenAICompatibleProviderClient(
      CONFIG,
      "",
      signalAwareHangingFetch(),
      undefined,
      5000
    );
    // Abort shortly after the stream starts, well before the 5s timeout.
    setTimeout(() => controller.abort(), 10);
    await expect(
      client.stream(
        { messages: [{ role: "user", content: "hi" }] },
        () => undefined,
        { signal: controller.signal }
      )
    ).rejects.toSatisfy((err: unknown) => {
      const name = err instanceof Error ? err.name : "";
      return name === "AbortError";
    });
  });
});
