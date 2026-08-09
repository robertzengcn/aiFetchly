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
  let parsed: { model?: string; messages?: unknown[]; stream?: boolean; tools?: unknown[] } = {};
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
  const requestLog: RedactedRequest[] = [];

  const server = http.createServer(
    async (req, res) => {
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
        req.on("close", () => {
          // `close` fires after the response ends OR when the client aborts.
          // We only flag a disconnect if the response wasn't finished.
          if (!res.writableEnded) {
            clientDisconnected = true;
          }
        });
        const plan = resolveScenario(scenario);

        if (plan.kind === "http-error") {
          requestLog.push(
            redactChatRequest(req, rawBody, false)
          );
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
                await sleep(f.delayMs);
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
    }
  );

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
      headers: { "x-e2e-control-token": controlToken, ...(init?.headers ?? {}) },
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
