import type { SkillDefinition } from "@/entityTypes/skillTypes";
import type {
  SchedulableAiToolSummary,
  ScheduledToolDecision,
  AiMessageTaskToolPolicy,
} from "@/entityTypes/aiMessageTaskTypes";

/**
 * Security policy for tools exposed to unattended (scheduled-loop) AI turns.
 *
 * Unattended execution cannot show an interactive permission prompt, so the
 * allowlist must be conservative and FAIL CLOSED. A tool is schedulable only
 * when it appears in {@link SCHEDULED_LOOP_READ_ONLY_TOOLS} or
 * {@link SCHEDULED_LOOP_AUTOMATION_TOOLS} AND is not in the permanent deny set.
 *
 * Two tiers of schedulable tools exist:
 *  - **Read-only** (pure): auto-approved when `autoApproveTools` is on; no
 *    per-tool allowlist entry required.
 *  - **Automation**: schedulable but requires explicit per-tool allowlisting
 *    because they perform network checks or other side effects.
 *
 * Source: PRD §FR-16, technical-design §15 (safety boundaries).
 */

/**
 * Tools that may NEVER run unattended, regardless of category or allowlist.
 * `run_subagent` is denied because it can indirectly invoke many other tools;
 * the rest mutate local/mailbox state or send external side effects.
 */
export const SCHEDULED_LOOP_ALWAYS_BLOCKED_TOOLS: ReadonlySet<string> = new Set([
  "run_subagent",
  "shell_execute",
  "file_write",
  "file_edit",
  "send_email_reply",
  "start_email_send_task",
  "create_email_reply_draft",
  "mark_email_processed",
  // Inbox tools that look like reads but mutate mailbox/local state:
  "fetch_unread_emails", // stores messages locally
  "get_email_message", // marks the message read
]);

/**
 * Curated allowlist of genuinely read-only built-in tools safe for unattended
 * execution. Each entry was reviewed to confirm it performs no local write,
 * no mailbox state change, and no external side effect. Add entries here ONLY
 * after that review — never infer "read-only" from category or name.
 */
export const SCHEDULED_LOOP_READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  // Email inbox/service configuration (read-only listings)
  "list_email_inboxes",
  "list_email_services",
  "get_email_service_config",
  "list_email_templates",
  "list_email_filters",
  "list_email_search_tasks",
  "get_email_search_task_emails",
  // Schedule inspection (read-only)
  "list_schedules",
  "get_schedule_details",
  "list_schedule_executions",
  // General read-only
  "open_app_page",
  "knowledge_library_search",
  "file_read",
  "glob_files",
  "grep_files",
  // Proxy management (read-only listing — no side effects, no password reveal)
  "proxy_list",
]);

/**
 * Automation tools that are schedulable in unattended mode but require explicit
 * allowlisting because they perform network checks or other side effects. These
 * are NOT auto-approved by the read-only allowlist alone — the task's
 * `allowedTools` must explicitly include them.
 */
export const SCHEDULED_LOOP_AUTOMATION_TOOLS: ReadonlySet<string> = new Set([
  "proxy_check",
]);

/** Maximum number of tools a single scheduled loop may approve. */
export const SCHEDULED_LOOP_MAX_ALLOWED_TOOLS = 50;

/** True when a built-in tool is on the curated read-only allowlist. */
export function isScheduledReadOnlyTool(toolName: string): boolean {
  return (
    SCHEDULED_LOOP_READ_ONLY_TOOLS.has(toolName) &&
    !SCHEDULED_LOOP_ALWAYS_BLOCKED_TOOLS.has(toolName)
  );
}

/** True when a built-in tool is an automation tool that requires allowlisting. */
export function isScheduledAutomationTool(toolName: string): boolean {
  return (
    SCHEDULED_LOOP_AUTOMATION_TOOLS.has(toolName) &&
    !SCHEDULED_LOOP_ALWAYS_BLOCKED_TOOLS.has(toolName)
  );
}

/** True when a built-in tool is schedulable (read-only OR automation). */
export function isSchedulableBuiltInTool(toolName: string): boolean {
  return (
    (isScheduledReadOnlyTool(toolName) ||
      isScheduledAutomationTool(toolName)) &&
    !SCHEDULED_LOOP_ALWAYS_BLOCKED_TOOLS.has(toolName)
  );
}

/** Validation result for a requested allowed-tools list at creation time. */
export interface ScheduledLoopToolValidation {
  readonly valid: boolean;
  readonly invalidTools: readonly string[];
}

