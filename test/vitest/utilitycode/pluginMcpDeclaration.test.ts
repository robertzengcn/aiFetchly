import { describe, it, expect } from "vitest";
import {
  parseServersJson,
  normalizeMcpDeclaration,
} from "@/service/PluginMcpDeclaration";
import type { PluginMcpServerDeclaration } from "@/entityTypes/pluginTypes";

const ROOT = "/tmp/plugin-root";

describe("parseServersJson", () => {
  it("parses a valid servers.json", () => {
    const result = parseServersJson(
      JSON.stringify({
        mcpServers: {
          "linkedin-browser": { command: "node", args: ["server.js"] },
        },
      }),
      "mcp/servers.json"
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.servers["linkedin-browser"]).toBeDefined();
    }
  });

  it("fails on invalid JSON", () => {
    const result = parseServersJson("{ not json", "mcp/servers.json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("mcp-config-invalid");
    }
  });

  it("fails when mcpServers field is missing", () => {
    const result = parseServersJson("{}", "mcp/servers.json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("mcp-config-invalid");
    }
  });
});

describe("normalizeMcpDeclaration", () => {
  it("defaults transport to stdio when command is present", () => {
    const r = normalizeMcpDeclaration(
      "foo",
      { command: "node", args: ["server.js"] },
      ROOT,
      "mcp/servers.json"
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized.transport).toBe("stdio");
      expect(r.normalized.command).toBe("node");
      expect(r.normalized.args).toEqual(["server.js"]);
    }
  });

  it("fails when stdio is missing a command", () => {
    const r = normalizeMcpDeclaration(
      "foo",
      { transport: "stdio" } as PluginMcpServerDeclaration,
      ROOT,
      "mcp/servers.json"
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("mcp-config-invalid");
    }
  });

  it("fails when sse has neither host nor url", () => {
    const r = normalizeMcpDeclaration(
      "foo",
      { transport: "sse" } as PluginMcpServerDeclaration,
      ROOT,
      "mcp/servers.json"
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("mcp-config-invalid");
    }
  });

  it("accepts sse with host", () => {
    const r = normalizeMcpDeclaration(
      "foo",
      { transport: "sse", host: "example.com", port: 8080 },
      ROOT,
      "mcp/servers.json"
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized.host).toBe("example.com");
      expect(r.normalized.port).toBe(8080);
    }
  });

  it("fails when args is not an array of strings", () => {
    const r = normalizeMcpDeclaration(
      "foo",
      { command: "node", args: [1, 2, 3] as unknown as string[] },
      ROOT,
      "mcp/servers.json"
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("mcp-config-invalid");
    }
  });

  it("preserves env placeholders in metadata", () => {
    const r = normalizeMcpDeclaration(
      "foo",
      { command: "node", env: { API_TOKEN: "${user:API_TOKEN}" } },
      ROOT,
      "mcp/servers.json"
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized.env.API_TOKEN).toBe("${user:API_TOKEN}");
    }
  });

  it("rejects relative commands containing ..", () => {
    const r = normalizeMcpDeclaration(
      "foo",
      { command: "../escape/bin" },
      ROOT,
      "mcp/servers.json"
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("path-outside-plugin");
    }
  });
});
