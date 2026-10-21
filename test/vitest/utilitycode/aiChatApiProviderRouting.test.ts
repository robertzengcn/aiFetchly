import { describe, it, expect, beforeEach, vi } from "vitest";
import { AiChatApi } from "@/api/aiChatApi";
import { USER_AI_ENABLED, USER_AI_PROVIDER_MODE } from "@/config/usersetting";

// Shared in-memory store backing every `new Token()` so the settings service,
// secret service, and resolver all see the same data within a test.
const tokenStore = new Map<string, string>();

// Mirror of the real HttpResponseError, defined via vi.hoisted so both the
// mock factory and the tests can reference it (hoisted mock factories cannot
// see ordinary top-level variables). Production detects the
// small-model-unavailable retry signal via `instanceof` + status.
const { MockHttpResponseError } = vi.hoisted(() => {
  class MockHttpResponseError extends Error {
    readonly status: number;
    readonly statusText: string;
    constructor(status: number, statusText: string) {
      super(statusText || `HTTP ${status}`);
      this.name = "HttpResponseError";
      this.status = status;
      this.statusText = statusText;
    }
  }
  return { MockHttpResponseError };
});

vi.mock("@/modules/token", () => ({
  // Vitest 4: vi.fn().mockImplementation(() => ({})) is not constructable.
  Token: class {
    getValue(k: string): string {
      return tokenStore.get(k) ?? "";
    }
    setValue(k: string, v: string): void {
      tokenStore.set(k, v);
    }
    deleteValue(k: string): void {
      tokenStore.delete(k);
    }
    hasValue(k: string): boolean {
      return tokenStore.has(k) && (tokenStore.get(k)?.length ?? 0) > 0;
    }
  },
}));

// Hosted HttpClient captured so we can assert it is (or is not) used.
const mockGet = vi.fn();
const mockPostJson = vi.fn();
const mockPostStream = vi.fn();
vi.mock("@/modules/lib/httpclient", () => ({
  HttpClient: class {
    constructor() {
      return {
        get: mockGet,
        postJson: mockPostJson,
        postStream: mockPostStream,
      };
    }
  },
  HttpResponseError: MockHttpResponseError,
}));

// Production imports HttpResponseError from "@/modules/lib/httpResponseError"
// (not via httpclient), so mirror the mock there too — otherwise
// `instanceof` in isHttpNotFoundError never matches the test double.
vi.mock("@/modules/lib/httpResponseError", () => ({
  HttpResponseError: MockHttpResponseError,
  MAX_RESPONSE_BODY_BYTES: 16 * 1024,
  MAX_RETRY_AFTER_MS: 60_000,
}));

import { AIProviderSettingsService } from "@/service/aiProvider/AIProviderSettingsService";

/** Read the first argument of the first call to a mocked fetch. */
const firstCallUrl = (m: unknown): string =>
  String((m as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]);

/** Parse the JSON body of the first call to a mocked fetch. */
const firstCallBody = (m: unknown): Record<string, unknown> => {
  const calls = (m as { mock: { calls: unknown[][] } }).mock.calls;
  const init = calls[0]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
};

function enableLocalProvider(): void {
  const svc = new AIProviderSettingsService();
  svc.saveLocalProvider({
    preset: "ollama",
    name: "Ollama",
    baseUrl: "http://localhost:11434",
    defaultModel: "llama3.1",
    apiKey: "sk-local",
  });
  tokenStore.set(USER_AI_PROVIDER_MODE, "local");
}

function enableHosted(): void {
  tokenStore.set(USER_AI_ENABLED, "true");
  tokenStore.set(USER_AI_PROVIDER_MODE, "hosted");
}

