"use strict";
import { describe, expect, it } from "vitest";
import {
  BridgeInvokeRequestSchema,
  BridgeInvokeResponseSchema,
  BridgeClientEventSchema,
  BridgeConfigResponseSchema,
} from "@/main-process/devtools/DevBrowserSchemas";

describe("BridgeInvokeRequestSchema", () => {
  it("accepts a well-formed invoke request", () => {
    const r = BridgeInvokeRequestSchema.safeParse({
      channel: "app:info",
      data: { x: 1 },
      requestId: "req-1",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a request without optional data", () => {
    const r = BridgeInvokeRequestSchema.safeParse({
      channel: "app:info",
      requestId: "req-1",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a missing channel", () => {
    const r = BridgeInvokeRequestSchema.safeParse({ requestId: "req-1" });
    expect(r.success).toBe(false);
  });

  it("rejects a missing requestId", () => {
    const r = BridgeInvokeRequestSchema.safeParse({ channel: "app:info" });
    expect(r.success).toBe(false);
  });

  it("rejects an oversized channel name (allowlist hygiene)", () => {
    const r = BridgeInvokeRequestSchema.safeParse({
      channel: "x".repeat(200),
      requestId: "req-1",
    });
    expect(r.success).toBe(false);
  });
});

describe("BridgeInvokeResponseSchema", () => {
  it("accepts the canonical {status,msg,data,requestId} shape", () => {
    const r = BridgeInvokeResponseSchema.safeParse({
      status: true,
      msg: "",
      data: { a: 1 },
      requestId: "req-1",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a null data field (error responses)", () => {
    const r = BridgeInvokeResponseSchema.safeParse({
      status: false,
      msg: "nope",
      data: null,
      requestId: "req-1",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a non-boolean status", () => {
    const r = BridgeInvokeResponseSchema.safeParse({
      status: "true",
      msg: "",
      data: null,
      requestId: "req-1",
    });
    expect(r.success).toBe(false);
  });
});

describe("BridgeClientEventSchema", () => {
  it("accepts a subscribe event", () => {
    const r = BridgeClientEventSchema.safeParse({
      type: "subscribe",
      channel: "system:message",
      subscriptionId: "sub-1",
    });
    expect(r.success).toBe(true);
  });

  it("accepts an unsubscribe event", () => {
    const r = BridgeClientEventSchema.safeParse({
      type: "unsubscribe",
      subscriptionId: "sub-1",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown event type", () => {
    const r = BridgeClientEventSchema.safeParse({ type: "frobulate" });
    expect(r.success).toBe(false);
  });

  it("rejects subscribe without channel/subscriptionId", () => {
    expect(
      BridgeClientEventSchema.safeParse({ type: "subscribe" }).success
    ).toBe(false);
  });
});

describe("BridgeConfigResponseSchema", () => {
  it("accepts the config payload served by /config", () => {
    const r = BridgeConfigResponseSchema.safeParse({
      baseUrl: "http://127.0.0.1:37621",
      token: "tok-abc",
      allowedOrigin: "http://localhost:5173",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a config missing the token", () => {
    const r = BridgeConfigResponseSchema.safeParse({
      baseUrl: "http://127.0.0.1:37621",
      allowedOrigin: "http://localhost:5173",
    });
    expect(r.success).toBe(false);
  });
});
