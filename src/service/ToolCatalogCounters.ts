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
  | "mcp_schema_pruned_count"
  /** FR-28 transparent deferred-load hydration replays (design §8.7). */
  | "hydration_replays"
  | "hydration_replay_exhausted"
  /** NFR-12 installer-policy routing (PRD §14 release metrics): explicit
   *  install-intent decisions seen, generic-tool fallbacks BLOCKED by the
   *  policy, and manual-action bounded approvals honored. */
  | "install_routing_explicit"
  | "install_fallback_blocked"
  | "install_manual_approval_honored"
  /** Audit R10 (design §19): prepare-to-ready timing — summed elapsed ms
   *  and the ready count (average = total / count). */
  | "install_prepare_to_ready_ms_total"
  | "install_ready_total"
  /** Audit R10 (design §19): first-tool-category correlation after an
   *  explicit install request — the alert dimension for "first tool was
   *  shell/file/search instead of the typed installer". */
  | "install_first_tool_installer"
  | "install_first_tool_shell"
  | "install_first_tool_file"
  | "install_first_tool_search"
  | "install_first_tool_other";

const ALL_KEYS: readonly ToolCatalogCounterKey[] = [
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

  /**
   * Turn-completion hook (NFR-12 release metrics): aggregate emission so
   * release builds produce observable routing/performance totals without a
   * diagnostics attachment. Rate-limited to once per 50 turns to keep log
   * volume bounded.
   */
  private turnsSinceEmit = 0;
  onTurnCompleted(): void {
    this.turnsSinceEmit += 1;
    if (this.turnsSinceEmit >= 50) {
      this.turnsSinceEmit = 0;
      this.logSnapshot();
    }
  }

  /** Emit one structured log line with the current totals, then keep counting.
   *
   * Audit R10: EVERY key in ALL_KEYS is emitted — hydration + installer
   * metrics included — and future keys are picked up automatically instead
   * of silently dropping out of the 50-turn event.
   */
  logSnapshot(): void {
    const s = this.snapshot();
    const fields = ALL_KEYS.map((k) => `${k}=${s[k]}`).join(" ");
    console.log(`[tool-catalog] event=tool_catalog_counters ${fields}`);
  }
}

export const toolCatalogCounters = new ToolCatalogCountersImpl();
