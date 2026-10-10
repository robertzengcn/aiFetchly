// Fake-server integration tests for small-model routing (SMBW-018).
//
// Spins a real loopback HTTP server and drives the REAL lightweight router
// (AIChatLightweightCompletionService) and failure classifier over real HTTP
// semantics — status codes, Retry-After headers, OpenAI-style error envelopes
// — exactly as the hosted server produces them. The completion deps use plain
// fetch against the loopback origin (the same boundary AiChatApi's hosted
// path delegates to); typed errors are built with the real HttpResponseError
// the HttpClient layer throws, so classification exercises the actual wire
// shapes rather than in-memory mocks.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createLightweightCompletionService } from "@/service/AIChatLightweightCompletionFactory";
import { HttpResponseError } from "@/modules/lib/httpResponseError";
import { AIChatLightweightFailure } from "@/service/AIChatLightweightTypes";
import type {
  AIChatLightweightCompletionDeps,
} from "@/service/AIChatLightweightCompletionService";
import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAISmallModelCapability,
} from "@/api/aiChatApi";

// The router reads the kill switch at construction — enable small routing.
process.env.AIFETCHLY_SMALL_MODEL_ROUTING_ENABLED = "true";

/** A recorded inbound request (path + parsed JSON body). */
interface RecordedRequest {
  path: string;
  body: Record<string, unknown> | null;
}

/**
 * Behavior per path: a queue of handlers. Each handler receives the request
 * and returns {status, headers?, json?}. Handlers are consumed in order; the
 * last handler repeats.
 */
type FakeHandler = (
  req: RecordedRequest
) => {
  status: number;
  headers?: Record<string, string>;
  json?: unknown;
  delayMs?: number;
};

interface FakeServer {
  url: string;
  requests: RecordedRequest[];
  setHandler(path: string, handler: FakeHandler): void;
  setModelsBody(json: unknown): void;
  close(): Promise<void>;
}

async function startFakeServer(): Promise<FakeServer> {
  const requests: RecordedRequest[] = [];
  const handlers = new Map<string, FakeHandler>();
  let modelsBody: unknown = { object: "list", data: [] };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        body =
          parsed && typeof parsed === "object"
            ? (parsed as Record<string, unknown>)
            : null;
      } catch {
        body = null;
      }
      const recorded: RecordedRequest = {
        path: req.url ?? "/",
        body,
      };
      requests.push(recorded);

      if (recorded.path.includes("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(modelsBody));
        return;
      }
      const handler = handlers.get(recorded.path);
      if (!handler) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "no_handler" } }));
        return;
      }
      const response = handler(recorded);
      const write = (): void => {
        res.writeHead(response.status, {
          "content-type": "application/json",
          ...(response.headers ?? {}),
        });
        res.end(JSON.stringify(response.json ?? {}));
      };
      if (response.delayMs) {
        setTimeout(write, response.delayMs);
      } else {
        write();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    requests,
    setHandler: (path, handler) => handlers.set(path, handler),
    setModelsBody: (json) => {
      modelsBody = json;
    },
    close: () =>
      new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const COMPLETIONS_PATH = "/api/ai/v1/chat/completions";

/**
 * Build the real HttpResponseError the HttpClient boundary throws: status,
 * bounded body, Retry-After, and `error.code` parsed only from valid JSON —
 * mirroring _fetchJSON's contract (§9).
 */
async function httpResponseErrorFrom(
  response: Response
): Promise<HttpResponseError> {
  const text = await response.text();
  let serverCode: string | undefined;
  try {
    const parsed = JSON.parse(text) as {
      error?: { code?: unknown };
    };
    if (typeof parsed.error?.code === "string") {
      serverCode = parsed.error.code;
    }
  } catch {
    // not JSON — no server code
  }
  const retryAfterHeader = response.headers.get("retry-after");
  let retryAfterMs: number | undefined;
  if (retryAfterHeader !== null) {
    const seconds = Number(retryAfterHeader);
    retryAfterMs = Number.isFinite(seconds)
      ? Math.min(seconds * 1000, 60_000)
      : undefined;
  }
  return new HttpResponseError(
    response.statusText || `HTTP ${response.status}`,
    response.status,
    text.slice(0, 16 * 1024),
    retryAfterMs,
    serverCode
  );
}

/** Build the router deps against the fake server, mirroring the factory. */
function buildDeps(fake: FakeServer): AIChatLightweightCompletionDeps {
  const completeVia = (modelOverride?: string) => {
    // Shared request path for hosted/local completions over real HTTP.
    return async (
      request: OpenAIChatCompletionRequest,
      signal?: AbortSignal
    ): Promise<OpenAIChatCompletionResponse> => {
      const effective: OpenAIChatCompletionRequest = modelOverride
        ? { ...request, model: modelOverride }
        : request;
      // Non-caller timeout (10s) mirrors the client timeout: an abort that is
      // NOT the caller's signal classifies as timeout_ambiguous.
      const timeoutSignal = AbortSignal.timeout(10_000);
      const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      const response = await fetch(fake.url + COMPLETIONS_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(effective),
        signal: combined,
      });
      if (!response.ok) {
        throw await httpResponseErrorFrom(response);
      }
      return (await response.json()) as OpenAIChatCompletionResponse;
    };
  };
  return {
    resolveProvider: async () => ({ kind: "hosted", providerKind: "hosted" }),
    completeHosted: completeVia(),
    completeLocal: completeVia("llama3"),
    getSmallModelCapability: async () => {
      const response = await fetch(fake.url + "/api/ai/v1/models");
      if (!response.ok) return null;
      const body = (await response.json()) as {
        small_model?: OpenAISmallModelCapability;
      };
      return body.small_model ?? null;
    },
  };
}

