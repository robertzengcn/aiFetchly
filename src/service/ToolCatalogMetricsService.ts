/**
 * ToolCatalogMetricsService — builds metrics snapshots for one round and
 * emits structured, secret-free log lines (FR-10, design §21).
 *
 * Logs contain tool names and sizes only — never full schemas, tool arguments,
 * auth config, or environment variables.
 */

import { TOOL_CATALOG_DEFAULTS } from "@/config/toolCatalogConfig";
import { estimateToolTokens } from "@/service/ToolPromptBudgetService";
import type {
  ToolCatalog,
  ToolCatalogFilterResult,
  ToolCatalogLargestTool,
  ToolCatalogMetrics,
} from "@/entityTypes/toolCatalogTypes";

export interface ToolCatalogMetricsInput {
  readonly discoveredCount: number;
  readonly exposedTools: readonly import("@/api/aiChatApi").OpenAITool[];
}

export function buildMetrics(
  catalog: ToolCatalog,
  input: ToolCatalogMetricsInput
): ToolCatalogMetrics {
  const largestTools = [...catalog.entries]
    .sort((a, b) => b.estimatedTokens - a.estimatedTokens)
    .slice(0, TOOL_CATALOG_DEFAULTS.largestToolMetricCount)
    .map(
      (e): ToolCatalogLargestTool => ({
        name: e.name,
        source: e.source,
        estimatedTokens: e.estimatedTokens,
      })
    );

  const estimatedExposedTokens = input.exposedTools.reduce(
    (sum, t) => sum + estimateToolTokens(t),
    0
  );

  return {
    totalCount: catalog.entries.length,
    alwaysCount: catalog.always.length,
    deferredCount: catalog.deferred.length,
    contextualCount: catalog.contextual.length,
    discoveredCount: input.discoveredCount,
    exposedCount: input.exposedTools.length,
    estimatedTotalTokens: catalog.totalEstimatedTokens,
    estimatedExposedTokens,
    largestTools,
  };
}

/**
 * Emit one structured log line for a round's filter result. Names + sizes only.
 */
export function logToolCatalogFilter(input: {
  readonly conversationId: string;
  readonly result: ToolCatalogFilterResult;
}): void {
  const { conversationId, result } = input;
  const m = result.metrics;
  const largest = m.largestTools
    .slice(0, 3)
    .map(
      (t) =>
        `{name:${t.name},source:${t.source},tokens:${t.estimatedTokens}}`
    )
    .join(",");

  console.log(
    `[tool-catalog] event=tool_catalog_filter conversationId=${conversationId} mode=${result.mode} total=${m.totalCount} always=${m.alwaysCount} deferred=${m.deferredCount} contextual=${m.contextualCount} discovered=${m.discoveredCount} exposed=${m.exposedCount} estTotalTokens=${m.estimatedTotalTokens} estExposedTokens=${m.estimatedExposedTokens} largest=[${largest}] reason=${truncateForLog(result.reason)}`
  );
}

function truncateForLog(s: string, max = 160): string {
  return s.length <= max ? s : `${s.slice(0, max)}...`;
}
