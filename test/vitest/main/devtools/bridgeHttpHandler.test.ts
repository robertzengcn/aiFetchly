"use strict";
import { describe, expect, it } from "vitest";
import { handleBridgeHttpRequest } from "@/main-process/devtools/DevBrowserBridge";
import { DevBrowserDispatcher } from "@/main-process/devtools/DevBrowserDispatcher";
import type { DevBrowserBridgeConfig } from "@/main-process/devtools/DevBrowserActivation";
import { GET_APP_INFO } from "@/config/channellist";
import { MAX_PAYLOAD_BYTES } from "@/main-process/devtools/DevBrowserSecurity";

const CONFIG: DevBrowserBridgeConfig = {
  host: "127.0.0.1",
  port: 37621,
  allowedOrigin: "http://localhost:5173",
};
const TOKEN = "tok-xyz";
const BASE_URL = `http://${CONFIG.host}:${CONFIG.port}`;

function makeDispatcher(): DevBrowserDispatcher {
  return new DevBrowserDispatcher(
    new Map([
      [
        GET_APP_INFO,
        async () => ({ status: true, msg: "", data: { version: "1.2.3" } }),
      ],
    ])
  );
}

function ctx(dispatcher = makeDispatcher()) {
  return { config: CONFIG, token: TOKEN, baseUrl: BASE_URL, dispatcher };
}

function asJson(body: unknown): Record<string, unknown> {
  if (body && typeof body === "object") return body as Record<string, unknown>;
  throw new Error("body is not an object");
}

