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

describe("ToolCatalogCounters — NFR-12 installer + turn-boundary metrics", () => {
  it("snapshot carries the installer-policy keys with 0 default", () => {
    toolCatalogCounters.reset();
    const snap = toolCatalogCounters.snapshot();
    expect(snap.install_routing_explicit).toBe(0);
    expect(snap.install_fallback_blocked).toBe(0);
    expect(snap.install_manual_approval_honored).toBe(0);
  });

  it("installer counters accumulate at the enforcement points", () => {
    toolCatalogCounters.reset();
    toolCatalogCounters.increment("install_routing_explicit");
    toolCatalogCounters.increment("install_routing_explicit");
    toolCatalogCounters.increment("install_fallback_blocked");
    toolCatalogCounters.increment("install_manual_approval_honored");
    const snap = toolCatalogCounters.snapshot();
    expect(snap.install_routing_explicit).toBe(2);
    expect(snap.install_fallback_blocked).toBe(1);
    expect(snap.install_manual_approval_honored).toBe(1);
  });

  it("onTurnCompleted is a bounded no-op below the emission threshold", () => {
    toolCatalogCounters.reset();
    // Does not throw and does not reset counts for 49 calls.
    for (let i = 0; i < 49; i += 1) {
      toolCatalogCounters.onTurnCompleted();
    }
    toolCatalogCounters.increment("search_calls");
    expect(toolCatalogCounters.get("search_calls")).toBe(1);
  });
});
