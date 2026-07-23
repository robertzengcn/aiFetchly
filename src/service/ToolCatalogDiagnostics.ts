/**
 * User-facing diagnostics for the deferred tool catalog (PRD US-3, §12).
 *
 * Produces a compact markdown breakdown of total / always-loaded / deferred /
 * contextual tool counts plus the largest tools, for the `/skills` command and
 * (later) a settings UI. Kept separate from ToolCatalogMetricsService to avoid
 * a circular import with ToolCatalogService.
 */

import type { OpenAITool, ToolFunction } from "@/api/aiChatApi";
import { ToolCatalogService } from "@/service/ToolCatalogService";
import { buildMetrics } from "@/service/ToolCatalogMetricsService";
import type { ToolCatalogRuntimeContext } from "@/entityTypes/toolCatalogTypes";

const DIAGNOSTICS_CONTEXT: ToolCatalogRuntimeContext = {
  conversationId: "diagnostics",
  isPlanMode: false,
  autoPlanEnabled: false,
  currentUserMessage: "",
  uploadedFileTypes: [],
};

function toOpenAITools(toolFunctions: readonly ToolFunction[]): OpenAITool[] {
  return toolFunctions
    .filter((t) => t.type === "function" && typeof t.name === "string")
    .map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
}

/**
 * Build a one-block markdown summary of the tool catalog for `/skills`.
 * Shows counts by load policy and the largest tools by estimated tokens.
 */
export function formatToolCatalogBreakdown(
  toolFunctions: readonly ToolFunction[],
  options?: { readonly largestCount?: number }
): string {
  let catalog;
  try {
    catalog = new ToolCatalogService().buildFromOpenAITools({
      tools: toOpenAITools(toolFunctions),
      context: DIAGNOSTICS_CONTEXT,
    });
  } catch (err) {
    return `Tool catalog breakdown unavailable: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
  const metrics = buildMetrics(catalog, {
    discoveredCount: 0,
    exposedTools: [],
  });
  const largestCount = options?.largestCount ?? 5;
  const lines: string[] = [
    `Tool catalog: ${metrics.totalCount} total — ${metrics.alwaysCount} always-loaded, ${metrics.deferredCount} deferred, ${metrics.contextualCount} contextual (estimated ~${metrics.estimatedTotalTokens} tokens if all sent).`,
  ];
  if (metrics.deferredCount > 0) {
    lines.push(
      "Deferred tools are hidden from the prompt and discoverable via `tool_catalog_search` when `AI_TOOL_SEARCH` is auto/on."
    );
  }
  const largest = metrics.largestTools.slice(0, largestCount);
  if (largest.length > 0) {
    lines.push("Largest tools:");
    for (const t of largest) {
      lines.push(`- \`${t.name}\` [${t.source}] ~${t.estimatedTokens} tokens`);
    }
  }
  return lines.join("\n");
}
