/**
 * ToolPromptBudgetService — estimates tool-definition token cost and decides
 * whether the deferred catalog should be active for a turn (FR-8).
 *
 * Mode resolution:
 *   off  -> standard (current behavior)
 *   on   -> deferred (always filter)
 *   auto -> deferred only when the estimated deferred payload exceeds a % of
 *           the active model context window (default 10%)
 *
 * Pure and side-effect free apart from reading config defaults.
 */

import type { OpenAITool } from "@/api/aiChatApi";
import {
  TOOL_CATALOG_DEFAULTS,
  type ToolCatalogMode,
} from "@/config/toolCatalogConfig";
import type { ToolCatalogModeDecision } from "@/entityTypes/toolCatalogTypes";

/** Estimate the token cost of a single tool definition (~4 chars/token). */
export function estimateToolTokens(tool: OpenAITool): number {
  let len = 0;
  try {
    len = JSON.stringify(tool).length;
  } catch {
    len = 0;
  }
  return Math.max(1, Math.ceil(len / TOOL_CATALOG_DEFAULTS.charsPerToken));
}

/** Sum the estimated token cost of a list of tools. */
export function estimateToolsTokens(tools: readonly OpenAITool[]): number {
  return tools.reduce((sum, t) => sum + estimateToolTokens(t), 0);
}

export interface ResolveModeInput {
  readonly configuredMode: ToolCatalogMode;
  readonly deferredEstimatedTokens: number;
  readonly contextWindowTokens?: number;
  readonly thresholdPercent?: number;
}

export class ToolPromptBudgetService {
  resolveMode(input: ResolveModeInput): ToolCatalogModeDecision {
    const { configuredMode, deferredEstimatedTokens } = input;

    if (configuredMode === "off") {
      return {
        mode: "standard",
        configuredMode,
        reason: "tool search disabled (AI_TOOL_SEARCH=off)",
        estimatedDeferredTokens: deferredEstimatedTokens,
      };
    }

    if (configuredMode === "on") {
      return {
        mode: "deferred",
        configuredMode,
        reason: "tool search forced on (AI_TOOL_SEARCH=on)",
        estimatedDeferredTokens: deferredEstimatedTokens,
      };
    }

    // auto
    const pct =
      input.thresholdPercent ?? TOOL_CATALOG_DEFAULTS.autoThresholdPercent;
    const contextWindow =
      input.contextWindowTokens ?? TOOL_CATALOG_DEFAULTS.fallbackContextWindowTokens;
    const thresholdTokens = Math.floor((contextWindow * pct) / 100);

    const deferred = deferredEstimatedTokens >= thresholdTokens;
    return {
      mode: deferred ? "deferred" : "standard",
      configuredMode,
      reason: deferred
        ? `deferred tool estimate (${deferredEstimatedTokens} tokens) >= ${pct}% context threshold (${thresholdTokens} tokens)`
        : `deferred tool estimate (${deferredEstimatedTokens} tokens) below ${pct}% context threshold (${thresholdTokens} tokens)`,
      thresholdTokens,
      estimatedDeferredTokens: deferredEstimatedTokens,
      contextWindowTokens: contextWindow,
    };
  }
}
