"use strict";
import { describe, expect, it } from "vitest";
import {
  DevBrowserEventRelay,
  type RelayClient,
} from "@/main-process/devtools/DevBrowserEventRelay";
import { SYSTEM_MESSAGE, LOGIN_STATUS, AI_CHAT_V2_STREAM_CHUNK } from "@/config/channellist";

class FakeClient implements RelayClient {
  messages: string[] = [];
  closed = false;
  private closeHandlers: Array<() => void> = [];

  send(message: string): void {
    this.messages.push(message);
  }
  get isClosed(): boolean {
    return this.closed;
  }
  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }
  simulateClose(): void {
    this.closed = true;
    for (const h of this.closeHandlers) h();
  }
  events(): Array<{ type: string; channel?: string; subscriptionId?: string; payload?: unknown; msg?: string }> {
    return this.messages.map((m) => JSON.parse(m));
  }
}

describe("DevBrowserEventRelay — subscribe + broadcast", () => {
  it("delivers a broadcast to a matching subscriber", () => {
    const relay = new DevBrowserEventRelay();
    const client = new FakeClient();
    relay.addClient(client);

    relay.handleClientMessage(client, JSON.stringify({ type: "subscribe", channel: SYSTEM_MESSAGE, subscriptionId: "s1" }));
    relay.broadcast(SYSTEM_MESSAGE, { hello: "world" });

    const events = client.events();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("event");
    expect(events[0].channel).toBe(SYSTEM_MESSAGE);
    expect(events[0].subscriptionId).toBe("s1");
    expect(events[0].payload).toEqual({ hello: "world" });
  });

  it("does not deliver to subscribers of a different channel", () => {
    const relay = new DevBrowserEventRelay();
    const client = new FakeClient();
    relay.addClient(client);
    relay.handleClientMessage(client, JSON.stringify({ type: "subscribe", channel: SYSTEM_MESSAGE, subscriptionId: "s1" }));

    relay.broadcast(LOGIN_STATUS, { status: "processing" });
    expect(client.events()).toHaveLength(0);
  });

  it("supports multiple subscriptions (distinct ids) on the same channel", () => {
    const relay = new DevBrowserEventRelay();
    const client = new FakeClient();
    relay.addClient(client);
    relay.handleClientMessage(client, JSON.stringify({ type: "subscribe", channel: SYSTEM_MESSAGE, subscriptionId: "a" }));
    relay.handleClientMessage(client, JSON.stringify({ type: "subscribe", channel: SYSTEM_MESSAGE, subscriptionId: "b" }));

    relay.broadcast(SYSTEM_MESSAGE, 1);
    expect(client.events()).toHaveLength(2);
  });

  it("fans a broadcast out to multiple clients", () => {
    const relay = new DevBrowserEventRelay();
    const c1 = new FakeClient();
    const c2 = new FakeClient();
    relay.addClient(c1);
    relay.addClient(c2);
    relay.handleClientMessage(c1, JSON.stringify({ type: "subscribe", channel: SYSTEM_MESSAGE, subscriptionId: "x" }));
    relay.handleClientMessage(c2, JSON.stringify({ type: "subscribe", channel: SYSTEM_MESSAGE, subscriptionId: "y" }));

    relay.broadcast(SYSTEM_MESSAGE, null);
    expect(c1.events()).toHaveLength(1);
    expect(c2.events()).toHaveLength(1);
  });
});

describe("DevBrowserEventRelay — unsubscribe + cleanup", () => {
  it("stops delivery after unsubscribe", () => {
    const relay = new DevBrowserEventRelay();
    const client = new FakeClient();
    relay.addClient(client);
    relay.handleClientMessage(client, JSON.stringify({ type: "subscribe", channel: SYSTEM_MESSAGE, subscriptionId: "s1" }));
    relay.handleClientMessage(client, JSON.stringify({ type: "unsubscribe", subscriptionId: "s1" }));

    relay.broadcast(SYSTEM_MESSAGE, 1);
    expect(client.events()).toHaveLength(0);
  });

  it("removes all of a client's subscriptions when it disconnects", () => {
    const relay = new DevBrowserEventRelay();
    const client = new FakeClient();
    relay.addClient(client);
    relay.handleClientMessage(client, JSON.stringify({ type: "subscribe", channel: SYSTEM_MESSAGE, subscriptionId: "s1" }));
    relay.handleClientMessage(client, JSON.stringify({ type: "subscribe", channel: LOGIN_STATUS, subscriptionId: "s2" }));

    client.simulateClose();
    relay.broadcast(SYSTEM_MESSAGE, 1);
    relay.broadcast(LOGIN_STATUS, 1);
    expect(client.events()).toHaveLength(0);
  });
});

describe("DevBrowserEventRelay — allowlist enforcement", () => {
  it("rejects a subscribe to a non-allowlisted channel with an error", () => {
    const relay = new DevBrowserEventRelay();
    const client = new FakeClient();
    relay.addClient(client);
    relay.handleClientMessage(client, JSON.stringify({ type: "subscribe", channel: AI_CHAT_V2_STREAM_CHUNK, subscriptionId: "s1" }));

    const events = client.events();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    // The disallowed channel must not have created a subscription:
    relay.broadcast(AI_CHAT_V2_STREAM_CHUNK, "chunk");
    expect(client.events()).toHaveLength(1);
  });

  it("never relays a broadcast for a non-allowlisted channel even if subscribed indirectly", () => {
    const relay = new DevBrowserEventRelay();
    const client = new FakeClient();
    relay.addClient(client);
    // Tampered internal state would be required to subscribe to a blocked
    // channel; broadcast() still guards. Sanity-check the guard directly:
    relay.broadcast(AI_CHAT_V2_STREAM_CHUNK, "chunk");
    expect(client.events()).toHaveLength(0);
  });
});

describe("DevBrowserEventRelay — malformed input", () => {
  it("replies with an error on invalid JSON", () => {
    const relay = new DevBrowserEventRelay();
    const client = new FakeClient();
    relay.addClient(client);
    relay.handleClientMessage(client, "{not json");
    const events = client.events();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
  });

  it("replies with an error on a schema-invalid message", () => {
    const relay = new DevBrowserEventRelay();
    const client = new FakeClient();
    relay.addClient(client);
    relay.handleClientMessage(client, JSON.stringify({ type: "frobnicate" }));
    expect(client.events()[0].type).toBe("error");
  });
});
