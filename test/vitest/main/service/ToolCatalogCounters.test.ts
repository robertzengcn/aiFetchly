import { describe, expect, it, beforeEach } from "vitest";
import { toolCatalogCounters } from "@/service/ToolCatalogCounters";

describe("ToolCatalogCounters", () => {
  beforeEach(() => {
    toolCatalogCounters.reset();
  });

  it("increments and reads a counter", () => {
    toolCatalogCounters.increment("search_calls");
    toolCatalogCounters.increment("search_calls");
    toolCatalogCounters.increment("search_selected_count", 3);
    expect(toolCatalogCounters.get("search_calls")).toBe(2);
    expect(toolCatalogCounters.get("search_selected_count")).toBe(3);
  });

  it("snapshot includes all keys with 0 default", () => {
    const snap = toolCatalogCounters.snapshot();
    expect(snap.search_calls).toBe(0);
    expect(snap.fallback_count).toBe(0);
    expect(snap.mcp_description_truncated_count).toBe(0);
    expect(snap.mcp_schema_pruned_count).toBe(0);
    expect(Object.keys(snap).length).toBeGreaterThanOrEqual(6);
  });

  it("reset clears all counters", () => {
    toolCatalogCounters.increment("fallback_count", 5);
    toolCatalogCounters.reset();
    expect(toolCatalogCounters.get("fallback_count")).toBe(0);
  });

  it("accumulates across increments", () => {
    for (let i = 0; i < 4; i++) toolCatalogCounters.increment("search_no_match");
    expect(toolCatalogCounters.snapshot().search_no_match).toBe(4);
  });
});
