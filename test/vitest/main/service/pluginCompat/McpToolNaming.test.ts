import { describe, it, expect } from "vitest";
import {
  buildPluginToolName,
  parseMcpToolName,
  isPluginOwnedToolName,
} from "@/service/pluginCompat/McpToolNaming";

describe("McpToolNaming", () => {
  describe("buildPluginToolName", () => {
    it("produces mcp__plugin__server__tool format", () => {
      expect(buildPluginToolName("lead-pack", "linkedin", "search")).toBe(
        "mcp__lead-pack__linkedin__search"
      );
    });

    it("preserves underscores in tool names", () => {
      expect(
        buildPluginToolName("p", "srv", "do_something_deep")
      ).toBe("mcp__p__srv__do_something_deep");
    });
  });

  describe("isPluginOwnedToolName", () => {
    it("returns true for mcp__ prefix", () => {
      expect(isPluginOwnedToolName("mcp__p__s__t")).toBe(true);
    });
    it("returns false for legacy mcp_ prefix", () => {
      expect(isPluginOwnedToolName("mcp_5_search")).toBe(false);
    });
    it("returns false for non-mcp names", () => {
      expect(isPluginOwnedToolName("other_tool")).toBe(false);
    });
  });

  describe("parseMcpToolName", () => {
    it("parses legacy format (mcp_<serverId>_<tool>)", () => {
      const r = parseMcpToolName("mcp_42_search");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.kind).toBe("legacy");
      if (r.kind !== "legacy") return;
      expect(r.serverId).toBe(42);
      expect(r.toolName).toBe("search");
    });

    it("parses legacy format with underscores in tool name", () => {
      const r = parseMcpToolName("mcp_7_do_thing_deep");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.kind).toBe("legacy");
      if (r.kind !== "legacy") return;
      expect(r.serverId).toBe(7);
      expect(r.toolName).toBe("do_thing_deep");
    });

    it("parses plugin format (mcp__plugin__server__tool)", () => {
      const r = parseMcpToolName("mcp__lead-pack__linkedin__search");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.kind).toBe("plugin");
      if (r.kind !== "plugin") return;
      expect(r.pluginName).toBe("lead-pack");
      expect(r.unscopedServerName).toBe("linkedin");
      expect(r.toolName).toBe("search");
    });

    it("parses plugin format with underscores in tool name", () => {
      const r = parseMcpToolName("mcp__p__s__do_deep_thing");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      if (r.kind !== "plugin") return;
      expect(r.toolName).toBe("do_deep_thing");
    });

    it("rejects mcp__ with too few segments", () => {
      expect(parseMcpToolName("mcp__only").ok).toBe(false);
      expect(parseMcpToolName("mcp__a__b").ok).toBe(false);
    });

    it("rejects non-mcp names", () => {
      expect(parseMcpToolName("foo_bar_baz").ok).toBe(false);
    });

    it("rejects legacy with non-numeric serverId", () => {
      const r = parseMcpToolName("mcp_abc_search");
      expect(r.ok).toBe(false);
    });
  });
});