describe("AiChatApi provider routing", () => {
  let api: AiChatApi;

  beforeEach(() => {
    tokenStore.clear();
    // Reset (not just clear) so mockRejectedValueOnce/mockResolvedValueOnce
    // queues from a prior test cannot leak into the next one.
    mockGet.mockReset();
    mockPostJson.mockReset();
    mockPostStream.mockReset();
    api = new AiChatApi();
  });

  it("listOpenAIModels uses the hosted HttpClient in hosted mode", async () => {
    enableHosted();
    mockGet.mockResolvedValue({
      object: "list",
      data: [
        { id: "gpt-x", object: "model", created: 0, owned_by: "ai-server" },
      ],
    });
    const res = await api.listOpenAIModels();
    expect(mockGet).toHaveBeenCalledWith("/api/ai/v1/models");
    expect(res.data.map((m) => m.id)).toEqual(["gpt-x"]);
  });

  it("listOpenAIModels uses the local client (fetch) in local mode", async () => {
    enableLocalProvider();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          object: "list",
          data: [
            { id: "llama3.1", object: "model", created: 0, owned_by: "ollama" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    ) as unknown as typeof fetch;
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock;
    try {
      const res = await api.listOpenAIModels();
      expect(mockGet).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalled();
      // The local client hits /models on the configured base URL.
      expect(firstCallUrl(fetchMock)).toBe("http://localhost:11434/v1/models");
      expect(res.data.map((m) => m.id)).toContain("llama3.1");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("listOpenAIModels falls back to a synthetic model when local /models fails", async () => {
    enableLocalProvider();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("nope", { status: 500 })
      ) as unknown as typeof fetch;
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock;
    try {
      const res = await api.listOpenAIModels();
      expect(res.data.map((m) => m.id)).toEqual(["llama3.1"]);
      expect(res.default_model).toBe("llama3.1");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("openAIChatCompletion routes a local request to the configured base URL", async () => {
    enableLocalProvider();
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
    ) as unknown as typeof fetch;
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock;
    try {
      const res = await api.openAIChatCompletion({
        messages: [{ role: "user", content: "ping" }],
      });
      expect(mockPostJson).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalled();
      expect(firstCallUrl(fetchMock)).toBe(
        "http://localhost:11434/v1/chat/completions"
      );
      expect(res.choices[0].message.content).toBe("pong");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("openAIChatCompletionStream parses local SSE chunks", async () => {
    enableLocalProvider();
    const sseBody =
      "data: " +
      JSON.stringify({
        id: "x",
        object: "chat.completion.chunk",
        created: 0,
        model: "llama3.1",
        choices: [{ index: 0, delta: { content: "Hel" }, finish_reason: null }],
      }) +
      "\n\ndata: " +
      JSON.stringify({
        id: "x",
        object: "chat.completion.chunk",
        created: 0,
        model: "llama3.1",
        choices: [{ index: 0, delta: { content: "lo" }, finish_reason: null }],
      }) +
      "\n\ndata: [DONE]\n\n";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(sseBody, { status: 200 })
      ) as unknown as typeof fetch;
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock;
    try {
      const chunks: string[] = [];
      await api.openAIChatCompletionStream(
        { messages: [{ role: "user", content: "hi" }] },
        (c) => {
          const d = c.choices[0]?.delta?.content;
          if (d) chunks.push(d);
        }
      );
      expect(chunks.join("")).toBe("Hello");
      expect(mockPostStream).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });

  it("falls back to the hosted model list when the resolver denies", async () => {
    // 821509d8 deliberately removed the AI-enable gate from model listing:
    // a denial (no hosted entitlement AND no local config) now falls back to
    // the hosted list instead of throwing; execution gates live elsewhere.
    const models = await api.listOpenAIModels();
    expect(models.object).toBe("list");
    expect(Array.isArray(models.data)).toBe(true);
  });

  it("hosted sends the small alias on the wire without the internal fallback", async () => {
    enableHosted();
    mockPostJson.mockResolvedValue({
      id: "x",
      object: "chat.completion",
      created: 0,
      model: "cheap-model",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "ok" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    await api.openAIChatCompletion({
      messages: [{ role: "user", content: "hi" }],
      model: "small",
      fallbackModel: "deepseek-v4-flash",
    });
    expect(mockPostJson).toHaveBeenCalledTimes(1);
    expect(mockPostJson.mock.calls[0]?.[0]).toBe("/api/ai/v1/chat/completions");
    const wire = mockPostJson.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(wire.model).toBe("small");
    expect(wire).not.toHaveProperty("fallbackModel");
  });

  it("hosted retries once with the fallback model when small is unavailable (404)", async () => {
    enableHosted();
    mockPostJson
      .mockRejectedValueOnce(new MockHttpResponseError(404, "Not Found"))
      .mockResolvedValueOnce({
        id: "x",
        object: "chat.completion",
        created: 0,
        model: "deepseek-v4-flash",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "recovered" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    const res = await api.openAIChatCompletion({
      messages: [{ role: "user", content: "hi" }],
      model: "small",
      fallbackModel: "deepseek-v4-flash",
    });
    expect(res.choices[0].message.content).toBe("recovered");
    expect(mockPostJson).toHaveBeenCalledTimes(2);
    const first = mockPostJson.mock.calls[0]?.[1] as Record<string, unknown>;
    const second = mockPostJson.mock.calls[1]?.[1] as Record<string, unknown>;
    expect(first.model).toBe("small");
    expect(second.model).toBe("deepseek-v4-flash");
    expect(second).not.toHaveProperty("fallbackModel");
  });

  it("hosted retries with the model omitted when small is unavailable and no fallback", async () => {
    enableHosted();
    mockPostJson
      .mockRejectedValueOnce(new MockHttpResponseError(404, "Not Found"))
      .mockResolvedValueOnce({
        id: "x",
        object: "chat.completion",
        created: 0,
        model: "server-default",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "recovered" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    const res = await api.openAIChatCompletion({
      messages: [{ role: "user", content: "hi" }],
      model: "small",
    });
    expect(res.choices[0].message.content).toBe("recovered");
    expect(mockPostJson).toHaveBeenCalledTimes(2);
    const second = mockPostJson.mock.calls[1]?.[1] as Record<string, unknown>;
    expect(second).not.toHaveProperty("model");
  });

  it("hosted does not retry a non-404 error on the small alias", async () => {
    enableHosted();
    mockPostJson.mockRejectedValue(
      new MockHttpResponseError(500, "Server Error")
    );
    await expect(
      api.openAIChatCompletion({
        messages: [{ role: "user", content: "hi" }],
        model: "small",
        fallbackModel: "deepseek-v4-flash",
      })
    ).rejects.toThrow();
    expect(mockPostJson).toHaveBeenCalledTimes(1);
  });

  it("hosted does not retry a 404 for a literal (non-alias) model", async () => {
    enableHosted();
    mockPostJson.mockRejectedValue(new MockHttpResponseError(404, "Not Found"));
    await expect(
      api.openAIChatCompletion({
        messages: [{ role: "user", content: "hi" }],
        model: "gpt-x",
        fallbackModel: "deepseek-v4-flash",
      })
    ).rejects.toThrow();
    expect(mockPostJson).toHaveBeenCalledTimes(1);
  });

  it("local maps the small alias to the configured default model", async () => {
    enableLocalProvider();
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
    ) as unknown as typeof fetch;
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock;
    try {
      await api.openAIChatCompletion({
        messages: [{ role: "user", content: "ping" }],
        model: "small",
        fallbackModel: "deepseek-v4-flash",
      });
      expect(mockPostJson).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const wire = firstCallBody(fetchMock);
      expect(wire.model).toBe("llama3.1");
      expect(wire).not.toHaveProperty("fallbackModel");
    } finally {
      globalThis.fetch = original;
    }
  });

  // T04 (NFR-02/04, AC-24): the caller's abort signal — the checker's
  // per-dispatch controller linked to the turn/run Stop + a deadline — must
  // reach the transport in BOTH the local and hosted paths so a Stop or a
  // hanging provider stall cannot hold the verification gate. A signal that
  // stops at the API boundary would let an in-flight checker fetch outlive
  // the run.

  it("openAIChatCompletion forwards the caller signal to the local fetch (T04, AC-24)", async () => {
    // The local client wraps the caller signal in a derived AbortController
    // (linked via an abort listener + a response-timeout timer), so the
    // fetch's signal is NOT the caller's by identity. The regression that
    // matters: aborting the caller signal propagates to the fetch's signal
    // (a Stop / checker deadline cancels the in-flight local fetch). We hold
    // the fetch in-flight, capture its derived signal, abort the caller, and
    // assert the derived signal flips. Mirrors real fetch: an abort listener
    // on the fetch's signal rejects the in-flight request.
    enableLocalProvider();
    let observedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn().mockImplementation((_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal ?? undefined;
      observedSignal = signal;
      return new Promise<Response>((_resolve, reject) => {
        if (signal?.aborted) {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
          return;
        }
        signal?.addEventListener(
          "abort",
          () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          },
          { once: true }
        );
      });
    }) as unknown as typeof fetch;
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock;
    const controller = new AbortController();
    const inFlight = api
      .openAIChatCompletion(
        { messages: [{ role: "user", content: "ping" }] },
        { signal: controller.signal }
      )
      .catch(() => null);
    // The local path does async provider resolution before issuing fetch.
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(observedSignal).toBeInstanceOf(AbortSignal);
    expect(observedSignal?.aborted).toBe(false);
    controller.abort();
    // The caller-abort listener (registered in fetchWithResponseTimeout)
    // fires synchronously; the derived signal the fetch was issued with
    // flips to aborted. This is the propagation that cancels an in-flight
    // local fetch on Stop / checker deadline.
    expect(observedSignal?.aborted).toBe(true);
    await inFlight;
    globalThis.fetch = original;
  });

  it("openAIChatCompletion forwards the caller signal to the hosted postJson (T04, AC-24)", async () => {
    enableHosted();
    mockPostJson.mockResolvedValue({
      id: "x",
      object: "chat.completion",
      created: 0,
      model: "gpt-x",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "hello" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    const controller = new AbortController();
    await api.openAIChatCompletion(
      { messages: [{ role: "user", content: "hi" }] },
      { signal: controller.signal }
    );
    expect(mockPostJson).toHaveBeenCalledTimes(1);
    const opts = mockPostJson.mock.calls[0]?.[2] as
      | { signal?: AbortSignal }
      | undefined;
    expect(opts?.signal).toBe(controller.signal);
  });

  it("openAIChatCompletion forwards the caller signal to the hosted 404-retry postJson (T04, AC-24)", async () => {
    // The small-model 404 retry path must also carry the signal — a Stop
    // during the retry window cancels the retry, not just the first attempt.
    enableHosted();
    mockPostJson
      .mockRejectedValueOnce(new MockHttpResponseError(404, "Not Found"))
      .mockResolvedValueOnce({
        id: "x",
        object: "chat.completion",
        created: 0,
        model: "deepseek-v4-flash",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "recovered" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    const controller = new AbortController();
    await api.openAIChatCompletion(
      {
        messages: [{ role: "user", content: "hi" }],
        model: "small",
        fallbackModel: "deepseek-v4-flash",
      },
      { signal: controller.signal }
    );
    expect(mockPostJson).toHaveBeenCalledTimes(2);
    const retryOpts = mockPostJson.mock.calls[1]?.[2] as
      | { signal?: AbortSignal }
      | undefined;
    expect(retryOpts?.signal).toBe(controller.signal);
  });
});
