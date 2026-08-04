/**
 * ToolCatalogCounters — process-wide, in-memory cumulative metrics for the
 * deferred tool catalog (PRD §14, FR-10).
 *
 * The per-round filter log (ToolCatalogMetricsService) covers each request;
 * these counters accumulate across the process lifetime so the app can report
 * totals like search success rate, fallback frequency, and MCP truncation
 * volume. They start as in-memory counters (PRD §14: "can start as structured
 * logs and later move to application diagnostics").
 *
 * Singleton: import `toolCatalogCounters`.
 */

export type ToolCatalogCounterKey =
  | "search_calls"
  | "search_no_match"
  | "search_selected_count"
  | "fallback_count"
  | "mcp_description_truncated_count"
  | "mcp_schema_pruned_count";

const ALL_KEYS: readonly ToolCatalogCounterKey[] = [
  "search_calls",
  "search_no_match",
  "search_selected_count",
  "fallback_count",
  "mcp_description_truncated_count",
  "mcp_schema_pruned_count",
];

export type ToolCatalogCounterSnapshot = Record<
  ToolCatalogCounterKey,
  number
>;

class ToolCatalogCountersImpl {
  private readonly counts = new Map<ToolCatalogCounterKey, number>();

  increment(key: ToolCatalogCounterKey, amount = 1): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + amount);
  }

  get(key: ToolCatalogCounterKey): number {
    return this.counts.get(key) ?? 0;
  }

  snapshot(): ToolCatalogCounterSnapshot {
    const out = {} as ToolCatalogCounterSnapshot;
    for (const k of ALL_KEYS) {
      out[k] = this.counts.get(k) ?? 0;
    }
    return out;
  }

  reset(): void {
    this.counts.clear();
  }

  /** Emit one structured log line with the current totals, then keep counting. */
  logSnapshot(): void {
    const s = this.snapshot();
    console.log(
      `[tool-catalog] event=tool_catalog_counters ` +
        `search_calls=${s.search_calls} search_no_match=${s.search_no_match} ` +
        `search_selected_count=${s.search_selected_count} fallback_count=${s.fallback_count} ` +
        `mcp_description_truncated_count=${s.mcp_description_truncated_count} ` +
        `mcp_schema_pruned_count=${s.mcp_schema_pruned_count}`
    );
  }
}

export const toolCatalogCounters = new ToolCatalogCountersImpl();
