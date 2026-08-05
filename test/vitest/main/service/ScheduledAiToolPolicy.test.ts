import { describe, expect, it } from "vitest";
import {
  SCHEDULED_LOOP_ALWAYS_BLOCKED_TOOLS,
  SCHEDULED_LOOP_READ_ONLY_TOOLS,
  canAutoApproveScheduledTool,
  describeBuiltInToolForSchedule,
  isScheduledReadOnlyTool,
  validateScheduledLoopAllowedTools,
} from "@/service/ScheduledAiToolPolicy";
import type { SkillDefinition } from "@/entityTypes/skillTypes";
import type { AiMessageTaskToolPolicy } from "@/entityTypes/aiMessageTaskTypes";

/** Minimal SkillDefinition stub for policy tests. */
function skill(
  name: string,
  overrides: Partial<SkillDefinition> = {}
): SkillDefinition {
  return {
    name,
    description: `${name} description`,
    parameters: { type: "object", properties: {} },
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "automation",
    source: "built-in",
    execute: async () => ({ success: true, result: {} }),
    ...overrides,
  } as unknown as SkillDefinition;
}

const policy = (
  overrides: Partial<AiMessageTaskToolPolicy> = {}
): AiMessageTaskToolPolicy => ({
  allowedTools: ["list_email_inboxes"],
  autoApproveTools: true,
  maxToolCalls: 10,
  maxRuntimeMs: 300_000,
  maxContinueCalls: 10,
  ...overrides,
});

describe("ScheduledAiToolPolicy read-only allowlist", () => {
  it("marks curated email listing tools as read-only", () => {
    expect(isScheduledReadOnlyTool("list_email_inboxes")).toBe(true);
    expect(isScheduledReadOnlyTool("list_email_services")).toBe(true);
    expect(isScheduledReadOnlyTool("get_email_service_config")).toBe(true);
  });

  it("rejects unknown and non-curated tools", () => {
    expect(isScheduledReadOnlyTool("some_random_tool")).toBe(false);
    expect(isScheduledReadOnlyTool("")).toBe(false);
  });

  it("mutating inbox tools are never read-only even if listed", () => {
    // Sanity: the mutating tools are in the deny set, so even a hypothetical
    // duplicate entry in the read-only set could not make them schedulable.
    expect(SCHEDULED_LOOP_ALWAYS_BLOCKED_TOOLS.has("fetch_unread_emails")).toBe(
      true
    );
    expect(SCHEDULED_LOOP_ALWAYS_BLOCKED_TOOLS.has("get_email_message")).toBe(
      true
    );
    expect(isScheduledReadOnlyTool("fetch_unread_emails")).toBe(false);
    expect(isScheduledReadOnlyTool("get_email_message")).toBe(false);
  });
});

describe("ScheduledAiToolPolicy describeBuiltInToolForSchedule", () => {
  it("marks read-only tools as schedulable", () => {
    const summary = describeBuiltInToolForSchedule(skill("list_email_inboxes"));
    expect(summary.schedulable).toBe(true);
    expect(summary.autoApproveAllowed).toBe(true);
    expect(summary.riskLevel).toBe("low");
  });

  it("blocks permanently denied tools with a concrete reason", () => {
    const summary = describeBuiltInToolForSchedule(
      skill("run_subagent", { permissionCategory: "automation" })
    );
    expect(summary.schedulable).toBe(false);
    expect(summary.autoApproveAllowed).toBe(false);
    expect(summary.blockedReason).toMatch(/permanently blocked/);
  });

  it("blocks non-curated tools even when they look low-risk", () => {
    const summary = describeBuiltInToolForSchedule(
      skill("some_automation_tool", { permissionCategory: "automation" })
    );
    expect(summary.schedulable).toBe(false);
    expect(summary.blockedReason).toMatch(/read-only/);
  });
});

describe("ScheduledAiToolPolicy canAutoApproveScheduledTool", () => {
  it("allows an allowlisted read-only tool when auto-approve is on", () => {
    expect(
      canAutoApproveScheduledTool({
        skill: skill("list_email_inboxes"),
        taskPolicy: policy(),
        toolName: "list_email_inboxes",
      }).allowed
    ).toBe(true);
  });

  it("denies when auto-approve is disabled", () => {
    const decision = canAutoApproveScheduledTool({
      skill: skill("list_email_inboxes"),
      taskPolicy: policy({ autoApproveTools: false }),
      toolName: "list_email_inboxes",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/Auto-approve is not enabled/);
  });

  it("denies when the tool is absent from the task allowlist", () => {
    const decision = canAutoApproveScheduledTool({
      skill: skill("list_email_services"),
      taskPolicy: policy({ allowedTools: ["list_email_inboxes"] }),
      toolName: "list_email_services",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/allowed tools list/);
  });

  it("always denies run_subagent even if allowlisted and auto-approved", () => {
    const decision = canAutoApproveScheduledTool({
      skill: skill("run_subagent"),
      taskPolicy: policy({
        allowedTools: ["run_subagent"],
        autoApproveTools: true,
      }),
      toolName: "run_subagent",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/permanently blocked/);
  });

  it("denies shell, file write/edit, and email send tools", () => {
    for (const name of [
      "shell_execute",
      "file_write",
      "file_edit",
      "send_email_reply",
      "start_email_send_task",
      "create_email_reply_draft",
      "mark_email_processed",
    ]) {
      const decision = canAutoApproveScheduledTool({
        skill: skill(name),
        taskPolicy: policy({ allowedTools: [name], autoApproveTools: true }),
        toolName: name,
      });
      expect(decision.allowed, `${name} should be blocked`).toBe(false);
    }
  });

  it("denies non-built-in skills", () => {
    const decision = canAutoApproveScheduledTool({
      skill: skill("list_email_inboxes", { source: "user" }),
      taskPolicy: policy(),
      toolName: "list_email_inboxes",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/built-in/);
  });
});

describe("ScheduledAiToolPolicy validateScheduledLoopAllowedTools", () => {
  it("accepts a list of curated read-only tools", () => {
    const result = validateScheduledLoopAllowedTools([
      "list_email_inboxes",
      "list_email_services",
    ]);
    expect(result.valid).toBe(true);
    expect(result.invalidTools).toEqual([]);
  });

  it("rejects unknown or dangerous tools and reports them", () => {
    const result = validateScheduledLoopAllowedTools([
      "list_email_inboxes",
      "run_subagent",
      "mystery_tool",
    ]);
    expect(result.valid).toBe(false);
    expect(result.invalidTools).toContain("run_subagent");
    expect(result.invalidTools).toContain("mystery_tool");
    expect(result.invalidTools).not.toContain("list_email_inboxes");
  });

  it("the read-only and deny sets are disjoint", () => {
    for (const name of SCHEDULED_LOOP_READ_ONLY_TOOLS) {
      expect(SCHEDULED_LOOP_ALWAYS_BLOCKED_TOOLS.has(name)).toBe(false);
    }
  });
});
