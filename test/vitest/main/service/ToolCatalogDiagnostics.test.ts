import { describe, expect, it } from "vitest";
import { formatToolCatalogBreakdown } from "@/service/ToolCatalogDiagnostics";
import type { ToolFunction } from "@/api/aiChatApi";

function tf(name: string, desc = "d"): ToolFunction {
  return { type: "function", name, description: desc, parameters: { type: "object" } };
}

describe("formatToolCatalogBreakdown", () => {
  it("reports total / always / deferred / contextual counts", () => {
    const out = formatToolCatalogBreakdown([
      tf("file_read"),
      tf("mcp_1_secret"),
    ]);
    expect(out).toContain("Tool catalog: 2 total");
    expect(out).toContain("always-loaded");
    expect(out).toContain("deferred");
    expect(out).toContain("tool_catalog_search");
  });

  it("lists the largest tools", () => {
    const out = formatToolCatalogBreakdown([
      tf("file_read"),
      tf("mcp_1_big", "x".repeat(500)),
    ]);
    expect(out).toContain("Largest tools:");
    expect(out).toContain("mcp_1_big");
  });

  it("omits the discovery hint when nothing is deferred", () => {
    const out = formatToolCatalogBreakdown([tf("file_read")]);
    expect(out).toContain("0 deferred");
    expect(out).not.toContain("tool_catalog_search");
  });

  it("returns a safe message when the catalog build throws", () => {
    const out = formatToolCatalogBreakdown(
      undefined as unknown as ToolFunction[]
    );
    expect(out).toContain("Tool catalog breakdown unavailable");
  });
});
