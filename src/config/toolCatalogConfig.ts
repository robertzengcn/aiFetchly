/**
 * Configuration for the deferred tool catalog (AI Tool List Management).
 *
 * Feature flag `AI_TOOL_SEARCH` controls rollout:
 *   off  -> current behavior (full tool list every round)
 *   on   -> always deferred catalog filtering
 *   auto -> deferred only when estimated deferred payload exceeds threshold
 *
 * Default is `off` so the first merge changes no model behavior. Rollback is
 * simply `AI_TOOL_SEARCH=off` — no code change required.
 */

export const TOOL_CATALOG_SEARCH_TOOL_NAME = "tool_catalog_search";

export const TOOL_CATALOG_ENV = {
  mode: "AI_TOOL_SEARCH",
  thresholdPercent: "AI_TOOL_SEARCH_THRESHOLD_PERCENT",
  fallbackContextWindow: "AI_TOOL_FALLBACK_CONTEXT_WINDOW",
} as const;

export const TOOL_CATALOG_DEFAULTS = {
  /** Default mode when AI_TOOL_SEARCH is unset. Safe = no behavior change. */
  mode: "off" as const,
  /** Deferred payload % of context window that triggers deferred mode in auto. */
  autoThresholdPercent: 10,
  /** Chars-per-token heuristic for local token estimation. */
  charsPerToken: 4,
  /** Max chars for a catalog entry's short description. */
  shortDescriptionChars: 240,
  /** Max chars for an MCP tool description sent to the model. */
  mcpDescriptionChars: 2048,
  /** Max chars for a pruned JSON schema before structural pruning kicks in. */
  schemaMaxChars: 12000,
  /** Default number of search results returned by tool_catalog_search. */
  searchDefaultMaxResults: 5,
  /** Hard cap on search results. */
  searchMaxResults: 10,
  /** Number of largest tools reported in metrics. */
  largestToolMetricCount: 10,
  /** Fallback context window when no model metadata is available. */
  fallbackContextWindowTokens: 128_000,
} as const;

export type ToolCatalogMode = "off" | "on" | "auto";

/**
 * Parse AI_TOOL_SEARCH into a normalized mode.
 * Unset -> default (`off`). Invalid -> `auto` with a warning.
 */
export function resolveToolCatalogMode(
  raw: string | undefined
): { mode: ToolCatalogMode; fallbackUsed: boolean } {
  if (raw === undefined || raw === "") {
    return { mode: TOOL_CATALOG_DEFAULTS.mode, fallbackUsed: false };
  }
  const v = raw.trim().toLowerCase();
  if (v === "off" || v === "on" || v === "auto") {
    return { mode: v, fallbackUsed: false };
  }
  console.warn(
    `[tool-catalog] invalid AI_TOOL_SEARCH="${raw}", falling back to auto`
  );
  return { mode: "auto", fallbackUsed: true };
}

/** Read a positive integer env override, or `undefined` when absent/invalid. */
export function resolvePositiveIntEnv(
  raw: string | undefined
): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return undefined;
  return n;
}
