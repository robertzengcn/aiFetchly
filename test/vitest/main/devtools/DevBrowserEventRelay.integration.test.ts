"use strict";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { DevBrowserBridge, BRIDGE_PATH_EVENTS } from "@/main-process/devtools/DevBrowserBridge";
import type { DevBrowserBridgeConfig } from "@/main-process/devtools/DevBrowserActivation";
import type { WebContentsLike } from "@/main-process/devtools/DevBrowserEventRelay";
import { SYSTEM_MESSAGE } from "@/config/channellist";

const ALLOWED_ORIGIN = "http://localhost:5173";
const CONFIG: DevBrowserBridgeConfig = {
  host: "127.0.0.1",
  port: 0,
  allowedOrigin: ALLOWED_ORIGIN,
};

let bridge: DevBrowserBridge;
let baseUrl: string;
let token: string;
const originalSend = vi.fn();
const fakeWebContents: WebContentsLike = { send: originalSend };

beforeAll(async () => {
  bridge = new DevBrowserBridge({
    config: CONFIG,
    generateToken: () => "ws-integration-token",
  });
  const info = await bridge.start();
  baseUrl = info.baseUrl;
  token = info.token;
  bridge.attachEventRelay(fakeWebContents);
});

afterAll(async () => {
  await bridge.stop();
});

function connect(queryToken: string, origin = ALLOWED_ORIGIN): WebSocket {
  const url = `${baseUrl.replace(/^http/, "ws")}${BRIDGE_PATH_EVENTS}?token=${encodeURIComponent(queryToken)}`;
  return new WebSocket(url, { headers: { Origin: origin } });
}

function waitForOpen(ws: WebSocket, ms = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("open timeout")), ms);
    ws.once("open", () => {
      clearTimeout(t);
      resolve();
    });
    ws.once("error", (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

function waitForMessage(ws: WebSocket, ms = 2000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("message timeout")), ms);
    ws.once("message", (data) => {
      clearTimeout(t);
      resolve(JSON.parse(String(data)));
    });
  });
}

describe("DevBrowserEventRelay — real WebSocket integration", () => {
  it("rejects an upgrade with a wrong token (no open)", async () => {
    const ws = connect("wrong-token");
    // Either 'error' or 'close' fires; 'open' must not.
    const outcome = await new Promise<"opened" | "rejected">((resolve) => {
      const decided = { v: false };
      ws.once("open", () => {
        if (!decided.v) {
          decided.v = true;
          resolve("opened");
        }
      });
      const reject = (): void => {
        if (!decided.v) {
          decided.v = true;
          resolve("rejected");
        }
      };
      ws.once("error", reject);
      ws.once("close", reject);
      ws.once("unexpected-response", reject);
    });
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    expect(outcome).toBe("rejected");
  });

  it("rejects an upgrade with a foreign origin", async () => {
    const ws = connect(token, "http://evil.example");
    const outcome = await new Promise<"opened" | "rejected">((resolve) => {
      ws.once("open", () => resolve("opened"));
      const r = (): void => resolve("rejected");
      ws.once("error", r);
      ws.once("close", r);
      ws.once("unexpected-response", r);
    });
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    expect(outcome).toBe("rejected");
  });

  it("relays a webContents.send event to a subscribed browser client", async () => {
    const ws = connect(token);
    await waitForOpen(ws);

    ws.send(JSON.stringify({ type: "subscribe", channel: SYSTEM_MESSAGE, subscriptionId: "e1" }));
    // Drain the (possible) ack/error window by waiting briefly, then broadcast.
    await new Promise((r) => setTimeout(r, 50));

    originalSend.mockClear();
    fakeWebContents.send(SYSTEM_MESSAGE, { text: "hello" });

    const msg = (await waitForMessage(ws)) as { type: string; channel: string; payload: unknown };
    expect(msg.type).toBe("event");
    expect(msg.channel).toBe(SYSTEM_MESSAGE);
    expect(msg.payload).toEqual({ text: "hello" });

    // The wrap must still call the original Electron send.
    expect(originalSend).toHaveBeenCalledWith(SYSTEM_MESSAGE, { text: "hello" });

    ws.close();
  });
});
