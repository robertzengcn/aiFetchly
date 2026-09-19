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
  HttpResponseError: MockHttpResponseError,
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
    expect(mockPostJson.mock.calls[0]?.[0]).toBe(
      "/api/ai/v1/chat/completions"
    );
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
    mockPostJson.mockRejectedValue(new MockHttpResponseError(500, "Server Error"));
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
});
