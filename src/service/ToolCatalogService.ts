/**
 * ToolCatalogService — builds a compact, indexed catalog of every enabled
 * AI-callable tool and filters the exposed set per model round (FR-1, FR-4,
 * design §11).
 *
 * The catalog is built once per turn from the full tool list. Each entry holds
 * the full OpenAITool locally; only entries that survive `filterForRound` are
 * sent to the model. Filtering operates on the loop's live tool list so that
 * mid-run additions (e.g. plan tools added by EnterPlanMode) are handled
 * correctly: tools present in the live list but absent from the catalog are
 * treated as non-deferred and always exposed.
 */

import * as crypto from "crypto";
import type { OpenAITool } from "@/api/aiChatApi";
import {
  TOOL_CATALOG_DEFAULTS,
  TOOL_CATALOG_SEARCH_TOOL_NAME,
} from "@/config/toolCatalogConfig";
import { estimateToolTokens } from "@/service/ToolPromptBudgetService";
import { ToolLoadPolicyService } from "@/service/ToolLoadPolicyService";
import {
  buildMetrics,
  type ToolCatalogMetricsInput,
} from "@/service/ToolCatalogMetricsService";
import { isPlanToolName } from "@/service/PlanModeToolPolicy";
import { isEnterPlanModeToolName } from "@/service/EnterPlanModeTool";
import type {
  ToolCatalog,
  ToolCatalogEntry,
  ToolCatalogFilterResult,
  ToolCatalogMetrics,
  ToolCatalogModeDecision,
  ToolCatalogRuntimeContext,
  ToolCatalogSource,
  ToolCatalogState,
} from "@/entityTypes/toolCatalogTypes";

/**
 * The discovery tool definition sent to the model in deferred mode. It is a
 * normal OpenAI function; the loop intercepts calls locally.
 */
export const TOOL_CATALOG_SEARCH_OPENAI_TOOL: OpenAITool = {
  type: "function",
  function: {
    name: TOOL_CATALOG_SEARCH_TOOL_NAME,
    description:
      "Search the available deferred tool catalog and select tools to load before calling them. Use this when a capability (workspace file creation/editing/deletion, shell command, local image attach/edit/analysis via attach_local_images, subagent, knowledge-library management, schedule automation, HTML artifact, email/social/proxy action, integration, MCP server, plugin tool, imported skill, scraper, marketing workflow) you need is not currently exposed.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Keyword query describing the capability, integration, source, or exact tool name.",
        },
        max_results: {
          type: "number",
          minimum: 1,
          maximum: TOOL_CATALOG_DEFAULTS.searchMaxResults,
          description: `Max matches to return (default ${TOOL_CATALOG_DEFAULTS.searchDefaultMaxResults}, max ${TOOL_CATALOG_DEFAULTS.searchMaxResults}).`,
        },
        select: {
          type: "array",
          items: { type: "string" },
          description:
            "Exact tool names to load. Use this when a deferred tool name is already known.",
        },
      },
      required: [],
    },
  },
};

/** Skill resolver injection for source detection (tests pass a fake). */
export interface ToolCatalogServiceDeps {
  readonly getSkillDefinition?: (
    name: string
  ) => { source?: string; pluginOwner?: string } | null;
}

const SOURCE_PRIORITY: Record<ToolCatalogSource, number> = {
  system: 0,
  plan: 1,
  builtin: 2,
  imported: 3,
  plugin: 4,
  subagent: 5,
  mcp: 6,
};

const LEGACY_MCP_NAME_RE = /^mcp_\d+_/;

/**
 * Extra searchable phrases for tools whose natural discovery queries diverge
 * from the tool name (e.g. models search "pillow" / "image processing" when
 * they should load attach_local_images).
 */
const TOOL_SEARCH_HINTS: ReadonlyMap<string, readonly string[]> = new Map([
  [
    "attach_local_images",
    [
      "image",
      "images",
      "photo",
      "photos",
      "background",
      "edit image",
      "image processing",
      "image edit",
      "pillow",
      "pil",
      "imagemagick",
      "white background",
    ],
  ],
  [
    "process_artifact_batch",
    [
      "batch image edit",
      "edit all images",
      "multiple images",
      "folder images",
      "white background",
      "concurrent image processing",
      "bulk artifact processing",
    ],
  ],
  [
    "export_generated_artifacts",
    [
      "save generated files",
      "copy generated image to workspace",
      "export artifact",
      "persist output",
      "workspace output",
    ],
  ],
  [
    "start_email_send_task",
    [
      "send email",
      "send emails",
      "marketing email",
      "outbound email",
      "bulk email",
      "email campaign",
      "newsletter",
      "send to customers",
      "send to contacts",
      "outreach",
    ],
  ],
  [
    "list_email_services",
    [
      "smtp",
      "email sender",
      "sending service",
      "outbound email",
      "email service",
    ],
  ],
]);

export class ToolCatalogService {
  private readonly policyService: ToolLoadPolicyService;
  private readonly getSkillDefinition?: ToolCatalogServiceDeps["getSkillDefinition"];

  constructor(deps?: ToolCatalogServiceDeps) {
    this.policyService = new ToolLoadPolicyService();
    this.getSkillDefinition = deps?.getSkillDefinition;
  }

