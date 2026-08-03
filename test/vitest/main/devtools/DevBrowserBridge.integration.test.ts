"use strict";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DevBrowserBridge,
  BRIDGE_PATH_INVOKE,
  BRIDGE_PATH_CONFIG,
} from "@/main-process/devtools/DevBrowserBridge";
import { DevBrowserDispatcher } from "@/main-process/devtools/DevBrowserDispatcher";
import type { DevBrowserBridgeConfig } from "@/main-process/devtools/DevBrowserActivation";
import { GET_APP_INFO } from "@/config/channellist";

const ALLOWED_ORIGIN = "http://localhost:5173";

const CONFIG: DevBrowserBridgeConfig = {
  // port 0 = ephemeral, assigned by the OS
  host: "127.0.0.1",
  port: 0,
  allowedOrigin: ALLOWED_ORIGIN,
};

let bridge: DevBrowserBridge;
let baseUrl: string;
let token: string;

beforeAll(async () => {
  bridge = new DevBrowserBridge({
    config: CONFIG,
    dispatcher: new DevBrowserDispatcher(
      new Map([
        [GET_APP_INFO, async () => ({ status: true, msg: "", data: { version: "9.9.9" } })],
      ])
    ),
    generateToken: () => "fixed-integration-token",
  });
  const info = await bridge.start();
  baseUrl = info.baseUrl;
  token = info.token;
});

afterAll(async () => {
  await bridge.stop();
});

async function jsonRes(res: Response): Promise<Record<string, unknown>> {
  const body = (await res.json()) as Record<string, unknown>;
  return body;
}

describe("DevBrowserBridge — real HTTP server integration", () => {
  it("starts on an ephemeral port and serves the config (origin-gated)", async () => {
    const res = await fetch(`${baseUrl}${BRIDGE_PATH_CONFIG}`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });
    expect(res.status).toBe(200);
    const body = await jsonRes(res);
    expect(body.token).toBe(token);
    expect(body.baseUrl).toBe(baseUrl);
    expect(body.allowedOrigin).toBe(ALLOWED_ORIGIN);
  });

  it("rejects /config from a foreign origin with 403", async () => {
    const res = await fetch(`${baseUrl}${BRIDGE_PATH_CONFIG}`, {
      headers: { Origin: "http://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("round-trips an allowed invoke through the full server", async () => {
    const res = await fetch(`${baseUrl}${BRIDGE_PATH_INVOKE}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({ channel: GET_APP_INFO, requestId: "int-1" }),
    });
    expect(res.status).toBe(200);
    const body = await jsonRes(res);
    expect(body.status).toBe(true);
    expect(body.requestId).toBe("int-1");
    expect(body.data).toEqual({ version: "9.9.9" });
  });

  it("returns 401 when the token is wrong", async () => {
    const res = await fetch(`${baseUrl}${BRIDGE_PATH_INVOKE}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-token",
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({ channel: GET_APP_INFO, requestId: "int-2" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 + {status:false} for a blocked channel", async () => {
    const res = await fetch(`${baseUrl}${BRIDGE_PATH_INVOKE}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({ channel: "PLUGIN_IMPORT", requestId: "int-3" }),
    });
    expect(res.status).toBe(200);
    const body = await jsonRes(res);
    expect(body.status).toBe(false);
  });

  it("answers a CORS preflight with 204 and ACAO for the allowed origin", async () => {
    const res = await fetch(`${baseUrl}${BRIDGE_PATH_INVOKE}`, {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, content-type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
  });
});
