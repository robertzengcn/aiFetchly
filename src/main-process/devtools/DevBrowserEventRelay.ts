"use strict";
/**
 * Dev Browser Bridge event relay (PRD FR-5; technical design §8).
 *
 * Two layers:
 *
 *   1. {@link DevBrowserEventRelay} — a transport-agnostic subscription hub.
 *      Browser clients are represented by the {@link RelayClient} interface so
 *      the subscription/broadcast logic is unit-testable without real sockets.
 *
 *   2. {@link attachWebSocketRelay} — the `ws` glue that validates the WS
 *      upgrade (origin + token), bridges `ws.WebSocket` to {@link RelayClient},
 *      and feeds client messages into the relay.
 *
 * Main->renderer events are tapped by wrapping `webContents.send`
 * ({@link wrapWebContentsSend}); every event the main process sends to the
 * Electron renderer is also fanned out to subscribed browser clients whose
 * channel is on the reviewed event allowlist.
 */
import http from "node:http";
import type { Socket } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import type { DevBrowserBridgeConfig } from "./DevBrowserActivation";
import { BridgeClientEventSchema } from "./DevBrowserSchemas";
import type { BridgeServerEvent } from "./DevBrowserSchemas";
import { isEventAllowed } from "./devBrowserChannels";
import { checkOrigin, checkBearerToken } from "./DevBrowserSecurity";
import { BRIDGE_PATH_EVENTS } from "./DevBrowserBridge";

/** Minimal, transport-agnostic representation of one connected browser. */
export interface RelayClient {
  send(message: string): void;
  readonly isClosed: boolean;
  onClose(handler: () => void): void;
}

interface Subscription {
  channel: string;
  client: RelayClient;
}

/** Minimal shape of Electron `webContents` needed to tap outgoing events. */
export interface WebContentsLike {
  send: (channel: string, ...args: unknown[]) => void;
}

/**
 * Transport-agnostic subscription hub. Tracks per-client subscriptions and
 * fans a broadcast out to every matching subscriber. Delivery is always gated
 * by the event allowlist — a non-reviewed channel is never relayed, even if a
 * client somehow subscribes to it.
 */
export class DevBrowserEventRelay {
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly clientSubscriptions = new Map<RelayClient, Set<string>>();

  /** Register a newly connected client and auto-clean on close. */
  addClient(client: RelayClient): void {
    client.onClose(() => this.removeClient(client));
  }

  /** Handle a single inbound client message (subscribe / unsubscribe). */
  handleClientMessage(client: RelayClient, raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.sendError(client, "invalid JSON message");
      return;
    }
    const result = BridgeClientEventSchema.safeParse(parsed);
    if (!result.success) {
      this.sendError(client, "invalid client event schema");
      return;
    }
    const msg = result.data;
    if (msg.type === "subscribe") {
      if (!isEventAllowed(msg.channel)) {
        this.sendError(client, `channel '${msg.channel}' is not on the event allowlist`, msg.subscriptionId);
        return;
      }
      this.subscriptions.set(msg.subscriptionId, { channel: msg.channel, client });
      this.clientSubscriptionsFor(client).add(msg.subscriptionId);
    } else {
      this.subscriptions.delete(msg.subscriptionId);
      this.clientSubscriptions.get(client)?.delete(msg.subscriptionId);
    }
  }

  /** Remove a client and every subscription it owned. */
  removeClient(client: RelayClient): void {
    const subs = this.clientSubscriptions.get(client);
    if (subs) {
      for (const id of subs) this.subscriptions.delete(id);
      this.clientSubscriptions.delete(client);
    }
  }

  /**
   * Fan an event out to every subscriber whose channel matches. No-op for
   * channels outside the reviewed allowlist.
   */
  broadcast(channel: string, payload: unknown): void {
    if (!isEventAllowed(channel)) return;
    for (const [subscriptionId, sub] of this.subscriptions) {
      if (sub.channel !== channel) continue;
      const evt: BridgeServerEvent = { type: "event", channel, subscriptionId, payload };
      try {
        sub.client.send(JSON.stringify(evt));
      } catch {
        // Client went away mid-send — its close handler will clean up.
      }
    }
  }

  private clientSubscriptionsFor(client: RelayClient): Set<string> {
    let set = this.clientSubscriptions.get(client);
    if (!set) {
      set = new Set();
      this.clientSubscriptions.set(client, set);
    }
    return set;
  }

  private sendError(client: RelayClient, msg: string, subscriptionId?: string): void {
    const evt: BridgeServerEvent = { type: "error", msg, subscriptionId };
    try {
      client.send(JSON.stringify(evt));
    } catch {
      /* swallow */
    }
  }
}

export interface AttachedRelay {
  relay: DevBrowserEventRelay;
  stop: () => void;
}

/**
 * Attach a WebSocket server to an existing HTTP server, validating the upgrade
 * (strict origin + per-session token via `?token=` query or Authorization
 * header). Returns the relay plus a stop() that closes all clients.
 */
export function attachWebSocketRelay(
  server: http.Server,
  config: DevBrowserBridgeConfig,
  getToken: () => string
): AttachedRelay {
  const relay = new DevBrowserEventRelay();
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (req: http.IncomingMessage, socket: Socket, head: Buffer): void => {
    let parsed: URL;
    try {
      parsed = new URL(req.url ?? "", "http://internal.local");
    } catch {
      socket.destroy();
      return;
    }
    if (parsed.pathname !== BRIDGE_PATH_EVENTS) return; // not our upgrade

    const originOk = checkOrigin(req.headers.origin, config.allowedOrigin).ok;
    const tokenFromQuery = parsed.searchParams.get("token");
    const tokenOk = tokenFromQuery
      ? checkBearerToken(`Bearer ${tokenFromQuery}`, getToken()).ok
      : checkBearerToken(req.headers.authorization, getToken()).ok;

    if (!originOk || !tokenOk) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const client = makeWsRelayClient(ws);
      relay.addClient(client);
      ws.on("message", (data: RawData) => relay.handleClientMessage(client, toString(data)));
    });
  };

  server.on("upgrade", onUpgrade);

  return {
    relay,
    stop: () => {
      wss.clients.forEach((c) => {
        try {
          c.close();
        } catch {
          /* ignore */
        }
      });
      wss.close();
      server.off("upgrade", onUpgrade);
    },
  };
}

/** Wrap `webContents.send` so every outgoing event is also relayed. */
export function wrapWebContentsSend(
  webContents: WebContentsLike,
  relay: DevBrowserEventRelay
): () => void {
  const originalSend = webContents.send.bind(webContents);
  const relayed: typeof webContents.send = (channel, ...args) => {
    try {
      relay.broadcast(channel, args[0]);
    } catch {
      // The relay must never break the real Electron send.
    }
    return originalSend(channel, ...args);
  };
  webContents.send = relayed;
  return () => {
    webContents.send = originalSend;
  };
}

// ---- ws helpers ------------------------------------------------------------

type RawData = { type: "Buffer"; data: number[] } | Buffer | ArrayBuffer | Buffer[];

function toString(data: RawData): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) {
    return Buffer.concat(data.filter(Buffer.isBuffer)).toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  // { type: "Buffer", data: number[] }
  return Buffer.from((data as { data: number[] }).data).toString("utf8");
}

function makeWsRelayClient(ws: WebSocket): RelayClient {
  return {
    send: (message: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    },
    get isClosed() {
      return ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING;
    },
    onClose: (handler: () => void) => {
      ws.on("close", handler);
    },
  };
}
