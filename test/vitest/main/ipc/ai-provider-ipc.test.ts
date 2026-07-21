import { describe, it, expect, beforeEach, vi } from "vitest";

// Shared in-memory encrypted store so every `new Token()` sees the same data.
const store = new Map<string, string>();

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: (k: string) => store.get(k) ?? "",
    setValue: (k: string, v: string) => {
      store.set(k, v);
    },
    deleteValue: (k: string) => {
      store.delete(k);
    },
    hasValue: (k: string) => store.has(k) && (store.get(k)?.length ?? 0) > 0,
  })),
}));

// Capture ipcMain.handle registrations so tests can invoke them directly.
const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    }),
  },
}));

import { registerAIProviderIpcHandlers } from "@/main-process/communication/ai-provider-ipc";
import {
  AI_PROVIDER_SETTINGS_GET,
  AI_PROVIDER_SETTINGS_SAVE,
  AI_PROVIDER_API_KEY_CLEAR,
  AI_PROVIDER_MODELS_REFRESH,
  AI_PROVIDER_CONNECTION_TEST,
} from "@/config/channellist";

/** Broad response shape for assertions (avoids `any`). */
type Resp = {
  status: boolean;
  msg: string;
  data: {
    mode?: string;
    localProvider?: {
      apiKeyConfigured?: boolean;
      capabilities?: { chat?: string; streaming?: string; tools?: string };
      lastTestStatus?: string;
      lastTestMessage?: string;
    } | null;
    models?: { id: string }[];
    warning?: string;
    status?: string;
    message?: string;
    capabilities?: { chat?: string; modelsEndpoint?: string; tools?: string };
  };
};

const call = async (channel: string, ...args: unknown[]): Promise<Resp> =>
  (await handlers.get(channel)!(...args)) as Resp;

const VALID_PROVIDER = {
  preset: "ollama",
  name: "Ollama",
  baseUrl: "http://localhost:11434",
  defaultModel: "llama3.1",
};

