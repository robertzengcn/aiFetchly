/**
 * FakeOpenAI-compatible loopback server for Electron E2E AI tests (design §9).
 *
 * Listens on an ephemeral loopback port and implements:
 *   GET  /v1/models              — OpenAI-compatible model list
 *   POST /v1/chat/completions    — SSE stream driven by the active scenario
 *   POST /__e2e/scenario         — select the active scenario (control)
 *   GET  /__e2e/requests         — redacted request log (control)
 *   POST /__e2e/reset            — clear scenario + request log (control)
 *
 * Control endpoints require a random worker-scoped token in the
 * `x-e2e-control-token` header and are never under `/v1`, so they can never be
 * reached via the application's provider base URL.
 *
 * The request log is REDACTED: method, path, model, message count + roles,
 * stream flag, advertised tool names, and client-disconnect observation. It
 * never stores prompts, attachment contents, or auth headers (design §9.6).
 */

import * as http from "http";
import * as crypto from "crypto";
import {
  MODELS_RESPONSE,
  toolCallChunk,
  toolCallFinishChunk,
  type FakeAiScenarioName,
} from "../scenarios/openAiProtocol";
import { resolveScenario } from "../scenarios/aiChatScenarios";

export interface RedactedRequest {
  readonly method: string;
  readonly path: string;
  readonly model: string | undefined;
  readonly messageCount: number;
  readonly roles: readonly string[];
  readonly stream: boolean;
  readonly toolNames: readonly string[];
  readonly clientDisconnected: boolean;
  readonly timestamp: number;
}

export interface FakeOpenAiController {
  /** Provider base URL to configure in the app (ends in /v1). */
  readonly providerBaseUrl: string;
  readonly port: number;
  setScenario(name: FakeAiScenarioName): Promise<void>;
  /** Configure a tool call for the next (non-continuation) chat request. */
  setToolCall(name: string, argsJson: string): Promise<void>;
  /**
   * Configure MULTIPLE tool calls in one response (queue/steering E2E):
   * the app's loop executes them sequentially, so steering committed while
   * the stream is still open lands at the after_model boundary and skips
   * every unstarted call. `delayMs` delays before the first tool-call delta
   * so the test can click Steer mid-stream.
   */
  setToolCalls(
    calls: ReadonlyArray<{ name: string; arguments: string }>,
    delayMs?: number
  ): Promise<void>;
  getRequests(): Promise<readonly RedactedRequest[]>;
  reset(): Promise<void>;
  stop(): Promise<void>;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(data));
  });
}

function redactChatRequest(
  req: http.IncomingMessage,
  rawBody: string,
  clientDisconnected: boolean
): RedactedRequest {
  let parsed: {
    model?: string;
    messages?: unknown[];
    stream?: boolean;
    tools?: unknown[];
  } = {};
  try {
    parsed = JSON.parse(rawBody) as typeof parsed;
  } catch {
    /* keep defaults */
  }
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  const roles = Array.from(
    new Set(
      messages
        .map((m) => (m as { role?: string }).role)
        .filter((r): r is string => typeof r === "string")
    )
  );
  const toolNames = (Array.isArray(parsed.tools) ? parsed.tools : [])
    .map((t) => (t as { function?: { name?: string } })?.function?.name)
    .filter((n): n is string => typeof n === "string");
  return {
    method: req.method ?? "GET",
    path: req.url ?? "/",
    model: parsed.model,
    messageCount: messages.length,
    roles,
    stream: parsed.stream === true,
    toolNames,
    clientDisconnected,
    timestamp: Date.now(),
  };
}

