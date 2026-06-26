// test/vitest/main/MCPTimeoutError.test.ts
import { describe, it, expect } from "vitest";
import { MCPTimeoutError } from "@/service/MCPTimeoutError";

describe("MCPTimeoutError", () => {
  it("carries serverName and toolName in the user-facing message", () => {
    const e = new MCPTimeoutError("fetch", "acme-server", 240_000);
    expect(e.message).toContain("acme-server");
    expect(e.message).toContain("fetch");
    expect(e.message).toContain("240000ms");
  });

  it("strips server/tool name from telemetryMessage", () => {
    const e = new MCPTimeoutError("fetch", "acme-server", 240_000);
    expect(e.telemetryMessage).not.toContain("acme-server");
    expect(e.telemetryMessage).not.toContain("fetch");
    expect(e.telemetryMessage).toContain("MCP");
  });

  it("isTelemetrySafe returns true", () => {
    const e = new MCPTimeoutError("fetch", "acme-server", 240_000);
    expect(e.isTelemetrySafe).toBe(true);
  });
});
