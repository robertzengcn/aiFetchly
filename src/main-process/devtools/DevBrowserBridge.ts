"use strict";
/**
 * Dev Browser Bridge HTTP server (PRD FR-1, FR-4, FR-6; technical design §6/§7).
 *
 * Two layers:
 *
 *   1. {@link handleBridgeHttpRequest} — a PURE async request handler with no
 *      socket dependency. It owns all security (origin, token, size), schema
 *      validation, and dispatch routing, returning a plain response object.
 *      This is what unit tests exercise.
 *
 *   2. {@link DevBrowserBridge} — a thin `http.createServer` wrapper that owns
 *      the per-session token, reads request bodies, and adapts the pure
 *      handler's response onto a real `http.ServerResponse`.
 *
 * Endpoints (all under `/__aifetchly_dev_bridge/`):
 *   - OPTIONS  any path      → CORS preflight (origin-gated)
 *   - GET      /config       → delivers {baseUrl, token, allowedOrigin}
 *                              (origin-gated, NO token required)
 *   - POST     /invoke       → dispatch an allowed channel (origin+token-gated)
 *   - GET      /events       → WebSocket upgrade (handled in Task 5)
 *
 * Response contract for /invoke mirrors the IPC `{status,msg,data}` pattern
 * plus `requestId`. Auth/origin/size/schema failures use HTTP 4xx so the
 * renderer transport can distinguish them (FR-7.3); blocked channels return
 * HTTP 200 with `{status:false}` to match the IPC contract (FR-4.3).
 */
import http from "node:http";
import crypto from "node:crypto";
import type { DevBrowserBridgeConfig } from "./DevBrowserActivation";
import { DevBrowserDispatcher } from "./DevBrowserDispatcher";
import {
  checkOrigin,
  checkBearerToken,
  checkPayloadSize,
  MAX_PAYLOAD_BYTES,
} from "./DevBrowserSecurity";
import { BridgeInvokeRequestSchema } from "./DevBrowserSchemas";
import type { BridgeConfigResponse } from "./DevBrowserSchemas";

export const BRIDGE_PATH_PREFIX = "/__aifetchly_dev_bridge";
export const BRIDGE_PATH_INVOKE = `${BRIDGE_PATH_PREFIX}/invoke`;
export const BRIDGE_PATH_CONFIG = `${BRIDGE_PATH_PREFIX}/config`;
export const BRIDGE_PATH_EVENTS = `${BRIDGE_PATH_PREFIX}/events`;

/** Normalized inbound request handed to the pure handler. */
export interface BridgeHttpRequest {
  method: string;
  path: string;
  origin: string | undefined;
  authHeader: string | undefined;
  body: Buffer;
}

/** Outbound response produced by the pure handler; adapted onto the socket. */
export interface BridgeHttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  /** JSON-serializable body. For 204 pass undefined. */
  body: unknown;
}

interface BridgeHandlerContext {
  config: DevBrowserBridgeConfig;
  token: string;
  baseUrl: string;
  dispatcher: DevBrowserDispatcher;
}

function corsHeaders(
  originOk: boolean,
  allowedOrigin: string
): Record<string, string> {
  if (!originOk) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function json(
  statusCode: number,
  body: unknown,
  extraHeaders: Record<string, string> = {}
): BridgeHttpResponse {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body,
  };
}

/**
 * Pure bridge request handler. No socket, no globals — fully unit-testable.
 */
export async function handleBridgeHttpRequest(
  req: BridgeHttpRequest,
  ctx: BridgeHandlerContext
): Promise<BridgeHttpResponse> {
  const method = req.method.toUpperCase();
  const originOk = checkOrigin(req.origin, ctx.config.allowedOrigin).ok;

  // CORS preflight — origin-gated, no auth (browser cannot attach it).
  if (method === "OPTIONS") {
    if (!originOk) {
      return json(
        403,
        { msg: "invalid origin" },
        corsHeaders(false, ctx.config.allowedOrigin)
      );
    }
    return {
      statusCode: 204,
      headers: corsHeaders(true, ctx.config.allowedOrigin),
      body: undefined,
    };
  }

  if (req.path === BRIDGE_PATH_CONFIG) {
    if (method !== "GET") {
      return json(
        405,
        { msg: "method not allowed" },
        corsHeaders(originOk, ctx.config.allowedOrigin)
      );
    }
    if (!originOk) {
      return json(
        403,
        { msg: "invalid origin" },
        corsHeaders(false, ctx.config.allowedOrigin)
      );
    }
    const payload: BridgeConfigResponse = {
      baseUrl: ctx.baseUrl,
      token: ctx.token,
      allowedOrigin: ctx.config.allowedOrigin,
    };
    return json(200, payload, corsHeaders(true, ctx.config.allowedOrigin));
  }

  if (req.path === BRIDGE_PATH_INVOKE) {
    const cors = corsHeaders(originOk, ctx.config.allowedOrigin);
    if (method !== "POST") {
      return json(405, { msg: "method not allowed" }, cors);
    }
    if (!originOk) {
      return json(
        403,
        { msg: "invalid origin" },
        corsHeaders(false, ctx.config.allowedOrigin)
      );
    }
    const tokenCheck = checkBearerToken(req.authHeader, ctx.token);
    if (!tokenCheck.ok) {
      return json(401, { msg: tokenCheck.reason }, cors);
    }
    const sizeCheck = checkPayloadSize(req.body.length);
    if (!sizeCheck.ok) {
      return json(413, { msg: sizeCheck.reason }, cors);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(req.body.toString("utf8"));
    } catch {
      return json(400, { msg: "invalid JSON body" }, cors);
    }
    const schemaResult = BridgeInvokeRequestSchema.safeParse(parsed);
    if (!schemaResult.success) {
      return json(400, { msg: "invalid invoke request schema" }, cors);
    }
    const { channel, data, requestId } = schemaResult.data;
    const result = await ctx.dispatcher.dispatch(channel, data);
    return json(
      200,
      {
        status: result.status,
        msg: result.msg,
        data: result.data ?? null,
        requestId,
      },
      cors
    );
  }

  // Unknown path. Still emit CORS for the allowed origin so browser error
  // handlers can read the response body.
  return json(
    404,
    { msg: "not found" },
    corsHeaders(originOk, ctx.config.allowedOrigin)
  );
}