export async function startFakeOpenAiServer(): Promise<FakeOpenAiController> {
  const controlToken = crypto.randomBytes(8).toString("hex");
  let scenario: FakeAiScenarioName = "stream-text";
  /** Optional tool call to emit on the next (non-continuation) chat request. */
  let toolCallConfig: { name: string; arguments: string } | null = null;
  /** Optional multi-call variant (queue/steering E2E). */
  let toolCallsConfig: {
    calls: ReadonlyArray<{ name: string; arguments: string }>;
    delayMs: number;
  } | null = null;
  const requestLog: RedactedRequest[] = [];

  /** True when a chat request carries a tool-result message (the continuation
   * after the app executed an approved tool). */
  function hasToolResultMessage(rawBody: string): boolean {
    try {
      const parsed = JSON.parse(rawBody) as { messages?: unknown[] };
      return Array.isArray(parsed.messages)
        ? parsed.messages.some((m) => (m as { role?: string }).role === "tool")
        : false;
    } catch {
      return false;
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "/";
    const isControl = url.startsWith("/__e2e/");
    if (isControl) {
      const provided = req.headers["x-e2e-control-token"];
      if (provided !== controlToken) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "forbidden" }));
        return;
      }
      const body = await readBody(req);
      if (req.method === "POST" && url === "/__e2e/scenario") {
        try {
          const parsed = JSON.parse(body) as { name?: FakeAiScenarioName };
          if (parsed.name) {
            scenario = parsed.name;
          }
        } catch {
          /* ignore */
        }
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === "POST" && url === "/__e2e/reset") {
        requestLog.length = 0;
        scenario = "stream-text";
        toolCallConfig = null;
        toolCallsConfig = null;
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === "POST" && url === "/__e2e/tool-call") {
        try {
          const parsed = JSON.parse(body) as {
            name?: string;
            arguments?: string;
            calls?: ReadonlyArray<{ name: string; arguments?: string }>;
            delayMs?: number;
          };
          if (Array.isArray(parsed.calls) && parsed.calls.length > 0) {
            toolCallsConfig = {
              calls: parsed.calls.map((call) => ({
                name: call.name,
                arguments: call.arguments ?? "{}",
              })),
              delayMs: parsed.delayMs ?? 0,
            };
            toolCallConfig = null;
          } else if (parsed.name) {
            toolCallConfig = {
              name: parsed.name,
              arguments: parsed.arguments ?? "{}",
            };
            toolCallsConfig = null;
          } else {
            toolCallConfig = null;
            toolCallsConfig = null;
          }
        } catch {
          /* ignore */
        }
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === "GET" && url === "/__e2e/requests") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(requestLog));
        return;
      }
      res.writeHead(404);
      res.end();
      return;
    }

    // Provider endpoints.
    if (url === "/v1/models" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(MODELS_RESPONSE));
      return;
    }

    if (url === "/v1/chat/completions" && req.method === "POST") {
      const rawBody = await readBody(req);
      let clientDisconnected = false;
      // An interruptible signal that resolves the moment the client aborts
      // mid-stream, so long delay frames (the cancel barrier) wake at once and
      // the request is recorded with clientDisconnected=true promptly.
      let signalGone: () => void = () => {};
      const clientGone = new Promise<void>((resolve) => {
        signalGone = resolve;
      });
      const onClientGone = (): void => {
        if (!res.writableEnded) {
          clientDisconnected = true;
          signalGone();
        }
      };
      // Cover the different ways Node http signals a mid-stream client abort.
      req.on("close", onClientGone);
      req.on("aborted", onClientGone);
      res.on("close", onClientGone);
      // Determine the effective plan for this request:
      //  - a tool-result continuation (app executed an approved tool + fed the
      //    result back) -> short follow-up completion.
      //  - else a configured tool call -> emit tool_calls so the app's approval
      //    flow can gate execution.
      //  - else the active scenario.
      const isContinuation = hasToolResultMessage(rawBody);
      let plan;
      if (isContinuation) {
        plan = resolveScenario("tool-success-followup");
      } else if (toolCallsConfig) {
        plan = {
          kind: "sse" as const,
          frames: [
            ...toolCallsConfig.calls.map((call, index) => ({
              delayMs: index === 0 ? toolCallsConfig.delayMs : 0,
              payload: toolCallChunk({
                index,
                id: `call_e2e_multi_${index}`,
                name: call.name,
                arguments: call.arguments,
              }),
            })),
            { delayMs: 0, payload: toolCallFinishChunk() },
          ],
        };
      } else if (toolCallConfig) {
        plan = {
          kind: "sse" as const,
          frames: [
            {
              delayMs: 0,
              payload: toolCallChunk({
                index: 0,
                id: "call_e2e_1",
                name: toolCallConfig.name,
                arguments: toolCallConfig.arguments,
              }),
            },
            { delayMs: 0, payload: toolCallFinishChunk() },
          ],
        };
      } else {
        plan = resolveScenario(scenario);
      }

      if (plan.kind === "http-error") {
        requestLog.push(redactChatRequest(req, rawBody, false));
        res.writeHead(plan.status, { "Content-Type": "application/json" });
        res.end(plan.body);
        return;
      }

      // Stream-ish scenarios all start an SSE response.
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const frames =
        plan.kind === "sse"
          ? plan.frames
          : plan.kind === "disconnect"
          ? plan.leadingFrames
          : [];

      try {
        if (plan.kind === "raw-bytes") {
          res.write(plan.bytes);
          res.end();
        } else {
          for (const f of frames) {
            if (f.delayMs > 0) {
              await Promise.race([sleep(f.delayMs), clientGone]);
            }
            if (res.destroyed || clientDisconnected) {
              break;
            }
            res.write(`data: ${f.payload}\n\n`);
          }
          if (!res.destroyed && !clientDisconnected) {
            res.write("data: [DONE]\n\n");
          }
          res.end();
        }
      } catch {
        try {
          res.destroy();
        } catch {
          /* ignore */
        }
      }

      // Record AFTER handling so clientDisconnected reflects the outcome. For
      // the disconnect scenario the recorded value is true only if the client
      // actually went away; otherwise (server severed) it stays false here and
      // the cancellation test asserts via client abort.
      requestLog.push(redactChatRequest(req, rawBody, clientDisconnected));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not found" } }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  const controlFetch = async (
    path: string,
    init?: RequestInit
  ): Promise<Response> => {
    return fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      headers: {
        "x-e2e-control-token": controlToken,
        ...(init?.headers ?? {}),
      },
    });
  };

  return {
    providerBaseUrl: `http://127.0.0.1:${port}/v1`,
    port,
    async setScenario(name: FakeAiScenarioName): Promise<void> {
      await controlFetch("/__e2e/scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
    },
    async setToolCall(name: string, argsJson: string): Promise<void> {
      await controlFetch("/__e2e/tool-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, arguments: argsJson }),
      });
    },
    async setToolCalls(
      calls: ReadonlyArray<{ name: string; arguments: string }>,
      delayMs = 0
    ): Promise<void> {
      await controlFetch("/__e2e/tool-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calls, delayMs }),
      });
    },
    async getRequests(): Promise<readonly RedactedRequest[]> {
      const r = await controlFetch("/__e2e/requests");
      return (await r.json()) as RedactedRequest[];
    },
    async reset(): Promise<void> {
      await controlFetch("/__e2e/reset", { method: "POST" });
    },
    stop(): Promise<void> {
      return new Promise((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
