import { describe, it, expect, vi } from "vitest";
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

/**
 * B13: a fetch that returns response headers (200 ok) but whose `res.json()`
 * never resolves on its own — it only rejects when the request signal aborts.
 * Simulates a provider that sends headers then stalls mid-body. The returned
 * `Response.json()` reads the signal via the captured `init`; real fetch
 * rejects the body read on abort, so the fake mirrors that contract.
 */
function signalAwareHangingBodyFetch(): typeof fetch {
  return ((url: string | URL | Request, init?: RequestInit) => {
    const sig = init?.signal as AbortSignal | undefined;
    const body: Promise<Response> = new Promise((resolve) => {
      // Headers arrive immediately.
      resolve(
        new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    });
    // Patch `.json()` so the body read honors the abort signal — mirroring
    // the real fetch contract where an aborted signal rejects body reads.
    return body.then((res) => {
      const patched = {
        ...res,
        ok: res.ok,
        status: res.status,
        headers: res.headers,
        json: () =>
          new Promise<unknown>((_resolveJson, rejectJson) => {
            const fail = (): void => {
              const err = new Error("The operation was aborted.");
              err.name = "AbortError";
              rejectJson(err);
            };
            if (sig) {
              if (sig.aborted) {
                fail();
              } else {
                sig.addEventListener("abort", fail, { once: true });
              }
            }
            // otherwise: body never resolves
          }),
      };
      return patched as unknown as Response;
    });
  }) as unknown as typeof fetch;
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

  it("preserves a caller-initiated abort as an AbortError (not the timeout message)", async () => {    const controller = new AbortController();
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

  it("B13: aborts a stalled response body within the callBudgetMs budget", async () => {
    // Headers arrive (200 ok) but res.json() never resolves. Without the
    // body-phase deadline the call would hang forever. With callBudgetMs the
    // shared AbortController fires and res.json() rejects within the budget.
    const client = new OpenAICompatibleProviderClient(
      CONFIG,
      "",
      signalAwareHangingBodyFetch(),
      undefined,
      /* responseTimeoutMs */ 5000,
      /* bodyTimeoutMs */ 5000
    );
    const start = Date.now();
    await expect(
      client.complete({
        messages: [{ role: "user", content: "hi" }],
        callBudgetMs: 50,
      })
    ).rejects.toThrow(/stalled before finishing the body/i);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("B13: surfaces the body-phase timeout as an AIProviderError (network)", async () => {
    const client = new OpenAICompatibleProviderClient(
      CONFIG,
      "",
      signalAwareHangingBodyFetch(),
      undefined,
      5000,
      5000
    );
    try {
      await client.complete({
        messages: [{ role: "user", content: "hi" }],
        callBudgetMs: 50,
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect((err as AIProviderError).code).toBe("network");
    }
  });

  it("B13: without callBudgetMs a stalled body still aborts via bodyTimeoutMs", async () => {
    // No callBudgetMs supplied — fall back to the per-phase body timeout.
    // Use a tiny bodyTimeoutMs so the test stays fast.
    const client = new OpenAICompatibleProviderClient(
      CONFIG,
      "",
      signalAwareHangingBodyFetch(),
      undefined,
      /* responseTimeoutMs */ 5000,
      /* bodyTimeoutMs */ 20
    );
    const start = Date.now();
    await expect(
      client.complete({ messages: [{ role: "user", content: "hi" }] })
    ).rejects.toThrow(/stalled before finishing the body/i);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("B13: a fast body resolves normally under a generous budget", async () => {
    // Headers + body both resolve immediately — the budget must not fire.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "x",
          object: "chat.completion",
          created: 0,
          model: "llama3.1",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "pong" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    const client = new OpenAICompatibleProviderClient(
      CONFIG,
      "",
      fetchMock as unknown as typeof fetch,
      undefined,
      5000,
      5000
    );
    const result = await client.complete({
      messages: [{ role: "user", content: "hi" }],
      callBudgetMs: 5000,
    });
    expect(result.choices?.[0]?.message?.content).toBe("pong");
  });
});

describe("OpenAICompatibleProviderClient small-model alias", () => {
  function completionResponse(): Response {
    return new Response(
      JSON.stringify({
        id: "x",
        object: "chat.completion",
        created: 0,
        model: "llama3.1",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "pong" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  function wireBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  }

  it("sends the configured default model when the request uses the small alias", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completionResponse());
    const client = new OpenAICompatibleProviderClient(
      CONFIG,
      "",
      fetchMock as unknown as typeof fetch
    );
    await client.complete({
      messages: [{ role: "user", content: "hi" }],
      model: "small",
    });
    expect(wireBody(fetchMock).model).toBe("llama3.1");
  });

  it("treats the alias case-insensitively", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completionResponse());
    const client = new OpenAICompatibleProviderClient(
      CONFIG,
      "",
      fetchMock as unknown as typeof fetch
    );
    await client.complete({
      messages: [{ role: "user", content: "hi" }],
      model: " Small ",
    });
    expect(wireBody(fetchMock).model).toBe("llama3.1");
  });

  it("passes a literal model id through untouched", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completionResponse());
    const client = new OpenAICompatibleProviderClient(
      CONFIG,
      "",
      fetchMock as unknown as typeof fetch
    );
    await client.complete({
      messages: [{ role: "user", content: "hi" }],
      model: "qwen3:8b",
    });
    expect(wireBody(fetchMock).model).toBe("qwen3:8b");
  });
});