describe("ai-provider-ipc", () => {
  beforeEach(() => {
    store.clear();
    handlers.clear();
    registerAIProviderIpcHandlers();
  });

  it("settings get returns a redacted view with no stored config", async () => {
    const res = await call(AI_PROVIDER_SETTINGS_GET);
    expect(res.status).toBe(true);
    expect(res.data.mode).toBe("hosted");
    expect(res.data.localProvider).toBeNull();
  });

  it("settings save stores the API key but never returns it", async () => {
    const res = await call(AI_PROVIDER_SETTINGS_SAVE, undefined, {
      mode: "local",
      localProvider: { ...VALID_PROVIDER, apiKey: "sk-super-secret" },
    });
    expect(res.status).toBe(true);
    expect(res.data.mode).toBe("local");
    expect(res.data.localProvider?.apiKeyConfigured).toBe(true);
    // The plaintext key must not appear anywhere in the redacted response.
    expect(JSON.stringify(res.data).includes("sk-super-secret")).toBe(false);
  });

  it("settings save returns persisted capability metadata without the plaintext key", async () => {
    const res = await call(AI_PROVIDER_SETTINGS_SAVE, undefined, {
      mode: "local",
      localProvider: {
        ...VALID_PROVIDER,
        apiKey: "sk-super-secret",
        capabilities: {
          modelsEndpoint: "supported",
          chat: "supported",
          streaming: "unsupported",
          tools: "unknown",
          vision: "unknown",
        },
        lastTestedAt: "2026-07-20T00:00:00.000Z",
        lastTestStatus: "partial",
        lastTestMessage: "Chat test passed, but streaming could not be verified.",
      },
    });

    expect(res.status).toBe(true);
    expect(res.data.localProvider?.capabilities?.chat).toBe("supported");
    expect(res.data.localProvider?.capabilities?.streaming).toBe("unsupported");
    expect(res.data.localProvider?.capabilities?.tools).toBe("unknown");
    expect(res.data.localProvider?.lastTestStatus).toBe("partial");
    expect(res.data.localProvider?.lastTestMessage).toMatch(/streaming/i);
    expect(JSON.stringify(res.data)).not.toContain("sk-super-secret");
  });

  it("clear API key flips apiKeyConfigured to false", async () => {
    await call(AI_PROVIDER_SETTINGS_SAVE, undefined, {
      mode: "local",
      localProvider: { ...VALID_PROVIDER, apiKey: "sk-super-secret" },
    });
    const res = await call(AI_PROVIDER_API_KEY_CLEAR);
    expect(res.data.localProvider?.apiKeyConfigured).toBe(false);
  });

  it("save rejects an invalid provider config with a denial", async () => {
    const res = await call(AI_PROVIDER_SETTINGS_SAVE, undefined, {
      mode: "local",
      localProvider: { ...VALID_PROVIDER, baseUrl: "ftp://x" },
    });
    expect(res.status).toBe(false);
    expect(res.msg).toMatch(/Invalid|http/i);
  });

  it("refresh models returns a synthetic list with a warning when /models fails", async () => {
    // Force the provider's /models to fail so the client falls back.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("nope", { status: 500 })
    ) as unknown as typeof globalThis.fetch;
    try {
      const res = await call(AI_PROVIDER_MODELS_REFRESH, undefined, {
        provider: VALID_PROVIDER,
      });
      expect(res.status).toBe(true);
      expect(res.data.models?.map((m) => m.id)).toEqual(["llama3.1"]);
      expect(res.data.warning).toMatch(/could not be loaded/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("refresh models normalizes an OpenAI-style provider response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          object: "list",
          data: [
            { id: "llama3.1", object: "model", created: 0, owned_by: "ollama" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    ) as unknown as typeof globalThis.fetch;
    try {
      const res = await call(AI_PROVIDER_MODELS_REFRESH, undefined, {
        provider: VALID_PROVIDER,
      });
      expect(res.status).toBe(true);
      expect(res.data.models?.map((m) => m.id)).toEqual(["llama3.1"]);
      expect(res.data.warning).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("connection test reports auth failure without leaking the submitted API key", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((url: string | URL | Request) => {
      const path = String(url);
      if (path.endsWith("/models")) {
        return Promise.resolve(
          new Response(JSON.stringify({ object: "list", data: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.resolve(new Response("unauthorized", { status: 401 }));
    }) as unknown as typeof globalThis.fetch;
    try {
      const res = await call(AI_PROVIDER_CONNECTION_TEST, undefined, {
        provider: { ...VALID_PROVIDER, apiKey: "sk-should-not-leak" },
      });
      expect(res.status).toBe(true);
      expect(res.data.status).toBe("failed");
      expect(res.data.message).toMatch(/authentication failed/i);
      expect(JSON.stringify(res)).not.toContain("sk-should-not-leak");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("connection test probes tool support when chat works", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (path.endsWith("/models")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              object: "list",
              data: [
                {
                  id: "llama3.1",
                  object: "model",
                  created: 0,
                  owned_by: "ollama",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      if (body.stream === true) {
        return Promise.resolve(new Response("data: [DONE]\n\n", { status: 200 }));
      }
      if (Array.isArray(body.tools)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    tool_calls: [
                      {
                        id: "tool_1",
                        type: "function",
                        function: { name: "ping_tool", arguments: "{}" },
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: "pong" } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    }) as unknown as typeof globalThis.fetch;
    try {
      const res = await call(AI_PROVIDER_CONNECTION_TEST, undefined, {
        provider: VALID_PROVIDER,
      });
      expect(res.status).toBe(true);
      expect(res.data.status).toBe("passed");
      expect(res.data.capabilities?.tools).toBe("supported");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("hosted save keeps mode hosted without requiring a provider", async () => {
    const res = await call(AI_PROVIDER_SETTINGS_SAVE, undefined, {
      mode: "hosted",
    });
    expect(res.status).toBe(true);
    expect(res.data.mode).toBe("hosted");
  });
});
