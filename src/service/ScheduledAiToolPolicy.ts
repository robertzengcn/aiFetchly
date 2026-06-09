import type { SkillDefinition, SkillPermissionCategory } from "@/entityTypes/skillTypes";
import type {
  SchedulableAiToolSummary,
  ScheduledToolDecision,
  AiMessageTaskToolPolicy,
} from "@/entityTypes/aiMessageTaskTypes";

/**
 * Tool categories that are always blocked for unattended scheduled AI tasks in v1.
 */
const BLOCKED_CATEGORIES: ReadonlySet<SkillPermissionCategory> = new Set([
  "shell",
]);

/**
 * Describes a built-in skill for the AI message task catalog UI.
 */
export function describeBuiltInToolForSchedule(
  skill: SkillDefinition
): SchedulableAiToolSummary {
  const category = skill.permissionCategory;

  // Shell is always blocked in v1
  if (category === "shell") {
    return {
      name: skill.name,
      description: skill.description,
      permissionCategory: category,
      source: "built-in",
      requiresConfirmation: skill.requiresConfirmation,
      schedulable: false,
      autoApproveAllowed: false,
      blockedReason: "Shell execution is blocked for unattended scheduled AI tasks in v1.",
      riskLevel: "blocked",
    };
  }

  // Filesystem write/edit is blocked in v1
  if (category === "filesystem" && skill.requiresConfirmation) {
    return {
      name: skill.name,
      description: skill.description,
      permissionCategory: category,
      source: "built-in",
      requiresConfirmation: skill.requiresConfirmation,
      schedulable: false,
      autoApproveAllowed: false,
      blockedReason: "Filesystem write/edit tools are blocked for unattended scheduled AI tasks in v1.",
      riskLevel: "blocked",
    };
  }

  // Pure tools are always schedulable
  if (category === "pure") {
    return {
      name: skill.name,
      description: skill.description,
      permissionCategory: category,
      source: "built-in",
      requiresConfirmation: false,
      schedulable: true,
      autoApproveAllowed: true,
      riskLevel: "low",
    };
  }

  // Network tools require explicit allowlisting
  if (category === "network") {
    return {
      name: skill.name,
      description: skill.description,
      permissionCategory: category,
      source: "built-in",
      requiresConfirmation: skill.requiresConfirmation,
      schedulable: true,
      autoApproveAllowed: true,
      riskLevel: skill.requiresConfirmation ? "medium" : "low",
    };
  }

  // Automation tools require explicit allowlisting
  if (category === "automation") {
    return {
      name: skill.name,
      description: skill.description,
      permissionCategory: category,
      source: "built-in",
      requiresConfirmation: skill.requiresConfirmation,
      schedulable: true,
      autoApproveAllowed: true,
      riskLevel: "medium",
    };
  }

  // Filesystem read-only (requiresConfirmation=false) can be schedulable
  if (category === "filesystem") {
    return {
      name: skill.name,
      description: skill.description,
      permissionCategory: category,
      source: "built-in",
      requiresConfirmation: false,
      schedulable: true,
      autoApproveAllowed: true,
      riskLevel: "low",
    };
  }

  // Default: not schedulable
  return {
    name: skill.name,
    description: skill.description,
    permissionCategory: category,
    source: "built-in",
    requiresConfirmation: skill.requiresConfirmation,
    schedulable: false,
    autoApproveAllowed: false,
    blockedReason: "This tool category is not supported for scheduled AI tasks in v1.",
    riskLevel: "blocked",
  };
}

/**
 * Runtime decision: can a requested tool call proceed in scheduled mode?
 */
export function canAutoApproveScheduledTool(params: {
  readonly skill: SkillDefinition;
  readonly taskPolicy: AiMessageTaskToolPolicy;
  readonly toolName: string;
}): ScheduledToolDecision {
  const { skill, taskPolicy, toolName } = params;

  // Shell is always blocked
  if (BLOCKED_CATEGORIES.has(skill.permissionCategory)) {
    return {
      allowed: false,
      reason: `Tool "${toolName}" has permission category "${skill.permissionCategory}" which is blocked for scheduled tasks.`,
      riskLevel: "blocked",
    };
  }

  // Filesystem write/edit blocked
  if (
    skill.permissionCategory === "filesystem" &&
    skill.requiresConfirmation
  ) {
    return {
      allowed: false,
      reason: `Tool "${toolName}" is a filesystem write/edit tool blocked for scheduled tasks in v1.`,
      riskLevel: "blocked",
    };
  }

  // Auto-approve must be enabled
  if (!taskPolicy.autoApproveTools) {
    return {
      allowed: false,
      reason: "Auto-approve is not enabled for this AI message task.",
      riskLevel: "high",
    };
  }

  // Pure tools always allowed
  if (skill.permissionCategory === "pure") {
    return { allowed: true, riskLevel: "low" };
  }

  // Non-pure tools must be in the allowlist
  if (!taskPolicy.allowedTools.includes(toolName)) {
    return {
      allowed: false,
      reason: `Tool "${toolName}" is not in the task's allowed tools list.`,
      riskLevel: "high",
    };
  }

  // Tool is allowlisted — check risk level
  const summary = describeBuiltInToolForSchedule(skill);
  return {
    allowed: summary.schedulable,
    reason: summary.blockedReason,
    riskLevel: summary.riskLevel,
  };
}
