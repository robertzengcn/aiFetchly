import { SkillRegistry } from "@/config/skillsRegistry";
import { SkillPermissionService } from "@/service/SkillPermissionService";
import type { ChatToolApprovalMode } from "@/entityTypes/aiChatV2Types";
import type { SkillPermissionCategory } from "@/entityTypes/skillTypes";

export interface ChatToolApprovalPolicyInput {
  readonly conversationId: string;
  readonly mode: ChatToolApprovalMode;
  readonly toolName: string;
  readonly permissionCategory?: SkillPermissionCategory;
  readonly isDependencyInstall: boolean;
}

export interface ChatToolApprovalPolicyDecision {
  readonly autoApprove: boolean;
  readonly reason: string;
}

/**
 * Evaluates whether a tool call should be auto-approved based on the
 * conversation's selected approval mode.
 *
 * Decision rules (PRD §4.2, §7.5, §7.6):
 *
 *   Mode              | Shell    | Non-shell | Dependency
 *   ------------------|----------|-----------|-----------
 *   ask_for_approval  | prompt   | prompt    | prompt
 *   approve_for_me    | prompt   | auto      | prompt
 *   full_access       | auto*    | auto      | prompt
 *
 *   * full_access shell: still subject to denylist, rate-limit, audit,
 *     workspace guard, plan gate. Only the permission-prompt UI is skipped.
 *
 * All modes respect:
 *   - Explicit user denial via SkillPermissionService (never auto-approve
 *     a tool the user explicitly denied)
 *   - Unknown tools (never auto-approve)
 *   - Dependency install prompts (user must click explicitly)
 */
export function evaluateToolApproval(
  input: ChatToolApprovalPolicyInput
): ChatToolApprovalPolicyDecision {
  // Dependency installs are NEVER auto-approved (PRD §7.6)
  if (input.isDependencyInstall) {
    return {
      autoApprove: false,
      reason: "Dependency install requires explicit approval",
    };
  }

  // ask_for_approval: never auto-approve (PRD §4.1)
  if (input.mode === "ask_for_approval") {
    return {
      autoApprove: false,
      reason: "Mode is ask_for_approval",
    };
  }

  // Check explicit denial from SkillPermissionService
  const permStatus = SkillPermissionService.getPermissionStatus(input.toolName);
  if (permStatus === "denied") {
    return {
      autoApprove: false,
      reason: "Tool was explicitly denied by the user",
    };
  }

  // Unknown tools never auto-approve
  if (!SkillRegistry.isRegistered(input.toolName)) {
    return {
      autoApprove: false,
      reason: "Unknown tool cannot be auto-approved",
    };
  }

  // Resolve the permission category
  const category: SkillPermissionCategory | undefined =
    input.permissionCategory ?? resolvePermissionCategory(input.toolName);

  if (!category) {
    return {
      autoApprove: false,
      reason: "Could not resolve permission category",
    };
  }

  // approve_for_me: auto-approve non-shell (PRD §4.1)
  if (input.mode === "approve_for_me") {
    if (category === "shell") {
      return {
        autoApprove: false,
        reason: "Shell tools require approval in approve_for_me mode",
      };
    }
    return {
      autoApprove: true,
      reason: `Auto-approved by chat mode (${input.mode})`,
    };
  }

  // full_access: auto-approve all registered tools (PRD §4.1)
  // Shell still goes through denylist, rate-limit, audit, workspace guard.
  // Only the permission prompt is skipped.
  return {
    autoApprove: true,
    reason: `Auto-approved by chat mode (${input.mode})`,
  };
}

function resolvePermissionCategory(
  toolName: string
): SkillPermissionCategory | undefined {
  // Check SkillRegistry first
  const skill = SkillRegistry.getSkill(toolName);
  if (skill?.permissionCategory) {
    return skill.permissionCategory;
  }
  // Fallback: pure (safe default for MCP-prefixed tools)
  if (toolName.startsWith("mcp_")) {
    return "network";
  }
  return undefined;
}
