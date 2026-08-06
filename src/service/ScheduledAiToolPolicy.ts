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
 * allowlist must FAIL CLOSED. A tool is schedulable only when it appears in one
 * of the three tiers below AND is not in the permanent deny set.
 *
 * Three tiers of schedulable tools:
 *  - **Read-only**: AUTO-APPROVE whenever `autoApproveTools` is on. No per-tool
 *    selection — the model may call any of them. The user accepted that
 *    read-only file tools can read secrets if the model is steered by injected
 *    content, in exchange for zero-friction approvals.
 *  - **High-impact** (file write/edit, email send/draft): approvable, but
 *    require explicit per-tool selection at loop creation (gated by a typed
 *    confirmation in the approval dialog). At runtime they need
 *    `autoApproveTools` AND membership in the task's `allowedTools`.
 *  - **Automation**: same runtime gating as high-impact; tier exists for risk
 *    labeling (network checks / side effects).
 *
 * Source: PRD §FR-16, technical-design §15 (safety boundaries).
 */

/**
 * Tools that may NEVER run unattended, regardless of category or allowlist.
 * `run_subagent` is denied because it can indirectly invoke many other tools;
 * `shell_execute` runs arbitrary commands; `mark_email_processed` mutates
 * reply-state without a human in the loop. These stay blocked even if a user
 * requests them — they are not approvable.
 *
 * Inbox sync/read tools (`fetch_unread_emails`, `get_email_message`) are
 * intentionally schedulable (automation / high-impact) so loops can check
 * mailboxes; they require explicit approval at loop creation.
 */
export const SCHEDULED_LOOP_ALWAYS_BLOCKED_TOOLS: ReadonlySet<string> = new Set(
  ["run_subagent", "shell_execute", "mark_email_processed"]
);

/**
 * Curated allowlist of genuinely read-only built-in tools. These AUTO-APPROVE
 * whenever `autoApproveTools` is on — the model may call any of them with no
 * per-tool selection. The user explicitly accepted that read-only file tools
 * (file_read/glob_files/grep_files) can read secrets if the model is steered
 * by injected content, in exchange for not having to approve each one.
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
 * High-impact tools (file write/edit, email send/draft, message body access)
 * that ARE approvable for unattended execution but require EXPLICIT per-tool
 * selection at loop creation — gated behind a typed confirmation in the
 * approval dialog because prompt injection in scraped/emailed content can
 * drive them to overwrite files, send email, or expose message bodies while
 * the user is away.
 */
export const SCHEDULED_LOOP_HIGH_IMPACT_TOOLS: ReadonlySet<string> = new Set([
  "file_write",
  "file_edit",
  "send_email_reply",
  "start_email_send_task",
  "create_email_reply_draft",
  "get_email_message",
]);

/**
 * Automation tools that are schedulable in unattended mode but require explicit
 * allowlisting because they perform network checks, inbound sync, or other
 * side effects.
 */
export const SCHEDULED_LOOP_AUTOMATION_TOOLS: ReadonlySet<string> = new Set([
  "proxy_check",
  "fetch_unread_emails",
]);

/**
 * Natural-language inbox-check intent used to pre-enable tools for scheduled
 * loops that ask to check email / inbox / mailbox.
 */
export const SCHEDULED_LOOP_EMAIL_INBOX_INTENT_RE =
  /\b(inbox|inboxes|mailbox|mailboxes|emaibox)\b|\b(unread|new|received|inbound)\s+emails?\b|\bcheck(?:ing)?\b[^.]{0,60}?\b(emails?|mails?|inbox|mailbox|emaibox)\b|\b(emails?|mails?)\b[^.]{0,60}?\b(inbox|mailbox|emaibox|unread)\b/i;

/** True when a scheduled-loop prompt is asking to check inbound email. */
export function hasScheduledLoopEmailInboxIntent(prompt: string): boolean {
  return SCHEDULED_LOOP_EMAIL_INBOX_INTENT_RE.test(prompt);
}

