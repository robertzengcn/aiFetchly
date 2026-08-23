import { describe, it, expect, beforeEach, vi } from "vitest";
import { AiChatApi } from "@/api/aiChatApi";
import { USER_AI_ENABLED, USER_AI_PROVIDER_MODE } from "@/config/usersetting";

// Shared in-memory store backing every `new Token()` so the settings service,
// secret service, and resolver all see the same data within a test.
const tokenStore = new Map<string, string>();

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: (k: string) => tokenStore.get(k) ?? "",
    setValue: (k: string, v: string) => {
      tokenStore.set(k, v);
    },
    deleteValue: (k: string) => {
      tokenStore.delete(k);
    },
    hasValue: (k: string) =>
      tokenStore.has(k) && (tokenStore.get(k)?.length ?? 0) > 0,
  })),
}));

// Hosted HttpClient captured so we can assert it is (or is not) used.
const mockGet = vi.fn();
const mockPostJson = vi.fn();
const mockPostStream = vi.fn();
vi.mock("@/modules/lib/httpclient", () => ({
  HttpClient: vi.fn().mockImplementation(() => ({
    get: mockGet,
    postJson: mockPostJson,
    postStream: mockPostStream,
  })),
}));

import { AIProviderSettingsService } from "@/service/aiProvider/AIProviderSettingsService";

/** Read the first argument of the first call to a mocked fetch. */
const firstCallUrl = (m: unknown): string =>
  String((m as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]);

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
    vi.clearAllMocks();
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

  it("forwards the caller AbortSignal to fetch on a local non-stream completion", async () => {
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
      const controller = new AbortController();
      await api.openAIChatCompletion(
        { messages: [{ role: "user", content: "ping" }] },
        controller.signal
      );
      // The local client links the caller's signal to an internal
      // AbortController (so timeout-abort and caller-abort are
      // distinguishable), so the fetch RequestInit's signal is an
      // AbortSignal that aborts when the caller aborts.
      const init = (fetchMock as unknown as { mock: { calls: unknown[][] } })
        .mock.calls[0]![1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("links caller abort to the fetch signal on a local non-stream completion", async () => {
    enableLocalProvider();
    // A fetch that never resolves on its own — the caller's abort must
    // propagate to the internal controller's signal (listener linkage).
    const fetchMock = vi.fn().mockReturnValue(
      new Promise(() => {
        /* never resolves */
      })
    ) as unknown as typeof fetch;
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock;
    try {
      const controller = new AbortController();
      // Don't await — the call hangs and then rejects on abort. Swallow the
      // expected rejection; we only care that abort propagates to fetch's signal.
      void api
        .openAIChatCompletion(
          { messages: [{ role: "user", content: "ping" }] },
          controller.signal
        )
        .catch(() => {
          /* expected: abort surfaces as a network error */
        });
      // Wait until the client has actually issued the fetch call (the
      // resolver + client construction add a few async hops).
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      });
      const init = (fetchMock as unknown as { mock: { calls: unknown[][] } })
        .mock.calls[0]![1] as RequestInit;
      const fetchSignal = init.signal as AbortSignal;
      expect(fetchSignal.aborted).toBe(false);
      controller.abort();
      // The internal controller aborts synchronously via the listener.
      expect(fetchSignal.aborted).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("forwards the caller AbortSignal to postJson on a hosted non-stream completion", async () => {
    enableHosted();
    mockPostJson.mockResolvedValueOnce({
      id: "x",
      object: "chat.completion",
      created: 0,
      model: "hosted-model",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "ok" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    const controller = new AbortController();
    await api.openAIChatCompletion(
      { messages: [{ role: "user", content: "ping" }] },
      controller.signal
    );
    // postJson's third arg carries { signal } so it flows into _fetchJSON's fetch.
    expect(mockPostJson).toHaveBeenCalledWith(
      "/api/ai/v1/chat/completions",
      expect.anything(),
      { signal: controller.signal }
    );
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

  it("listOpenAIModels returns hosted models even without AI entitlement", async () => {
    // No hosted entitlement and no local config — model listing is ungated.
    mockGet.mockResolvedValue({
      object: "list",
      data: [{ id: "gpt-4", object: "model" }],
    });
    const res = await api.listOpenAIModels();
    expect(res.data).toHaveLength(1);
    expect(res.data[0].id).toBe("gpt-4");
  });

  it("openAIChatCompletion throws when hosted AI is disabled and no local provider", async () => {
    // No hosted entitlement and no local config — chat is gated.
    await expect(
      api.openAIChatCompletion({
        messages: [{ role: "user", content: "hi" }],
      })
    ).rejects.toThrow(/subscription|local AI provider/i);
  });

  it("openAIChatCompletionStream throws when hosted AI is disabled and no local provider", async () => {
    // No hosted entitlement and no local config — streaming chat is gated.
    const onChunk = vi.fn();
    await expect(
      api.openAIChatCompletionStream(
        { messages: [{ role: "user", content: "hi" }] },
        onChunk
      )
    ).rejects.toThrow(/subscription|local AI provider/i);
  });

  it("openAIChatCompletion succeeds when hosted AI is enabled", async () => {
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
    const res = await api.openAIChatCompletion({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.choices[0].message.content).toBe("hello");
  });
});
