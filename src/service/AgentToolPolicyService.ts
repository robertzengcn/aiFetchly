// src/service/AgentToolPolicyService.ts
import type {
  AgentDefinitionView,
  AgentExecutionMode,
  AgentSource,
  ToolPolicyDecision,
} from "@/entityTypes/agentTypes";
import { getClaudeAgentToolAlias } from "@/service/pluginCompat/claudeAgentTools";

/** Globally blocked tool-name substrings for every v1 agent. */
const V1_BLOCKED_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  reason: string;
}> = [
  {
    pattern: /(^|_)(shell|exec|spawn|cmd|bash)($|_)/i,
    reason: "Shell tools are blocked for v1 agents.",
  },
  {
    pattern: /send_?email/i,
    reason: "Sending email is blocked for v1 agents.",
  },
  {
    pattern: /post_?social|send_?social|send_?message/i,
    reason: "Social posting is blocked for v1 agents.",
  },
  {
    pattern: /write_?file|edit_?file|delete_?file|fs_?write/i,
    reason: "File mutation tools are blocked for v1 agents.",
  },
];

/**
 * Mandatory infrastructure tools auto-injected into every agent's exposed
 * tool set (as long as the agent has at least one tool of its own).
 *
 * Rationale: async tool jobs may outlive a single tool round (run_subagent,
 * extract_contact_info with 8+ URLs, etc.). Managed async returns the real
 * final result to the model, but the agent may still need to observe prior
 * job state or cancel a still-running job (cancel_tool_job). Declaring
 * these per-agent was fragile — an omission was silent and the inner agent
 * stalled. Listing them here makes the contract structural: any present or
 * future agent with any tool access can inspect/cancel its own jobs.
 *
 * These tools are conversation-scoped and read-only/cleanup, so exposing
 * them broadly carries no privilege-escalation risk. They still pass
 * through the v1 denylist and explicit blockedTools filters below.
 */
const MANDATORY_INFRASTRUCTURE_TOOLS: ReadonlyArray<string> = [
  "check_tool_job_status",
  "cancel_tool_job",
];

function isMandatoryInfrastructureTool(name: string): boolean {
  return MANDATORY_INFRASTRUCTURE_TOOLS.includes(name);
}

export interface ToolPolicyCheckInput {
  definition: AgentDefinitionView;
  toolName: string;
  executionMode: AgentExecutionMode;
  allowInteractivePermissionPrompts: boolean;
  blockedTools?: string[];
}

export interface FilterExposedInput {
  allowedTools: string[];
  availableToolNames: string[];
  blockedTools?: string[];
  /** Plugin agents may use the Claude coding tools they declare. */
  source?: AgentSource;
}

export class AgentToolPolicyService {
  /**
   * Decide whether a tool call may proceed for this agent. Layers:
   *   1) global v1 denylist (shell/email/social/file-write)
   *   2) explicit workflow blockedTools override
   *   3) agent allowlist intersection
   *   4) headless-mode interactive-permission impossibility (soft pass;
   *      SkillPermissionService still gates at execution time)
   */
  checkToolCall(input: ToolPolicyCheckInput): ToolPolicyDecision {
    const { toolName } = input;

    const alias = getClaudeAgentToolAlias(toolName);
    const executeName = alias?.aifetchlyName ?? toolName;
    for (const rule of V1_BLOCKED_PATTERNS) {
      const matches =
        rule.pattern.test(toolName) || rule.pattern.test(executeName);
      if (!matches) continue;
      if (
        pluginMayUseDeclaredCodingTool(
          input.definition,
          toolName,
          executeName,
          rule.reason
        )
      ) {
        continue;
      }
      return {
        allowed: false,
        reason: `${rule.reason} (tool: ${toolName})`,
        blockedEventType: "agent_blocked_tool",
      };
    }

    if (
      input.blockedTools?.includes(toolName) ||
      input.blockedTools?.includes(executeName)
    ) {
      return {
        allowed: false,
        reason: `Tool ${toolName} is blocked by workflow constraints.`,
        blockedEventType: "agent_blocked_tool",
      };
    }

    // Allow mandatory infrastructure tools (async-polling lifecycle) even
    // when not statically declared, as long as the agent has at least one
    // tool of its own. An intentionally tool-less agent (empty allowlist)
    // does not get them auto-injected — preserves "explicit zero means zero".
    const inAllowlist = input.definition.allowedTools.includes(toolName);
    const isInfra =
      input.definition.allowedTools.length > 0 &&
      isMandatoryInfrastructureTool(toolName);
    if (!inAllowlist && !isInfra) {
      return {
        allowed: false,
        reason: `Tool ${toolName} is not allowed for ${input.definition.id}.`,
        blockedEventType: "agent_blocked_tool",
      };
    }

    if (
      !input.allowInteractivePermissionPrompts &&
      (input.executionMode === "background" ||
        input.executionMode === "scheduled")
    ) {
      // Allowlist satisfied; SkillPermissionService will block non-pure tools
      // at execution time and return a permission prompt result that the
      // runtime surfaces as a blocked tool result in headless mode.
    }

    return { allowed: true };
  }

  /**
   * Intersect the agent allowlist with the set of actually-registered tools,
   * minus globally-blocked patterns and explicit blockedTools. Mandatory
   * infrastructure tools (async-polling lifecycle) are unioned in for any
   * agent with a non-empty allowlist; see MANDATORY_INFRASTRUCTURE_TOOLS.
   */
  filterExposedToolNames(input: FilterExposedInput): string[] {
    // Tool-less agent: preserve "explicit zero means zero".
    if (input.allowedTools.length === 0) return [];

    const blocked = new Set(input.blockedTools ?? []);
    const available = new Set(input.availableToolNames);
    const declared = [
      ...input.allowedTools,
      ...MANDATORY_INFRASTRUCTURE_TOOLS,
    ];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const declaredName of declared) {
      const alias = getClaudeAgentToolAlias(declaredName);
      const modelName = alias?.claudeName ?? declaredName;
      const executeName = alias?.aifetchlyName ?? declaredName;
      if (
        blocked.has(declaredName) ||
        blocked.has(modelName) ||
        blocked.has(executeName)
      ) {
        continue;
      }
      if (!available.has(executeName)) continue;
      if (isDeniedCodingTool(modelName, executeName, input)) continue;
      if (seen.has(modelName)) continue;
      seen.add(modelName);
      out.push(modelName);
    }
    return out.sort();
  }
}

function pluginMayUseDeclaredCodingTool(
  definition: AgentDefinitionView,
  modelName: string,
  executeName: string,
  reason: string
): boolean {
  if (definition.source !== "plugin") return false;
  if (/email|social/i.test(reason)) return false;
  return (
    definition.allowedTools.includes(modelName) ||
    definition.allowedTools.includes(executeName)
  );
}

function isDeniedCodingTool(
  modelName: string,
  executeName: string,
  input: FilterExposedInput
): boolean {
  for (const candidate of [modelName, executeName]) {
    for (const rule of V1_BLOCKED_PATTERNS) {
      if (!rule.pattern.test(candidate)) continue;
      if (/email|social/i.test(rule.reason)) return true;
      if (
        input.source === "plugin" &&
        (input.allowedTools.includes(modelName) ||
          input.allowedTools.includes(executeName))
      ) {
        continue;
      }
      return true;
    }
  }
  return false;
}