export interface DevBrowserBridgeInfo {
  baseUrl: string;
  token: string;
  allowedOrigin: string;
}

export interface DevBrowserBridgeOptions {
  config: DevBrowserBridgeConfig;
  dispatcher?: DevBrowserDispatcher;
  /** Injectable for deterministic tests. Defaults to a 32-byte hex token. */
  generateToken?: () => string;
  /**
   * Hook invoked on every `upgrade` request. The HTTP server in this layer
   * never handles WebSocket upgrades itself; the WS relay (Task 5) registers
   * here so start()/stop() lifecycle stays centralized.
   */
  onUpgrade?: (
    req: http.IncomingMessage,
    socket: import("node:net").Socket,
    head: Buffer
  ) => void;
}

export class DevBrowserBridge {
  readonly config: DevBrowserBridgeConfig;
  private readonly dispatcher: DevBrowserDispatcher;
  private readonly generateToken: () => string;
  private readonly onUpgrade?: DevBrowserBridgeOptions["onUpgrade"];
  private token = "";
  private server: http.Server | null = null;
  /** Actual bound port (differs from config.port when config.port === 0). */
  private actualPort = 0;

  constructor(opts: DevBrowserBridgeOptions) {
    this.config = opts.config;
    this.dispatcher = opts.dispatcher ?? new DevBrowserDispatcher();
    this.generateToken =
      opts.generateToken ?? (() => crypto.randomBytes(32).toString("hex"));
    this.onUpgrade = opts.onUpgrade;
  }

  /** Per-session bearer token (available after start()). */
  getToken(): string {
    return this.token;
  }

  /** Base URL the server is reachable at (available after start()). */
  getBaseUrl(): string {
    const port = this.actualPort || this.config.port;
    return `http://${this.config.host}:${port}`;
  }

  /**
   * Start the HTTP server and generate the per-session token.
   * Resolves with the info needed for logging and renderer config delivery.
   */
  async start(): Promise<DevBrowserBridgeInfo> {
    this.token = this.generateToken();
    const server = http.createServer((req, res) => this.adapt(req, res));
    this.server = server;

    if (this.onUpgrade) {
      server.on("upgrade", this.onUpgrade);
    }

    await new Promise<void>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException): void => {
        server.removeListener("listening", onListening);
        reject(err);
      };
      const onListening = (): void => {
        server.removeListener("error", onError);
        const addr = server.address();
        this.actualPort =
          typeof addr === "object" && addr ? addr.port : this.config.port;
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.config.port, this.config.host);
    });

    return {
      baseUrl: this.getBaseUrl(),
      token: this.token,
      allowedOrigin: this.config.allowedOrigin,
    };
  }

  /** Stop the HTTP server. Safe to call multiple times. */
  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  /** Adapt a raw IncomingMessage/ServerResponse onto the pure handler. */
  private async adapt(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const origin = readHeader(req.headers.origin);
    const authHeader = readHeader(req.headers.authorization);

    let body: Buffer;
    try {
      body = await readBody(req);
    } catch {
      // Oversized/malformed body stream — reject before dispatching, with a
      // 413 and CORS headers for the (possibly valid) origin so the browser
      // can read the error.
      writeResponse(res, {
        statusCode: 413,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(
            checkOrigin(origin, this.config.allowedOrigin).ok,
            this.config.allowedOrigin
          ),
        },
        body: { msg: "payload too large" },
      });
      return;
    }

    let outcome: BridgeHttpResponse;
    try {
      outcome = await handleBridgeHttpRequest(
        {
          method: req.method ?? "GET",
          path: req.url ?? "/",
          origin,
          authHeader,
          body,
        },
        {
          config: this.config,
          token: this.token,
          baseUrl: this.getBaseUrl(),
          dispatcher: this.dispatcher,
        }
      );
    } catch {
      outcome = {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: { msg: "internal bridge error" },
      };
    }

    writeResponse(res, outcome);
  }
}

function readHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Read and buffer the request body, capped at the payload limit. */
function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_PAYLOAD_BYTES) {
        if (!aborted) {
          aborted = true;
          reject(new Error("payload too large"));
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function writeResponse(
  res: http.ServerResponse,
  outcome: BridgeHttpResponse
): void {
  const body =
    outcome.body === undefined
      ? undefined
      : Buffer.from(JSON.stringify(outcome.body), "utf8");
  const headers: Record<string, string> = { ...outcome.headers };
  if (body !== undefined) {
    headers["Content-Length"] = String(body.length);
  }
  res.writeHead(outcome.statusCode, headers);
  res.end(body);
}
