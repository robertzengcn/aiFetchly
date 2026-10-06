import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AiChatApi } from "@/api/aiChatApi";
import { HttpClient, HttpResponseError } from "@/modules/lib/httpclient";
import type { OpenAIChatCompletionResponse } from "@/api/aiChatApi";

/**
 * B13 hosted path: when the caller supplies `callBudgetMs`, the hosted
 * completion must pass an AbortSignal to postJson (its third options arg),
 * and the signal must abort after callBudgetMs — bounding the response-headers
 * phase AND the response-body phase (postJson's _fetchJSON awaits res.json(),
 * which rejects when the fetch signal aborts).
 *
 * The hosted branch is forced by setting WORKER_TYPE (the worker routing in
 * openAIChatCompletion skips the local-provider resolver and goes straight to
 * openAIChatCompletionHosted after the WORKER_AI_ENABLED gate), so no
 * Electron/token machinery is touched.
 */

/** A canned valid completion response. */
function completionResponse(): OpenAIChatCompletionResponse {
  return {
    id: "x",
    object: "chat.completion",
    created: 0,
    model: "test-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "pong" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

describe("AiChatApi hosted completion call budget (B13)", () => {
  const originalWorkerType = process.env.WORKER_TYPE;
  const originalWorkerAiEnabled = process.env.WORKER_AI_ENABLED;

  beforeEach(() => {
    process.env.WORKER_TYPE = "test-worker";
    process.env.WORKER_AI_ENABLED = "true";
  });

  afterEach(() => {
    if (originalWorkerType === undefined) {
      delete process.env.WORKER_TYPE;
    } else {
      process.env.WORKER_TYPE = originalWorkerType;
    }
    if (originalWorkerAiEnabled === undefined) {
      delete process.env.WORKER_AI_ENABLED;
    } else {
      process.env.WORKER_AI_ENABLED = originalWorkerAiEnabled;
    }
    vi.restoreAllMocks();
  });

  it("threads an AbortSignal to postJson when callBudgetMs is set", async () => {
    let capturedSignal: AbortSignal | undefined;
    const postJsonSpy = vi
      .spyOn(HttpClient.prototype, "postJson")
      .mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (async (_endpoint: string, _data: unknown, options?: any) => {
          capturedSignal = (options as { signal?: AbortSignal } | undefined)
            ?.signal;
          return completionResponse();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any
      );
    const api = new AiChatApi();
    const result = await api.openAIChatCompletion({
      messages: [{ role: "user", content: "hi" }],
      callBudgetMs: 5000,
    });
    expect(result.choices?.[0]?.message?.content).toBe("pong");
    expect(postJsonSpy).toHaveBeenCalled();
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);
  });

  it("passes NO signal to postJson when callBudgetMs is absent", async () => {
    let sawSignal: boolean | undefined;
    vi.spyOn(HttpClient.prototype, "postJson").mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (_endpoint: string, _data: unknown, options?: any) => {
        sawSignal =
          (options as { signal?: AbortSignal } | undefined)?.signal !==
          undefined;
        return completionResponse();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any
    );
    const api = new AiChatApi();
    await api.openAIChatCompletion({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(sawSignal).toBe(false);
  });

  it("aborts a stalled hosted body within callBudgetMs", async () => {
    // postJson hangs until the signal aborts (mirroring a stalled response
    // body: _fetchJSON awaits res.json() which rejects on signal abort).
    vi.spyOn(HttpClient.prototype, "postJson").mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (_endpoint: string, _data: unknown, options?: any) => {
        const signal = (options as { signal?: AbortSignal } | undefined)
          ?.signal;
        return await new Promise<OpenAIChatCompletionResponse>(
          (_resolve, reject) => {
            const fail = (): void => {
              const err = new Error("The operation was aborted.");
              err.name = "AbortError";
              reject(err);
            };
            if (signal) {
              if (signal.aborted) {
                fail();
              } else {
                signal.addEventListener("abort", fail, { once: true });
              }
            }
            // no signal → hangs forever (the non-budgeted legacy path)
          }
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any
    );
    const api = new AiChatApi();
    const start = Date.now();
    await expect(
      api.openAIChatCompletion({
        messages: [{ role: "user", content: "hi" }],
        callBudgetMs: 50,
      })
    ).rejects.toSatisfy((err: unknown) => err instanceof Error);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("keeps the small-model 404 retry under the same budget (signal threads through the retry)", async () => {
    // First call: 404 (small_model_unavailable) → retry. The retry must carry
    // the SAME signal so the aggregate budget spans both attempts.
    const signals: Array<AbortSignal | undefined> = [];
    let calls = 0;
    vi.spyOn(HttpClient.prototype, "postJson").mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (_endpoint: string, _data: unknown, options?: any) => {
        calls += 1;
        signals.push(
          (options as { signal?: AbortSignal } | undefined)?.signal
        );
        if (calls === 1) {
          throw new HttpResponseError(404, "Not Found");
        }
        return completionResponse();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any
    );
    const api = new AiChatApi();
    const result = await api.openAIChatCompletion({
      messages: [{ role: "user", content: "hi" }],
      model: "small",
      callBudgetMs: 5000,
    });
    expect(calls).toBe(2);
    expect(result.choices?.[0]?.message?.content).toBe("pong");
    // Same signal instance on both attempts → one aggregate budget.
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[1]).toBe(signals[0]);
  });
});
