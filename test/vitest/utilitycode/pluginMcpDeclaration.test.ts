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

describe("normalizeMcpDeclaration — host runtime variant", () => {
  it("normalizes a valid runtime/entry declaration", () => {
    const r = normalizeMcpDeclaration(
      "scraper",
      { transport: "stdio", runtime: "aifetchly-node", entry: "dist/server.cjs" },
      ROOT,
      ".mcp.json"
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized.runtime).toBe("aifetchly-node");
      expect(r.normalized.entry).toBe("dist/server.cjs");
      expect(r.normalized.command).toBeUndefined();
      expect(r.normalized.args).toEqual([]);
      expect(
        r.normalized.metadata["_aifetchlyRuntimeV1"]
      ).toEqual({
        contractVersion: 1,
        runtime: "aifetchly-node",
        entry: "dist/server.cjs",
      });
    }
  });

  it("rejects an unknown runtime", () => {
    const r = normalizeMcpDeclaration(
      "scraper",
      { runtime: "system-node" } as unknown as PluginMcpServerDeclaration,
      ROOT,
      ".mcp.json"
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("mcp-config-invalid");
  });

  it("rejects runtime combined with command", () => {
    const r = normalizeMcpDeclaration(
      "scraper",
      {
        runtime: "aifetchly-node",
        entry: "dist/server.cjs",
        command: "node",
      } as PluginMcpServerDeclaration,
      ROOT,
      ".mcp.json"
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("mcp-config-invalid");
      expect(r.error.message).toContain("mutually exclusive");
    }
  });

  it("rejects a missing entry", () => {
    const r = normalizeMcpDeclaration(
      "scraper",
      { runtime: "aifetchly-node" } as PluginMcpServerDeclaration,
      ROOT,
      ".mcp.json"
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("mcp-config-invalid");
  });

  it("rejects an absolute or traversal entry", () => {
    for (const entry of ["/etc/passwd", "../escape.cjs", "a/../../b.cjs"]) {
      const r = normalizeMcpDeclaration(
        "scraper",
        { runtime: "aifetchly-node", entry },
        ROOT,
        ".mcp.json"
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("path-outside-plugin");
    }
  });

  it("overwrites a package-supplied reserved runtime metadata key", () => {
    const r = normalizeMcpDeclaration(
      "scraper",
      {
        runtime: "aifetchly-node",
        entry: "dist/server.cjs",
        metadata: {
          _aifetchlyRuntimeV1: { contractVersion: 1, runtime: "aifetchly-node", entry: "/etc/evil.cjs" },
        },
      },
      ROOT,
      ".mcp.json"
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const descriptor = r.normalized.metadata["_aifetchlyRuntimeV1"] as {
        entry: string;
      };
      expect(descriptor.entry).toBe("dist/server.cjs");
    }
  });
});
