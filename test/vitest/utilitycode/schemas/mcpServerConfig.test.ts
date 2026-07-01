import { describe, it, expect } from "vitest";
import {
  mcpServerConfigSchema,
  mcpServerConfigUpdateSchema,
} from "@/schemas/config/mcpServer";

describe("mcpServerConfigSchema", () => {
  it("accepts a minimal valid config", () => {
    const r = mcpServerConfigSchema().safeParse({
      serverName: "my-mcp",
      transport: "stdio",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a fully-populated config", () => {
    const r = mcpServerConfigSchema().safeParse({
      serverName: "remote",
      host: "mcp.example.com",
      port: 8080,
      transport: "sse",
      enabled: true,
      authType: "bearer_token",
      authConfig: { token: "xxx" },
      timeout: 30000,
      metadata: { origin: "manual" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects missing serverName", () => {
    const r = mcpServerConfigSchema().safeParse({ transport: "stdio" });
    expect(r.success).toBe(false);
  });

  it("rejects unknown transport value", () => {
    const r = mcpServerConfigSchema().safeParse({
      serverName: "x",
      transport: "grpc",
    });
    expect(r.success).toBe(false);
  });

  it("rejects port out of range", () => {
    const tooBig = mcpServerConfigSchema().safeParse({
      serverName: "x",
      transport: "sse",
      port: 99999,
    });
    expect(tooBig.success).toBe(false);

    const zero = mcpServerConfigSchema().safeParse({
      serverName: "x",
      transport: "sse",
      port: 0,
    });
    expect(zero.success).toBe(false);
  });

  it("rejects unknown authType", () => {
    const r = mcpServerConfigSchema().safeParse({
      serverName: "x",
      transport: "stdio",
      authType: "oauth",
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative timeout", () => {
    const r = mcpServerConfigSchema().safeParse({
      serverName: "x",
      transport: "stdio",
      timeout: -1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects unexpected extra keys (strictObject)", () => {
    const r = mcpServerConfigSchema().safeParse({
      serverName: "x",
      transport: "stdio",
      rogueField: true,
    });
    expect(r.success).toBe(false);
  });
});

describe("mcpServerConfigUpdateSchema", () => {
  it("accepts empty object (Partial)", () => {
    const r = mcpServerConfigUpdateSchema().safeParse({});
    expect(r.success).toBe(true);
  });

  it("accepts partial update with single field", () => {
    const r = mcpServerConfigUpdateSchema().safeParse({ enabled: false });
    expect(r.success).toBe(true);
  });

  it("still validates field shape on partial update", () => {
    const r = mcpServerConfigUpdateSchema().safeParse({
      transport: "bogus",
    });
    expect(r.success).toBe(false);
  });

  it("accepts port within range on partial update", () => {
    const r = mcpServerConfigUpdateSchema().safeParse({ port: 443 });
    expect(r.success).toBe(true);
  });
});
