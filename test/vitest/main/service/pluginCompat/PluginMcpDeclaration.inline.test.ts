import { describe, it, expect } from "vitest";
import {
  normalizeInlineMcpMap,
  type NormalizedMcpServer,
} from "@/service/PluginMcpDeclaration";
import type { PluginMcpServerDeclaration } from "@/entityTypes/pluginTypes";

const ROOT = "/tmp/plugin";

describe("normalizeInlineMcpMap", () => {
  it("returns empty array for empty map", () => {
    const r = normalizeInlineMcpMap({}, ROOT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.servers).toEqual([]);
  });

  it("normalizes a single stdio server", () => {
    const map: Record<string, PluginMcpServerDeclaration> = {
      linkedin: { command: "node", args: ["server.js"] },
    };
    const r = normalizeInlineMcpMap(map, ROOT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.servers.length).toBe(1);
    const s: NormalizedMcpServer = r.servers[0];
    expect(s.serverName).toBe("linkedin");
    expect(s.transport).toBe("stdio");
    expect(s.command).toBe("node");
    expect(s.args).toEqual(["server.js"]);
  });

  it("normalizes multiple servers", () => {
    const r = normalizeInlineMcpMap(
      {
        a: { command: "node" },
        b: { transport: "sse", url: "http://x" },
      },
      ROOT
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.servers.map((s) => s.serverName).sort()).toEqual(["a", "b"]);
  });

  it("collects errors from individual servers but keeps valid ones", () => {
    const r = normalizeInlineMcpMap(
      {
        good: { command: "node" },
        bad: { transport: "sse" }, // missing host and url
      },
      ROOT
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].code).toBe("mcp-config-invalid");
  });

  it("rejects path-traversal in command path", () => {
    const r = normalizeInlineMcpMap(
      {
        evil: { command: "../../escape" },
      },
      ROOT
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].code).toBe("path-outside-plugin");
  });

  it("rejects a package-supplied reserved runtime-descriptor metadata key (H6)", () => {
    const r = normalizeInlineMcpMap(
      {
        smuggler: {
          command: "node",
          args: ["server.js"],
          metadata: {
            _aifetchlyRuntimeV1: {
              contractVersion: 1,
              runtime: "aifetchly-node",
              entry: "child.js",
            },
          },
        } as PluginMcpServerDeclaration,
      },
      ROOT
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].code).toBe("mcp-config-invalid");
    expect(r.errors[0].message).toMatch(/_aifetchlyRuntimeV1/);
  });

  it("still accepts non-reserved plugin metadata on generic servers", () => {
    const r = normalizeInlineMcpMap(
      { plain: { command: "node", args: [], metadata: { note: "hi" } } },
      ROOT
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.servers[0].metadata).toEqual({ note: "hi" });
  });
});
