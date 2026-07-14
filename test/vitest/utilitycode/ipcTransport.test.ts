"use strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  chooseTransportKind,
  resolveIpcTransport,
  createDevBrowserBridgeTransport,
  UnavailableIpcTransport,
  __resetIpcTransportForTests,
} from "@/views/utils/ipcTransport";
import { GET_APP_INFO } from "@/config/channellist";

// Wire-contract path constants the renderer transport talks to.
const CONFIG_PATH = "/__aifetchly_dev_bridge/config";
const INVOKE_PATH = "/__aifetchly_dev_bridge/invoke";

describe("chooseTransportKind — resolution order (FR-3.1 / FR-3.2 / FR-3.3)", () => {
  it("prefers the Electron preload when window.api exists", () => {
    expect(chooseTransportKind(true, true)).toBe("electron-preload");
    expect(chooseTransportKind(true, false)).toBe("electron-preload");
  });

  it("falls back to the dev browser bridge in dev when window.api is absent", () => {
    expect(chooseTransportKind(false, true)).toBe("dev-browser-bridge");
  });

  it("is unavailable in a non-dev browser without window.api", () => {
    expect(chooseTransportKind(false, false)).toBe("unavailable");
  });
});

describe("UnavailableIpcTransport — fails clearly (FR-3.3)", () => {
  it("throws an actionable message on every method", () => {
    const transport = new UnavailableIpcTransport();
    expect(transport.source).toBe("unavailable");
    expect(() => transport.invoke("ANY_CHANNEL")).toThrow(
      /unavailable outside Electron/i
    );
    expect(() => transport.send("ANY_CHANNEL")).toThrow(
      /unavailable outside Electron/i
    );
    expect(() => transport.receive("ANY_CHANNEL", () => undefined)).toThrow(
      /unavailable outside Electron/i
    );
    expect(() => transport.invokeBinary("ANY_CHANNEL")).toThrow(
      /unavailable outside Electron/i
    );
    expect(() => transport.sendBinary("ANY_CHANNEL")).toThrow(
      /unavailable outside Electron/i
    );
    expect(() => transport.removeAllListeners("ANY_CHANNEL")).toThrow(
      /unavailable outside Electron/i
    );
  });

  it("includes the channel name in the message for diagnosis (FR-7.3)", () => {
    const transport = new UnavailableIpcTransport();
    expect(() => transport.invoke("GET_APP_INFO")).toThrow(/GET_APP_INFO/);
  });
});

// ---------------------------------------------------------------------------
// Integration: DevBrowserBridgeTransport against a minimal wire-contract server.
// ---------------------------------------------------------------------------

const TOKEN = "renderer-transport-token";
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === CONFIG_PATH) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          baseUrl,
          token: TOKEN,
          allowedOrigin: "http://localhost:5173",
        })
      );
      return;
    }
    if (url === INVOKE_PATH && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body) as {
          channel: string;
          requestId: string;
        };
        if (req.headers.authorization !== `Bearer ${TOKEN}`) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ msg: "invalid or missing token" }));
          return;
        }
        // Allowed channel -> success payload; anything else -> blocked.
        if (parsed.channel === GET_APP_INFO) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              status: true,
              msg: "",
              data: { version: "1.0.0-test" },
              requestId: parsed.requestId,
            })
          );
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              status: false,
              msg: `Channel '${parsed.channel}' is not available through the dev browser bridge.`,
              data: null,
              requestId: parsed.requestId,
            })
          );
        }
      });
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ msg: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("DevBrowserBridgeTransport — invoke over a wire-contract server", () => {
  it("fetches /config then dispatches an allowed invoke", async () => {
    const transport = createDevBrowserBridgeTransport({
      baseUrl,
      fetch: fetch.bind(globalThis),
    });
    const result = await transport.invoke(GET_APP_INFO);
    expect(result).toBeDefined();
    expect(result?.status).toBe(true);
    expect(result?.data).toEqual({ version: "1.0.0-test" });
  });

  it("returns {status:false} for a blocked channel (FR-4.3)", async () => {
    const transport = createDevBrowserBridgeTransport({
      baseUrl,
      fetch: fetch.bind(globalThis),
    });
    const result = await transport.invoke("PLUGIN_IMPORT");
    expect(result?.status).toBe(false);
  });

  it("invokeBinary throws a clear message in browser mode", async () => {
    const transport = createDevBrowserBridgeTransport({ baseUrl });
    await expect(transport.invokeBinary("ANY")).rejects.toThrow(
      /binary invoke is not supported/i
    );
  });

  it("fails clearly when the bridge is unreachable (FR-3.3)", async () => {
    const transport = createDevBrowserBridgeTransport({
      baseUrl: "http://127.0.0.1:1", // port 1 is reserved/unreachable
      fetch: fetch.bind(globalThis),
    });
    await expect(transport.invoke(GET_APP_INFO)).rejects.toThrow(
      /not available|unreachable|fetch|ECONN/i
    );
  });
});

describe("resolveIpcTransport — bridge chosen in this Node env", () => {
  it("resolves to the dev browser bridge when there is no window.api and DEV is true", () => {
    __resetIpcTransportForTests();
    // In the utilityCode Node env there is no window.api, so the resolver
    // picks the bridge transport.
    const t = resolveIpcTransport();
    expect(t.source).toBe("dev-browser-bridge");
    __resetIpcTransportForTests();
  });
});