function okCompletion(model: string): OpenAIChatCompletionResponse {
  return {
    id: "resp-1",
    object: "chat.completion",
    created: 1,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "summary" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

describe("AIChatLightweight fake-server integration (SMBW-018)", () => {
  let fake: FakeServer;

  beforeEach(async () => {
    fake = await startFakeServer();
    fake.setHandler(COMPLETIONS_PATH, () => ({
      status: 200,
      json: okCompletion("claude-haiku-resolved"),
    }));
  });

  afterEach(async () => {
    await fake.close();
  });

  it("discovers capability through GET /v1/models and uses the small route", async () => {
    fake.setModelsBody({
      object: "list",
      data: [{ id: "gpt-4o", object: "model" }],
      small_model: {
        available: true,
        resolved_model: "claude-haiku",
        context_size: 200_000,
        max_tokens: 8192,
      },
    });
    const svc = createLightweightCompletionService(buildDeps(fake));

    const result = await svc.complete({
      workload: "conversation_compact",
      messages: [{ role: "user", content: "x" }],
      manual: true,
    });

    expect(result.route).toBe("hosted_small");
    // The alias was sent; the resolved real model came back.
    const sent = fake.requests.find((r) => r.path === COMPLETIONS_PATH);
    expect(sent?.body?.model).toBe("small");
    expect(result.resolvedModel).toBe("claude-haiku-resolved");
  });

  it("missing capability metadata routes directly to normal with zero small requests", async () => {
    fake.setModelsBody({ object: "list", data: [] }); // no small_model block
    const svc = createLightweightCompletionService(buildDeps(fake));

    const result = await svc.complete({
      workload: "conversation_compact",
      messages: [{ role: "user", content: "x" }],
      normalModel: "normal-model",
      manual: true,
    });

    expect(result.route).toBe("provider_normal");
    expect(result.routeReason).toBe("capability_missing");
    const sent = fake.requests.find((r) => r.path === COMPLETIONS_PATH);
    expect(sent?.body?.model).toBe("normal-model");
    expect(fake.requests.filter((r) => r.path === COMPLETIONS_PATH)).toHaveLength(1);
  });

  it("machine-readable alias 404 opens a background cooldown with one request", async () => {
    fake.setModelsBody({
      object: "list",
      data: [],
      small_model: { available: true, context_size: 200_000 },
    });
    fake.setHandler(COMPLETIONS_PATH, () => ({
      status: 404,
      json: {
        error: {
          message: "No small model configured for this environment",
          type: "invalid_request_error",
          param: "model",
          code: "small_model_unavailable",
        },
      },
    }));
    const svc = createLightweightCompletionService(buildDeps(fake));

    await expect(
      svc.complete({
        workload: "user_auto_dream",
        messages: [{ role: "user", content: "x" }],
        manual: false,
      })
    ).rejects.toMatchObject({ reason: "small_model_unavailable" });

    // A subsequent BACKGROUND call is cooldown-skipped without a request.
    await expect(
      svc.complete({
        workload: "user_auto_dream",
        messages: [{ role: "user", content: "y" }],
        manual: false,
      })
    ).rejects.toBeInstanceOf(AIChatLightweightFailure);
    expect(fake.requests.filter((r) => r.path === COMPLETIONS_PATH)).toHaveLength(1);
  });

  it("manual compact alias 404 causes exactly one normal fallback request", async () => {
    fake.setModelsBody({
      object: "list",
      data: [],
      small_model: { available: true, context_size: 200_000 },
    });
    let calls = 0;
    fake.setHandler(COMPLETIONS_PATH, () => {
      calls += 1;
      if (calls === 1) {
        return {
          status: 404,
          json: {
            error: { code: "small_model_unavailable", message: "none" },
          },
        };
      }
      return { status: 200, json: okCompletion("normal-compact-model") };
    });
    const svc = createLightweightCompletionService(buildDeps(fake));

    const result = await svc.complete({
      workload: "conversation_compact",
      messages: [{ role: "user", content: "x" }],
      normalModel: "normal-compact-model",
      manual: true,
    });

    expect(result.route).toBe("normal_fallback");
    expect(result.resolvedModel).toBe("normal-compact-model");
    // Exactly one small attempt + one normal fallback = 2 total, never more.
    expect(fake.requests.filter((r) => r.path === COMPLETIONS_PATH)).toHaveLength(2);
  });

  it("429 with bounded Retry-After retries once and succeeds", async () => {
    fake.setModelsBody({
      object: "list",
      data: [],
      small_model: { available: true, context_size: 200_000 },
    });
    let calls = 0;
    fake.setHandler(COMPLETIONS_PATH, () => {
      calls += 1;
      if (calls === 1) {
        return {
          status: 429,
          headers: { "retry-after": "0.02" }, // 20ms — bounded and fast
          json: { error: { message: "rate limited" } },
        };
      }
      return { status: 200, json: okCompletion("claude-haiku-resolved") };
    });
    const svc = createLightweightCompletionService(buildDeps(fake));

    const result = await svc.complete({
      workload: "session_memory_summary",
      messages: [{ role: "user", content: "x" }],
      manual: false,
    });

    expect(result.route).toBe("hosted_small");
    expect(result.attemptCount).toBe(2);
    expect(result.retryReason).toBe("rate_limit");
    expect(fake.requests.filter((r) => r.path === COMPLETIONS_PATH)).toHaveLength(2);
  });

  it("ambiguous client timeout produces exactly one request (no duplicate)", async () => {
    fake.setModelsBody({
      object: "list",
      data: [],
      small_model: { available: true, context_size: 200_000 },
    });
    fake.setHandler(COMPLETIONS_PATH, () => ({
      status: 200,
      delayMs: 5_000, // slower than the caller's timeout below
      json: okCompletion("never-delivered"),
    }));
    // Deps with a 30ms client timeout that is NOT the caller's signal, so the
    // abort classifies as timeout_ambiguous rather than caller cancellation.
    const deps = buildDeps(fake);
    const completeWithTimeout = async (
      request: OpenAIChatCompletionRequest,
      signal?: AbortSignal
    ): Promise<OpenAIChatCompletionResponse> => {
      const timeout = AbortSignal.timeout(30);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const response = await fetch(fake.url + COMPLETIONS_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: combined,
      });
      if (!response.ok) throw await httpResponseErrorFrom(response);
      return (await response.json()) as OpenAIChatCompletionResponse;
    };
    const svc = createLightweightCompletionService({
      ...deps,
      completeHosted: completeWithTimeout,
    });

    await expect(
      svc.complete({
        workload: "user_auto_dream",
        messages: [{ role: "user", content: "x" }],
        manual: false,
      })
    ).rejects.toMatchObject({
      reason: expect.any(String),
    });
    // No retry, no fallback — exactly one wire request.
    expect(fake.requests.filter((r) => r.path === COMPLETIONS_PATH)).toHaveLength(1);
    const state = svc.getCooldownState("user_auto_dream");
    void state;
  }, 15_000);

  it("context overflow falls back once to the normal model", async () => {
    fake.setModelsBody({
      object: "list",
      data: [],
      small_model: { available: true, context_size: 4_096 },
    });
    let calls = 0;
    fake.setHandler(COMPLETIONS_PATH, () => {
      calls += 1;
      if (calls === 1) {
        return { status: 413, json: { error: { message: "too big" } } };
      }
      return { status: 200, json: okCompletion("normal-compact-model") };
    });
    const svc = createLightweightCompletionService(buildDeps(fake));

    const result = await svc.complete({
      workload: "conversation_compact",
      messages: [{ role: "user", content: "x" }],
      normalModel: "normal-compact-model",
      manual: true,
    });

    expect(result.route).toBe("normal_fallback");
    expect(result.fallbackReason).toBe("context_overflow");
    expect(fake.requests.filter((r) => r.path === COMPLETIONS_PATH)).toHaveLength(2);
  });

  it("local provider receives its configured real model, never the alias", async () => {
    const deps = buildDeps(fake);
    const svc = createLightweightCompletionService({
      ...deps,
      resolveProvider: async () => ({
        kind: "local",
        providerKind: "ollama" as const,
      }),
    });
    // Capability deliberately present — a local provider must ignore it.
    fake.setModelsBody({
      object: "list",
      data: [],
      small_model: { available: true, context_size: 200_000 },
    });

    const result = await svc.complete({
      workload: "conversation_compact",
      messages: [{ role: "user", content: "x" }],
      normalModel: "llama3",
      manual: true,
    });

    expect(result.route).toBe("provider_normal");
    const sent = fake.requests.find((r) => r.path === COMPLETIONS_PATH);
    expect(sent?.body?.model).toBe("llama3");
  });
});
