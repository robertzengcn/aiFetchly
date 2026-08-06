import { describe, expect, it } from "vitest";
import {
  SCHEDULED_LOOP_ALWAYS_BLOCKED_TOOLS,
  SCHEDULED_LOOP_READ_ONLY_TOOLS,
  canAutoApproveScheduledTool,
  describeBuiltInToolForSchedule,
  hasScheduledLoopEmailInboxIntent,
  isScheduledReadOnlyTool,
  suggestScheduledLoopAutomationTools,
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

  it("mutating mark-processed stays permanently blocked; inbox sync is schedulable", () => {
    expect(
      SCHEDULED_LOOP_ALWAYS_BLOCKED_TOOLS.has("mark_email_processed")
    ).toBe(true);
    expect(SCHEDULED_LOOP_ALWAYS_BLOCKED_TOOLS.has("fetch_unread_emails")).toBe(
      false
    );
    expect(SCHEDULED_LOOP_ALWAYS_BLOCKED_TOOLS.has("get_email_message")).toBe(
      false
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

  it("auto-approves ANY read-only tool when auto-approve is on (no selection)", () => {
    // Per product decision: read-only tools auto-approve without per-tool
    // selection. The catalog intentionally advertises every read-only tool.
    const decision = canAutoApproveScheduledTool({
      skill: skill("list_email_services"),
      taskPolicy: policy({ allowedTools: [] }),
      toolName: "list_email_services",
    });
    expect(decision.allowed).toBe(true);
  });

  it("denies automation tools absent from the task allowlist", () => {
    const decision = canAutoApproveScheduledTool({
      skill: skill("proxy_check"),
      taskPolicy: policy({ allowedTools: ["list_email_inboxes"] }),
      toolName: "proxy_check",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/allowed tools list/);
  });

  it("high-impact tools are denied without explicit allowlist but allowed with it", () => {
    // Without selection → blocked.
    const denied = canAutoApproveScheduledTool({
      skill: skill("file_write"),
      taskPolicy: policy({ allowedTools: [] }),
      toolName: "file_write",
    });
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toMatch(/high-impact/);
    // With explicit selection + autoApprove → allowed unattended.
    const allowed = canAutoApproveScheduledTool({
      skill: skill("send_email_reply"),
      taskPolicy: policy({ allowedTools: ["send_email_reply"] }),
      toolName: "send_email_reply",
    });
    expect(allowed.allowed).toBe(true);
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

  it("permanently blocks shell and mark-processed; inbox sync/read are approvable", () => {
    for (const name of ["shell_execute", "mark_email_processed"]) {
      const decision = canAutoApproveScheduledTool({
        skill: skill(name),
        taskPolicy: policy({ allowedTools: [name], autoApproveTools: true }),
        toolName: name,
      });
      expect(decision.allowed, `${name} should be blocked`).toBe(false);
    }

    expect(
      canAutoApproveScheduledTool({
        skill: skill("fetch_unread_emails"),
        taskPolicy: policy({
          allowedTools: ["fetch_unread_emails"],
          autoApproveTools: true,
        }),
        toolName: "fetch_unread_emails",
      }).allowed
    ).toBe(true);

    expect(
      canAutoApproveScheduledTool({
        skill: skill("get_email_message"),
        taskPolicy: policy({
          allowedTools: ["get_email_message"],
          autoApproveTools: true,
        }),
        toolName: "get_email_message",
      }).allowed
    ).toBe(true);

    expect(
      canAutoApproveScheduledTool({
        skill: skill("fetch_unread_emails"),
        taskPolicy: policy({ allowedTools: [], autoApproveTools: true }),
        toolName: "fetch_unread_emails",
      }).allowed
    ).toBe(false);
  });

  it("suggests fetch_unread_emails for inbox-check prompts", () => {
    expect(
      hasScheduledLoopEmailInboxIntent(
        "check whether there is new email in my emaibox"
      )
    ).toBe(true);
    expect(
      suggestScheduledLoopAutomationTools(
        "check whether there is new email in my emaibox"
      )
    ).toEqual(["fetch_unread_emails"]);
    expect(suggestScheduledLoopAutomationTools("summarize status")).toEqual([]);
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
