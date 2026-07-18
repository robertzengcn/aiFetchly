import { describe, it, expect } from "vitest";
import { AIProviderConnectionTester } from "@/service/aiProvider/AIProviderConnectionTester";
import type { LocalAIProviderConfigInput } from "@/entityTypes/aiProviderTypes";

const baseProvider: LocalAIProviderConfigInput = {
  preset: "ollama",
  name: "Ollama",
  baseUrl: "http://localhost:11434",
  defaultModel: "llama3.1",
};

/** Fake fetch that routes by URL path + method to canned Responses. */
function makeFetch(routes: {
  models?: () => Response;
  chat?: () => Response;
  stream?: () => Response;
}): typeof fetch {
  return ((url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? "GET";
    if (path.endsWith("/models") && method === "GET") {
      return Promise.resolve(
        routes.models ? routes.models() : new Response("nope", { status: 404 })
      );
    }
    if (path.endsWith("/chat/completions")) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (body.stream === true) {
        return Promise.resolve(
          routes.stream
            ? routes.stream()
            : new Response("data: [DONE]\n\n", { status: 200 })
        );
      }
      return Promise.resolve(
        routes.chat
          ? routes.chat()
          : new Response(
              JSON.stringify({ choices: [{ message: { content: "pong" } }] }),
              { status: 200 }
            )
      );
    }
    return Promise.resolve(new Response("", { status: 404 }));
  }) as typeof fetch;
}

const okModels = (): Response =>
  new Response(
    JSON.stringify({
      object: "list",
      data: [
        { id: "llama3.1", object: "model", created: 0, owned_by: "ollama" },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );

const okChat = (): Response =>
  new Response(
    JSON.stringify({ choices: [{ message: { content: "pong" } }] }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );

const okStream = (): Response =>
  new Response("data: [DONE]\n\n", { status: 200 });

describe("AIProviderConnectionTester", () => {
  it("reports passed when models, chat, and streaming all work", async () => {
    const tester = new AIProviderConnectionTester(
      makeFetch({ models: okModels, chat: okChat, stream: okStream })
    );
    const result = await tester.test(baseProvider);
    expect(result.status).toBe("passed");
    expect(result.capabilities.chat).toBe("supported");
    expect(result.capabilities.streaming).toBe("supported");
    expect(result.capabilities.modelsEndpoint).toBe("supported");
    expect(result.models).toContain("llama3.1");
  });

  it("reports partial when chat works but models/streaming fail", async () => {
    const tester = new AIProviderConnectionTester(
      makeFetch({
        models: () => new Response("", { status: 500 }),
        chat: okChat,
        stream: () => new Response("", { status: 500 }),
      })
    );
    const result = await tester.test(baseProvider);
    expect(result.status).toBe("partial");
    expect(result.capabilities.chat).toBe("supported");
    expect(result.message).toMatch(/Streaming could not be verified/);
  });

  it("reports failed with a connection message on network error", async () => {
    const fetchImpl = (() =>
      Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch;
    const tester = new AIProviderConnectionTester(fetchImpl);
    const result = await tester.test(baseProvider);
    expect(result.status).toBe("failed");
    expect(result.capabilities.chat).toBe("failed");
    expect(result.message).toMatch(/Could not connect/);
  });

  it("reports failed with an auth message on 401", async () => {
    const tester = new AIProviderConnectionTester(
      makeFetch({
        models: okModels,
        chat: () => new Response("unauthorized", { status: 401 }),
      })
    );
    const result = await tester.test(baseProvider);
    expect(result.status).toBe("failed");
    expect(result.message).toMatch(/authentication failed/i);
  });

  it("reports failed without throwing when config is invalid", async () => {
    const tester = new AIProviderConnectionTester(makeFetch({}));
    const result = await tester.test({ ...baseProvider, baseUrl: "ftp://x" });
    expect(result.status).toBe("failed");
    expect(result.message).toMatch(/Invalid provider configuration/);
  });

  it("detects tool support when probeTools is enabled", async () => {
    const fetchImpl = makeFetch({
      models: okModels,
      stream: okStream,
      chat: () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "t1",
                      type: "function",
                      function: { name: "ping_tool", arguments: "{}" },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        ),
    });
    const tester = new AIProviderConnectionTester(fetchImpl);
    const result = await tester.test(baseProvider, { probeTools: true });
    expect(result.capabilities.tools).toBe("supported");
  });

  it("marks streaming unsupported when a 200 body has no SSE data line", async () => {
    // Provider returns 200 with a plain JSON body (not an SSE stream).
    const fetchImpl = makeFetch({
      models: okModels,
      chat: okChat,
      stream: () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "pong" } }] }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        ),
    });
    const tester = new AIProviderConnectionTester(fetchImpl);
    const result = await tester.test(baseProvider);
    expect(result.capabilities.streaming).toBe("unsupported");
    // Chat still worked, so this is a partial result, not a failure.
    expect(result.status).toBe("partial");
  });
});
