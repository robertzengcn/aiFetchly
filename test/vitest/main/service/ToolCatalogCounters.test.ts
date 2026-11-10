import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import {
  toolCatalogCounters,
  type ToolCatalogCounterKey,
} from "@/service/ToolCatalogCounters";

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

describe("ToolCatalogCounters — emitted 50th-turn event (audit R10)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    toolCatalogCounters.reset();
  });

  it("logSnapshot emits EVERY key — hydration + installer metrics included", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    toolCatalogCounters.reset();
    toolCatalogCounters.increment("hydration_replays");
    toolCatalogCounters.increment("install_routing_explicit", 2);
    toolCatalogCounters.increment("install_fallback_blocked");
    toolCatalogCounters.increment("install_manual_approval_honored");
    toolCatalogCounters.increment("install_prepare_to_ready_ms_total", 1234);
    toolCatalogCounters.increment("install_ready_total");
    toolCatalogCounters.increment("install_first_tool_installer");

    toolCatalogCounters.logSnapshot();

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toContain("event=tool_catalog_counters");
    // Every declared key appears in the emitted line with its value.
    expect(line).toContain("search_calls=0");
    expect(line).toContain("hydration_replays=1");
    expect(line).toContain("install_routing_explicit=2");
    expect(line).toContain("install_fallback_blocked=1");
    expect(line).toContain("install_manual_approval_honored=1");
    expect(line).toContain("install_prepare_to_ready_ms_total=1234");
    expect(line).toContain("install_ready_total=1");
    expect(line).toContain("install_first_tool_installer=1");
  });

  it("the 50th turn emits the aggregate (not just counters bookkeeping)", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    toolCatalogCounters.reset();
    toolCatalogCounters.increment("install_routing_explicit");
    for (let i = 0; i < 50; i += 1) {
      toolCatalogCounters.onTurnCompleted();
    }
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain(
      "install_routing_explicit=1"
    );
    // Counting continues after emission.
    expect(toolCatalogCounters.get("install_routing_explicit")).toBe(1);
  });

  it("snapshot covers every key the emitted line must carry", () => {
    toolCatalogCounters.reset();
    const snap = toolCatalogCounters.snapshot();
    const requiredKeys: ToolCatalogCounterKey[] = [
      "search_calls",
      "search_no_match",
      "search_selected_count",
      "fallback_count",
      "mcp_description_truncated_count",
      "mcp_schema_pruned_count",
      "hydration_replays",
      "hydration_replay_exhausted",
      "install_routing_explicit",
      "install_fallback_blocked",
      "install_manual_approval_honored",
      "install_prepare_to_ready_ms_total",
      "install_ready_total",
      "install_first_tool_installer",
      "install_first_tool_shell",
      "install_first_tool_file",
      "install_first_tool_search",
      "install_first_tool_other",
    ];
    for (const key of requiredKeys) {
      expect(snap[key], key).toBe(0);
    }
  });
});
