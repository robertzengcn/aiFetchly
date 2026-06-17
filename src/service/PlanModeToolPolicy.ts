import type { AIChatPlanStateView } from "@/entityTypes/aiChatPlanTypes";
import type { SkillPermissionCategory } from "@/entityTypes/skillTypes";

export interface PlanModeToolPolicyContext {
  conversationId: string;
  planState?: AIChatPlanStateView | null;
}

export type PlanModeToolCategory =
  | "plan_tool"
  | "pure"
  | "read_only_allowed"
  | "blocked_until_approval";

export interface ToolPolicyDecision {
  allowed: boolean;
  reason?: string;
  category?: PlanModeToolCategory;
}

export const PLAN_TOOL_NAMES = new Set([
  "AskUserQuestion",
  "SubmitPlanForApproval",
]);

/** Named allowlist of read-only tools safe to call during planning. */
const PLAN_MODE_PRE_APPROVAL_ALLOWLIST = new Set<string>([
  "list_available_skills",
  "knowledge_base_search",
]);

const BLOCKED_PRE_APPROVAL_CATEGORIES = new Set<SkillPermissionCategory>([
  "network",
  "automation",
  "filesystem",
  "shell",
]);

export function isPlanToolName(name: string): boolean {
  return PLAN_TOOL_NAMES.has(name);
}

export function checkPlanModeToolPolicy(input: {
  toolName: string;
  skillPermissionCategory?: SkillPermissionCategory;
  context: PlanModeToolPolicyContext;
}): ToolPolicyDecision {
  const { toolName, skillPermissionCategory, context } = input;

  // Plan tools are always allowed in plan mode.
  if (PLAN_TOOL_NAMES.has(toolName)) {
    return { allowed: true, category: "plan_tool" };
  }

  const approved = context.planState?.status === "approved";

  // After approval, plan mode no longer blocks.
  if (approved) {
    return { allowed: true, category: "pure" };
  }

  // Explicit named read-only allowlist.
  if (PLAN_MODE_PRE_APPROVAL_ALLOWLIST.has(toolName)) {
    return { allowed: true, category: "read_only_allowed" };
  }

  // Pure-category tools (no side effects) are allowed before approval.
  if (skillPermissionCategory === "pure") {
    return { allowed: true, category: "pure" };
  }

  // Block dangerous categories before approval.
  if (
    skillPermissionCategory &&
    BLOCKED_PRE_APPROVAL_CATEGORIES.has(skillPermissionCategory)
  ) {
    return {
      allowed: false,
      category: "blocked_until_approval",
      reason: `Tool "${toolName}" (${skillPermissionCategory}) requires plan approval before execution.`,
    };
  }

  // Unknown tools default to blocked before approval.
  return {
    allowed: false,
    category: "blocked_until_approval",
    reason: `Tool "${toolName}" is not allowlisted for Plan Mode. Approve the plan first.`,
  };
}