/**
 * Validate a requested allowed-tools list for a scheduled loop BEFORE any
 * persistence. Every requested tool must be a schedulable built-in (read-only
 * or automation). Unknown or denied tools make the whole request invalid —
 * they are never silently dropped, so the user is forced to approve explicitly.
 */
export function validateScheduledLoopAllowedTools(
  toolNames: readonly string[]
): ScheduledLoopToolValidation {
  const invalid = toolNames.filter((name) => !isSchedulableBuiltInTool(name));
  return { valid: invalid.length === 0, invalidTools: invalid };
}

/**
 * Describes a built-in skill for the AI message task catalog UI. Curated
 * read-only and automation tools are marked `schedulable`; everything else is
 * blocked with a concrete reason.
 */
export function describeBuiltInToolForSchedule(
  skill: SkillDefinition
): SchedulableAiToolSummary {
  const blocked = SCHEDULED_LOOP_ALWAYS_BLOCKED_TOOLS.has(skill.name);
  const readOnly = isScheduledReadOnlyTool(skill.name);
  const automation = isScheduledAutomationTool(skill.name);

  if (blocked) {
    return {
      name: skill.name,
      description: skill.description,
      permissionCategory: skill.permissionCategory,
      source: "built-in",
      requiresConfirmation: skill.requiresConfirmation,
      schedulable: false,
      autoApproveAllowed: false,
      blockedReason:
        "This tool is permanently blocked for unattended scheduled tasks because it can mutate state or send external messages.",
      riskLevel: "blocked",
    };
  }

  if (readOnly) {
    return {
      name: skill.name,
      description: skill.description,
      permissionCategory: skill.permissionCategory,
      source: "built-in",
      requiresConfirmation: false,
      schedulable: true,
      autoApproveAllowed: true,
      riskLevel: "low",
    };
  }

  if (automation) {
    return {
      name: skill.name,
      description: skill.description,
      permissionCategory: skill.permissionCategory,
      source: "built-in",
      requiresConfirmation: skill.requiresConfirmation,
      schedulable: true,
      autoApproveAllowed: true,
      riskLevel: "medium",
    };
  }

  return {
    name: skill.name,
    description: skill.description,
    permissionCategory: skill.permissionCategory,
    source: "built-in",
    requiresConfirmation: skill.requiresConfirmation,
    schedulable: false,
    autoApproveAllowed: false,
    blockedReason:
      "Only explicitly reviewed read-only or automation tools may run unattended in scheduled loops.",
    riskLevel: "blocked",
  };
}

/**
 * Runtime decision: can a requested tool call proceed in scheduled mode?
 * Defense-in-depth — the catalog filter should already hide disallowed tools,
 * but this backstop blocks any model-hallucinated tool call and returns a
 * structured reason the model can read.
 *
 * Read-only tools are auto-approved when `autoApproveTools` is on (no per-tool
 * allowlist entry needed). Automation tools require both `autoApproveTools` AND
 * explicit inclusion in the task's `allowedTools` list.
 */
export function canAutoApproveScheduledTool(params: {
  readonly skill: SkillDefinition;
  readonly taskPolicy: AiMessageTaskToolPolicy;
  readonly toolName: string;
}): ScheduledToolDecision {
  const { skill, taskPolicy, toolName } = params;

  if (SCHEDULED_LOOP_ALWAYS_BLOCKED_TOOLS.has(toolName)) {
    return {
      allowed: false,
      reason: `Tool "${toolName}" is permanently blocked for unattended scheduled tasks.`,
      riskLevel: "blocked",
    };
  }

  if (skill.source !== "built-in") {
    return {
      allowed: false,
      reason: `Tool "${toolName}" is not a built-in tool and cannot run unattended.`,
      riskLevel: "blocked",
    };
  }

  if (!taskPolicy.autoApproveTools) {
    return {
      allowed: false,
      reason:
        "Auto-approve is not enabled for this AI message task. Approve read-only tools when creating the loop.",
      riskLevel: "high",
    };
  }

  // Read-only tools: auto-approved without per-tool allowlisting.
  if (isScheduledReadOnlyTool(toolName)) {
    return { allowed: true, riskLevel: "low" };
  }

  // Automation tools: require explicit per-tool allowlisting.
  if (isScheduledAutomationTool(toolName)) {
    if (!taskPolicy.allowedTools.includes(toolName)) {
      return {
        allowed: false,
        reason: `Tool "${toolName}" is an automation tool and must be explicitly added to the task's allowed tools list.`,
        riskLevel: "high",
      };
    }
    return { allowed: true, riskLevel: "low" };
  }

  return {
    allowed: false,
    reason: `Tool "${toolName}" is not an approved tool for unattended scheduled execution.`,
    riskLevel: "high",
  };
}