  buildFromOpenAITools(input: {
    readonly tools: readonly OpenAITool[];
    readonly context: ToolCatalogRuntimeContext;
  }): ToolCatalog {
    const seen = new Set<string>();
    const entries: ToolCatalogEntry[] = [];

    for (const raw of input.tools) {
      const name = raw.function.name;
      if (!name || seen.has(name)) continue;
      seen.add(name);

      const source = this.detectSource(name);
      const loadPolicy = this.policyService.classify({
        tool: raw,
        source,
        context: input.context,
      });
      const description = raw.function.description ?? "";
      entries.push({
        name,
        source,
        loadPolicy,
        description,
        shortDescription: shortenDescription(description),
        searchHints: TOOL_SEARCH_HINTS.get(name) ?? [],
        estimatedTokens: estimateToolTokens(raw),
        schemaHash: hashTool(raw),
        openAITool: raw,
      });
    }

    entries.sort(bySourceThenName);
    return this.indexCatalog(entries);
  }

  filterForRound(input: {
    readonly catalog: ToolCatalog;
    readonly liveTools: readonly OpenAITool[];
    readonly state: ToolCatalogState;
    readonly modeDecision: ToolCatalogModeDecision;
    readonly forcedToolNames?: ReadonlySet<string>;
  }): ToolCatalogFilterResult {
    const { catalog, liveTools, state, modeDecision, forcedToolNames } = input;

    if (modeDecision.mode !== "deferred") {
      const exposedTools = [...liveTools];
      return {
        exposedTools,
        exposedToolNames: exposedTools.map((t) => t.function.name),
        deferredToolNames: catalog.deferred.map((e) => e.name),
        mode: "standard",
        reason: modeDecision.reason,
        metrics: buildMetrics(catalog, {
          discoveredCount: state.discoveredToolNames.size,
          exposedTools,
        }),
      };
    }

    const deferredNames = new Set(catalog.deferred.map((e) => e.name));
    const discovered = state.discoveredToolNames;
    const exposed: OpenAITool[] = [];
    const exposedNames: string[] = [];

    for (const tool of liveTools) {
      const name = tool.function.name;
      const isForced = forcedToolNames?.has(name) === true;
      const isDeferred = deferredNames.has(name);
      if (isDeferred && !discovered.has(name) && !isForced) {
        continue;
      }
      exposed.push(tool);
      exposedNames.push(name);
    }

    // Always include the discovery tool in deferred mode (it is not part of the
    // executable liveTools set — it is intercepted locally by the loop).
    if (!exposedNames.includes(TOOL_CATALOG_SEARCH_TOOL_NAME)) {
      exposed.push(TOOL_CATALOG_SEARCH_OPENAI_TOOL);
      exposedNames.push(TOOL_CATALOG_SEARCH_TOOL_NAME);
    }

    return {
      exposedTools: exposed,
      exposedToolNames: exposedNames,
      deferredToolNames: [...deferredNames].sort(),
      mode: "deferred",
      reason: modeDecision.reason,
      metrics: buildMetrics(catalog, {
        discoveredCount: discovered.size,
        exposedTools: exposed,
      }),
    };
  }

  private detectSource(name: string): ToolCatalogSource {
    if (name === TOOL_CATALOG_SEARCH_TOOL_NAME) return "system";
    if (isPlanToolName(name) || isEnterPlanModeToolName(name)) return "plan";
    if (name.startsWith("mcp__") || LEGACY_MCP_NAME_RE.test(name)) return "mcp";

    const skill = this.getSkillDefinition?.(name);
    if (skill?.pluginOwner) return "plugin";
    if (skill?.source === "built-in") return "builtin";
    if (skill?.source === "user" || skill?.source === "marketplace") {
      return "imported";
    }
    return "builtin";
  }

  private indexCatalog(entries: ToolCatalogEntry[]): ToolCatalog {
    const byName = new Map<string, ToolCatalogEntry>();
    const always: ToolCatalogEntry[] = [];
    const deferred: ToolCatalogEntry[] = [];
    const contextual: ToolCatalogEntry[] = [];
    let totalEstimatedTokens = 0;
    let deferredEstimatedTokens = 0;

    for (const e of entries) {
      byName.set(e.name, e);
      totalEstimatedTokens += e.estimatedTokens;
      if (e.loadPolicy === "always") always.push(e);
      else if (e.loadPolicy === "deferred") {
        deferred.push(e);
        deferredEstimatedTokens += e.estimatedTokens;
      } else contextual.push(e);
    }

    return {
      entries,
      byName,
      always,
      deferred,
      contextual,
      totalEstimatedTokens,
      deferredEstimatedTokens,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bySourceThenName(a: ToolCatalogEntry, b: ToolCatalogEntry): number {
  const s = SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source];
  return s !== 0 ? s : a.name.localeCompare(b.name);
}

function shortenDescription(desc: string): string {
  const max = TOOL_CATALOG_DEFAULTS.shortDescriptionChars;
  if (desc.length <= max) return desc;
  return `${desc.slice(0, max)}...`;
}

function hashTool(tool: OpenAITool): string {
  const hash = crypto.createHash("sha256");
  try {
    hash.update(JSON.stringify(tool));
  } catch {
    hash.update(tool.function.name);
  }
  return hash.digest("hex").slice(0, 16);
}

// Re-export metrics input type for callers that build metrics directly.
export type { ToolCatalogMetrics, ToolCatalogMetricsInput };
