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
  { pattern: /send_?email/i, reason: "Sending email is blocked for v1 agents." },
  {
    pattern: /post_?social|send_?social|send_?message/i,
    reason: "Social posting is blocked for v1 agents.",
  },
  {
    pattern: /write_?file|edit_?file|delete_?file|fs_?write/i,
    reason: "File mutation tools are blocked for v1 agents.",
  },
];

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

    if (!input.definition.allowedTools.includes(toolName)) {
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
   * minus globally-blocked patterns and explicit blockedTools.
   */
  filterExposedToolNames(input: FilterExposedInput): string[] {
    const blocked = new Set(input.blockedTools ?? []);
    const allowed = new Set(input.allowedTools);
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
