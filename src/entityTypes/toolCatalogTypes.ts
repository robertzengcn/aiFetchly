/**
 * Type system for the deferred tool catalog (AI Tool List Management).
 *
 * See `docs/prd/ai-tool-list-management-technical-design.md` §7.
 * These types are shared across ToolCatalogService, ToolLoadPolicyService,
 * ToolCatalogSearchService, ToolPromptBudgetService, ToolCatalogMetricsService,
 * and the AIChatQueryLoop/Engine integration.
 */

import type { OpenAITool, ToolFunction } from "@/api/aiChatApi";
import type { ToolCatalogMode } from "@/config/toolCatalogConfig";

/** Where a catalog entry originates. */
export type ToolCatalogSource =
  | "builtin"
  | "mcp"
  | "plugin"
  | "imported"
  | "plan"
  | "subagent"
  | "system";

/** Whether a tool's full schema is sent every round or only after discovery. */
export type ToolLoadPolicy = "always" | "deferred" | "contextual";

/**
 * Compact, normalized description of one enabled AI-callable capability.
 * The full schema is held locally in `openAITool` and only sent to the model
 * when the entry is exposed for the round.
 */
export interface ToolCatalogEntry {
  readonly name: string;
  readonly source: ToolCatalogSource;
  readonly loadPolicy: ToolLoadPolicy;
  readonly description: string;
  readonly shortDescription: string;
  readonly category?: string;
  readonly searchHints: readonly string[];
  readonly estimatedTokens: number;
  readonly schemaHash: string;
  /** Original ToolFunction, when the entry was built from ToolFunction[]. */
  readonly toolFunction?: ToolFunction;
  /** Normalized OpenAI tool definition (always present). */
  readonly openAITool: OpenAITool;
}

/** Immutable, indexed view over every enabled tool for one turn. */
export interface ToolCatalog {
  readonly entries: readonly ToolCatalogEntry[];
  readonly byName: ReadonlyMap<string, ToolCatalogEntry>;
  readonly always: readonly ToolCatalogEntry[];
  readonly deferred: readonly ToolCatalogEntry[];
  readonly contextual: readonly ToolCatalogEntry[];
  readonly totalEstimatedTokens: number;
  readonly deferredEstimatedTokens: number;
}

/**
 * Per-turn runtime context used for source detection, load-policy
 * classification, contextual promotion, and agent-allowlist enforcement.
 */
export interface ToolCatalogRuntimeContext {
  readonly conversationId: string;
  readonly model?: string;
  readonly isPlanMode: boolean;
  readonly autoPlanEnabled: boolean;
  readonly currentUserMessage: string;
  /**
   * Recent prior user message texts (newest last or any order). Used only when
   * the current message is a short continuation ("continue", "yes", …) so
   * contextual tool promotion can inherit intent from the previous request.
   */
  readonly recentUserMessages?: readonly string[];
  readonly uploadedFileTypes: readonly string[];
  readonly routeName?: string;
  /** Agent allowlist: when set, discovery only returns these names. */
  readonly allowedToolNames?: ReadonlySet<string>;
  /** Explicitly blocked tool names (never discoverable/exposed). */
  readonly blockedToolNames?: ReadonlySet<string>;
  /**
   * Context window in tokens, when known from model metadata. Used by
   * ToolPromptBudgetService for the auto-mode threshold.
   */
  readonly contextWindowTokens?: number;
  /**
   * True when the recent conversation history contains AI-generated images.
   * Informational context flag only: the tool-load policy no longer
   * force-promotes export/attach tools on follow-up edit wording, because a
   * selected generated image arrives attached to the current user turn and is
   * edited directly (no workspace round-trip).
   */
  readonly hasRecentGeneratedImages?: boolean;
}

/**
 * Mutable, conversation-scoped discovered-tool state. Held in memory for the
 * MVP; persisted per-conversation in a later phase.
 */
export interface ToolCatalogState {
  readonly discoveredToolNames: ReadonlySet<string>;
  readonly announcedDeferredNames: ReadonlySet<string>;
}

/** Serializable snapshot of ToolCatalogState for pending-turn carry-forward. */
export interface ToolCatalogStateSnapshot {
  readonly discoveredToolNames: readonly string[];
  readonly announcedDeferredNames: readonly string[];
}

/** Persisted per-conversation catalog state view (design §7.3). */
export interface ConversationToolStateView {
  readonly conversationId: string;
  readonly discoveredToolNames: readonly string[];
  readonly announcedDeferredToolNames: readonly string[];
  readonly catalogHash?: string;
  readonly updatedAt?: string;
}

/** Decision returned by ToolPromptBudgetService. */
export interface ToolCatalogModeDecision {
  /** Effective behavior for this turn. */
  readonly mode: "standard" | "deferred";
  /** Configured feature-flag mode. */
  readonly configuredMode: ToolCatalogMode;
  /** Human-readable reason for the decision (logged). */
  readonly reason: string;
  readonly thresholdTokens?: number;
  readonly estimatedDeferredTokens: number;
  readonly contextWindowTokens?: number;
}

/** Result of filtering the catalog for one model round. */
export interface ToolCatalogFilterResult {
  readonly exposedTools: readonly OpenAITool[];
  readonly exposedToolNames: readonly string[];
  readonly deferredToolNames: readonly string[];
  readonly mode: "standard" | "deferred";
  readonly reason: string;
  readonly metrics: ToolCatalogMetrics;
}

/** Metrics snapshot for one round (FR-10, §14). */
export interface ToolCatalogMetrics {
  readonly totalCount: number;
  readonly alwaysCount: number;
  readonly deferredCount: number;
  readonly contextualCount: number;
  readonly discoveredCount: number;
  readonly exposedCount: number;
  readonly estimatedTotalTokens: number;
  readonly estimatedExposedTokens: number;
  readonly largestTools: readonly ToolCatalogLargestTool[];
}

export interface ToolCatalogLargestTool {
  readonly name: string;
  readonly source: ToolCatalogSource;
  readonly estimatedTokens: number;
}

/** Input args for the `tool_catalog_search` discovery tool. */
export interface ToolCatalogSearchArgs {
  readonly query?: string;
  readonly max_results?: number;
  readonly select?: readonly string[];
}

/** One ranked search match returned to the model. */
export interface ToolCatalogSearchMatch {
  readonly name: string;
  readonly source: ToolCatalogSource;
  readonly description: string;
  readonly category?: string;
  readonly score: number;
  readonly alreadyExposed: boolean;
}

/** Full result of a `tool_catalog_search` call (returned to the model). */
export interface ToolCatalogSearchResult {
  readonly success: boolean;
  readonly query: string;
  readonly matches: readonly ToolCatalogSearchMatch[];
  readonly selectedToolNames: readonly string[];
  readonly missingToolNames: readonly string[];
  readonly message: string;
  readonly error?: string;
}