describe("handleBridgeHttpRequest — CORS preflight", () => {
  it("returns 204 with CORS headers for a valid-origin OPTIONS", async () => {
    const res = await handleBridgeHttpRequest(
      {
        method: "OPTIONS",
        path: "/x",
        origin: CONFIG.allowedOrigin,
        authHeader: undefined,
        body: Buffer.alloc(0),
      },
      ctx()
    );
    expect(res.statusCode).toBe(204);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe(
      CONFIG.allowedOrigin
    );
    expect(res.headers["Access-Control-Allow-Headers"]).toMatch(
      /authorization/i
    );
    expect(res.headers["Access-Control-Allow-Methods"]).toMatch(/POST/i);
    expect(res.headers["Vary"]).toMatch(/Origin/i);
  });

  it("returns 403 for an invalid-origin OPTIONS and withholds ACAO", async () => {
    const res = await handleBridgeHttpRequest(
      {
        method: "OPTIONS",
        path: "/x",
        origin: "http://evil.example",
        authHeader: undefined,
        body: Buffer.alloc(0),
      },
      ctx()
    );
    expect(res.statusCode).toBe(403);
    expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});

describe("handleBridgeHttpRequest — GET /config (token delivery)", () => {
  const path = "/__aifetchly_dev_bridge/config";

  it("delivers baseUrl + token for a valid origin WITHOUT requiring a token", async () => {
    const res = await handleBridgeHttpRequest(
      {
        method: "GET",
        path,
        origin: CONFIG.allowedOrigin,
        authHeader: undefined,
        body: Buffer.alloc(0),
      },
      ctx()
    );
    expect(res.statusCode).toBe(200);
    const body = asJson(res.body);
    expect(body.token).toBe(TOKEN);
    expect(body.baseUrl).toBe(BASE_URL);
    expect(body.allowedOrigin).toBe(CONFIG.allowedOrigin);
  });

  it("returns 403 for an invalid origin", async () => {
    const res = await handleBridgeHttpRequest(
      {
        method: "GET",
        path,
        origin: "http://evil.example",
        authHeader: undefined,
        body: Buffer.alloc(0),
      },
      ctx()
    );
    expect(res.statusCode).toBe(403);
    expect(asJson(res.body).token).toBeUndefined();
  });

  it("returns 403 for a missing origin", async () => {
    const res = await handleBridgeHttpRequest(
      {
        method: "GET",
        path,
        origin: undefined,
        authHeader: undefined,
        body: Buffer.alloc(0),
      },
      ctx()
    );
    expect(res.statusCode).toBe(403);
  });
});

describe("handleBridgeHttpRequest — POST /invoke", () => {
  const path = "/__aifetchly_dev_bridge/invoke";

  async function post(opts: {
    origin?: string;
    /** `null` = explicitly no Authorization header; omit = valid token. */
    authHeader?: string | null;
    body: unknown;
  }) {
    const body = Buffer.from(JSON.stringify(opts.body));
    const authHeader =
      opts.authHeader === undefined
        ? `Bearer ${TOKEN}`
        : opts.authHeader ?? undefined;
    return handleBridgeHttpRequest(
      {
        method: "POST",
        path,
        origin: opts.origin ?? CONFIG.allowedOrigin,
        authHeader,
        body,
      },
      ctx()
    );
  }

  it("dispatches an allowed channel and returns the {status,msg,data,requestId} contract", async () => {
    const res = await post({
      body: { channel: GET_APP_INFO, requestId: "r1" },
    });
    expect(res.statusCode).toBe(200);
    const b = asJson(res.body);
    expect(b.status).toBe(true);
    expect(b.requestId).toBe("r1");
    expect(b.data).toEqual({ version: "1.2.3" });
  });

  it("echoes the requestId for correlation", async () => {
    const res = await post({
      body: { channel: GET_APP_INFO, requestId: "corr-99" },
    });
    expect(asJson(res.body).requestId).toBe("corr-99");
  });

  it("returns 401 for a missing token (FR-7.3 invalid token)", async () => {
    const res = await post({
      authHeader: null,
      body: { channel: GET_APP_INFO, requestId: "r1" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 for a wrong token", async () => {
    const res = await post({
      authHeader: "Bearer wrong",
      body: { channel: GET_APP_INFO, requestId: "r1" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for an invalid origin (FR-7.3 origin/blocked)", async () => {
    const res = await post({
      origin: "http://evil.example",
      body: { channel: GET_APP_INFO, requestId: "r1" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 200 + {status:false} for a blocked channel (FR-4.3)", async () => {
    const res = await post({
      body: { channel: "dangerous:channel", requestId: "r1" },
    });
    expect(res.statusCode).toBe(200);
    const b = asJson(res.body);
    expect(b.status).toBe(false);
    expect(b.requestId).toBe("r1");
  });

  it("blocks a channel that has a dispatcher handler but is not on the allowlist (defense-in-depth)", async () => {
    // The dispatcher has a handler for a non-allowlisted channel. The allowlist
    // gate must block it independently — the two must never silently diverge.
    const ctxWithExtra = ctx(
      new DevBrowserDispatcher(
        new Map([
          [
            "evil:channel",
            async () => ({ status: true, msg: "", data: "leaked" }),
          ],
        ])
      )
    );
    const res = await handleBridgeHttpRequest(
      {
        method: "POST",
        path,
        origin: CONFIG.allowedOrigin,
        authHeader: `Bearer ${TOKEN}`,
        body: Buffer.from(
          JSON.stringify({ channel: "evil:channel", requestId: "r1" })
        ),
      },
      ctxWithExtra
    );
    expect(res.statusCode).toBe(200);
    const body = asJson(res.body);
    expect(body.status).toBe(false);
    expect(body.data).toBeNull();
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await handleBridgeHttpRequest(
      {
        method: "POST",
        path,
        origin: CONFIG.allowedOrigin,
        authHeader: `Bearer ${TOKEN}`,
        body: Buffer.from("{not json"),
      },
      ctx()
    );
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for schema-invalid body (missing requestId)", async () => {
    const res = await post({ body: { channel: GET_APP_INFO } });
    expect(res.statusCode).toBe(400);
  });

  it("returns 413 for an oversized payload", async () => {
    const big = Buffer.alloc(MAX_PAYLOAD_BYTES + 1, 65); // 'A'
    const res = await handleBridgeHttpRequest(
      {
        method: "POST",
        path,
        origin: CONFIG.allowedOrigin,
        authHeader: `Bearer ${TOKEN}`,
        body: big,
      },
      ctx()
    );
    expect(res.statusCode).toBe(413);
  });

  it("returns 405 for GET on the invoke path", async () => {
    const res = await handleBridgeHttpRequest(
      {
        method: "GET",
        path,
        origin: CONFIG.allowedOrigin,
        authHeader: undefined,
        body: Buffer.alloc(0),
      },
      ctx()
    );
    expect(res.statusCode).toBe(405);
  });
});

describe("handleBridgeHttpRequest — routing", () => {
  it("returns 404 for an unknown path", async () => {
    const res = await handleBridgeHttpRequest(
      {
        method: "GET",
        path: "/nope",
        origin: CONFIG.allowedOrigin,
        authHeader: undefined,
        body: Buffer.alloc(0),
      },
      ctx()
    );
    expect(res.statusCode).toBe(404);
  });
});