/**
 * Automation tools to pre-select when creating a loop whose prompt matches
 * inbox-check intent. Callers still require the user to enable unattended tools.
 */
export function suggestScheduledLoopAutomationTools(
  prompt: string
): readonly string[] {
  if (!hasScheduledLoopEmailInboxIntent(prompt)) return [];
  return ["fetch_unread_emails"];
}

/** Maximum number of tools a single scheduled loop may approve. */
export const SCHEDULED_LOOP_MAX_ALLOWED_TOOLS = 50;

/** True when a built-in tool is on the curated read-only allowlist. */
export function isScheduledReadOnlyTool(toolName: string): boolean {
  return (
    SCHEDULED_LOOP_READ_ONLY_TOOLS.has(toolName) &&
    !SCHEDULED_LOOP_ALWAYS_BLOCKED_TOOLS.has(toolName)
  );
}

/** True when a built-in tool is a high-impact tool that requires explicit approval. */
export function isHighImpactSchedulableTool(toolName: string): boolean {
  return (
    SCHEDULED_LOOP_HIGH_IMPACT_TOOLS.has(toolName) &&
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

/** True when a built-in tool is schedulable (read-only, high-impact, or automation). */
export function isSchedulableBuiltInTool(toolName: string): boolean {
  return (
    (isScheduledReadOnlyTool(toolName) ||
      isHighImpactSchedulableTool(toolName) ||
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
 * read-only, high-impact, and automation tools are marked `schedulable`;
 * everything else is blocked with a concrete reason.
 */
export function describeBuiltInToolForSchedule(
  skill: SkillDefinition
): SchedulableAiToolSummary {
  const blocked = SCHEDULED_LOOP_ALWAYS_BLOCKED_TOOLS.has(skill.name);
  const readOnly = isScheduledReadOnlyTool(skill.name);
  const highImpact = isHighImpactSchedulableTool(skill.name);
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
        "This tool is permanently blocked for unattended scheduled tasks.",
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

  if (highImpact) {
    return {
      name: skill.name,
      description: skill.description,
      permissionCategory: skill.permissionCategory,
      source: "built-in",
      requiresConfirmation: skill.requiresConfirmation,
      schedulable: true,
      autoApproveAllowed: true,
      riskLevel: "high",
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
      "Only explicitly reviewed read-only, high-impact, or automation tools may run unattended in scheduled loops.",
    riskLevel: "blocked",
  };
}

/**
 * Runtime decision: can a requested tool call proceed in scheduled mode?
 * Defense-in-depth — the catalog filter should already hide disallowed tools,
 * but this backstop blocks any model-hallucinated tool call and returns a
 * structured reason the model can read.
 *
 *  - Read-only tools AUTO-APPROVE when `autoApproveTools` is on (no per-tool
 *    selection). The catalog advertises every read-only tool — by design.
 *  - High-impact and automation tools additionally require explicit inclusion
 *    in the task's `allowedTools` (the user's per-tool selection at creation).
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

  // Read-only tools AUTO-APPROVE whenever autoApproveTools is on — no per-tool
  // selection. The catalog intentionally advertises every read-only tool.
  if (isScheduledReadOnlyTool(toolName)) {
    return { allowed: true, riskLevel: "low" };
  }

  // High-impact and automation tools require explicit per-tool selection.
  const requiresExplicitAllowlist =
    isHighImpactSchedulableTool(toolName) ||
    isScheduledAutomationTool(toolName);
  if (requiresExplicitAllowlist) {
    if (!taskPolicy.allowedTools.includes(toolName)) {
      const tier = isHighImpactSchedulableTool(toolName)
        ? "high-impact"
        : "automation";
      return {
        allowed: false,
        reason: `Tool "${toolName}" is a ${tier} tool and must be explicitly added to the task's allowed tools list.`,
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
