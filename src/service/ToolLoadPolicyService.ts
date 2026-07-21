/**
 * ToolLoadPolicyService — classifies each catalog entry as `always`,
 * `deferred`, or `contextual` using deterministic rules (FR-2, design §10).
 *
 * Policy is derived purely from tool name, detected source, and the runtime
 * context. It NEVER inspects tool arguments (arguments do not exist before
 * tool selection).
 *
 *   always      -> full schema sent every round
 *   deferred    -> discoverable via tool_catalog_search; schema hidden until
 *                  discovered
 *   contextual  -> exposed when forced by mode/context (plan mode, user mention)
 */

import type { OpenAITool } from "@/api/aiChatApi";
import { TOOL_CATALOG_SEARCH_TOOL_NAME } from "@/config/toolCatalogConfig";
import type {
  ToolCatalogRuntimeContext,
  ToolCatalogSource,
  ToolLoadPolicy,
} from "@/entityTypes/toolCatalogTypes";
import { isPlanToolName } from "@/service/PlanModeToolPolicy";
import { isEnterPlanModeToolName } from "@/service/EnterPlanModeTool";

/**
 * Built-in tools that are broadly useful for general assistance and small
 * enough to always include in the first payload (design §10). Everything else
 * built-in is specialized (scraping/marketing/email/scheduling) and deferred.
 */
const ALWAYS_LOADED_TOOL_NAMES: ReadonlySet<string> = new Set([
  "file_read",
  "glob_files",
  "grep_files",
  "check_tool_job_status",
  "read_attachment_content",
  "knowledge_library_search",
]);

/** Source types that are always deferred by default. */
const DEFERRED_SOURCES: ReadonlySet<ToolCatalogSource> = new Set([
  "mcp",
  "plugin",
  "imported",
  "subagent",
]);

export interface ClassifyInput {
  readonly tool: OpenAITool;
  readonly source: ToolCatalogSource;
  readonly context: ToolCatalogRuntimeContext;
}

export class ToolLoadPolicyService {
  classify(input: ClassifyInput): ToolLoadPolicy {
    const name = input.tool.function.name;

    // 1. The discovery tool itself is always available when deferred mode is on.
    if (name === TOOL_CATALOG_SEARCH_TOOL_NAME) return "always";

    // 2. Plan-mode tools are mode-required.
    if (isPlanToolName(name)) {
      return input.context.isPlanMode ? "always" : "contextual";
    }
    if (isEnterPlanModeToolName(name)) return "contextual";

    // 3. Explicit always-loaded core helpers.
    if (ALWAYS_LOADED_TOOL_NAMES.has(name)) return "always";

    // 4. Explicitly blocked tools are never auto-exposed.
    if (input.context.blockedToolNames?.has(name)) return "deferred";

    // 5. Source-based deferral.
    if (DEFERRED_SOURCES.has(input.source)) return "deferred";

    // 6. Contextual promotion: user explicitly named this tool.
    if (this.isMentionedInMessage(name, input.context.currentUserMessage)) {
      return "contextual";
    }

    // 7. Built-in default: specialized tools are deferred and discoverable.
    return "deferred";
  }

  private isMentionedInMessage(name: string, message: string): boolean {
    if (!message || !name) return false;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "i");
    return re.test(message);
  }
}
