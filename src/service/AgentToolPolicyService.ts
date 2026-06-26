// src/service/AgentToolPolicyService.ts
import type {
  AgentDefinitionView,
  AgentExecutionMode,
  ToolPolicyDecision,
} from "@/entityTypes/agentTypes";

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
 * Rationale: the async-tool polling architecture requires the inner agent
 * to be able to poll/cancel any job it spawns. If a tool routes to "async"
 * (run_subagent, extract_contact_info with 8+ URLs, etc.), the agent
 * receives a { async: true, job_id } envelope and must call
 * check_tool_job_status to observe progress and cancel_tool_job to give up.
 * Declaring these per-agent was fragile — an omission was silent and the
 * inner agent stalled. Listing them here makes the contract structural:
 * any present or future agent with any tool access can poll its own jobs.
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

    for (const rule of V1_BLOCKED_PATTERNS) {
      if (rule.pattern.test(toolName)) {
        return {
          allowed: false,
          reason: `${rule.reason} (tool: ${toolName})`,
          blockedEventType: "agent_blocked_tool",
        };
      }
    }

    if (input.blockedTools?.includes(toolName)) {
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
    const allowed = new Set<string>([
      ...input.allowedTools,
      ...MANDATORY_INFRASTRUCTURE_TOOLS,
    ]);
    const out: string[] = [];
    for (const name of input.availableToolNames) {
      if (!allowed.has(name)) continue;
      if (blocked.has(name)) continue;
      if (V1_BLOCKED_PATTERNS.some((r) => r.pattern.test(name))) continue;
      out.push(name);
    }
    return out.sort();
  }
}
