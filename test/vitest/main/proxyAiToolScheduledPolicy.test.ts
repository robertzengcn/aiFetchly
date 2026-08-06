import { describe, it, expect } from "vitest";
import { SkillRegistry } from "@/config/skillsRegistry";
import {
  describeBuiltInToolForSchedule,
  canAutoApproveScheduledTool,
} from "@/service/ScheduledAiToolPolicy";
import type { AiMessageTaskToolPolicy } from "@/entityTypes/aiMessageTaskTypes";

function policy(
  overrides: Partial<AiMessageTaskToolPolicy> = {}
): AiMessageTaskToolPolicy {
  return {
    autoApproveTools: false,
    allowedTools: [],
    ...overrides,
  } as AiMessageTaskToolPolicy;
}

describe("proxy AI tools scheduled policy", () => {
  it("classifies proxy_list as schedulable low-risk (pure)", () => {
    const skill = SkillRegistry.getSkill("proxy_list");
    const summary = describeBuiltInToolForSchedule(skill!);
    expect(summary.schedulable).toBe(true);
    expect(summary.riskLevel).toBe("low");
    expect(summary.permissionCategory).toBe("pure");
  });

  it("classifies proxy_check as schedulable but confirmation-required (automation)", () => {
    const skill = SkillRegistry.getSkill("proxy_check");
    const summary = describeBuiltInToolForSchedule(skill!);
    expect(summary.schedulable).toBe(true);
    expect(summary.requiresConfirmation).toBe(true);
    expect(summary.permissionCategory).toBe("automation");
  });

  it("no proxy tool is classified as shell", () => {
    const names = [
      "proxy_list",
      "proxy_get",
      "proxy_create",
      "proxy_update",
      "proxy_delete",
      "proxy_import",
      "proxy_check",
      "proxy_remove_failed",
    ];
    for (const name of names) {
      const skill = SkillRegistry.getSkill(name);
      expect(skill?.permissionCategory).not.toBe("shell");
    }
  });

  it("blocks proxy_delete when auto-approve is off (AC-10)", () => {
    const skill = SkillRegistry.getSkill("proxy_delete")!;
    const decision = canAutoApproveScheduledTool({
      skill,
      taskPolicy: policy({ autoApproveTools: false }),
      toolName: "proxy_delete",
    });
    expect(decision.allowed).toBe(false);
  });

  it("blocks proxy_delete when auto-approve is on but it is not allowlisted", () => {
    const skill = SkillRegistry.getSkill("proxy_delete")!;
    const decision = canAutoApproveScheduledTool({
      skill,
      taskPolicy: policy({ autoApproveTools: true, allowedTools: [] }),
      toolName: "proxy_delete",
    });
    expect(decision.allowed).toBe(false);
  });

  it("allows proxy_check only when auto-approved AND explicitly allowlisted", () => {
    const skill = SkillRegistry.getSkill("proxy_check")!;
    const allowed = canAutoApproveScheduledTool({
      skill,
      taskPolicy: policy({
        autoApproveTools: true,
        allowedTools: ["proxy_check"],
      }),
      toolName: "proxy_check",
    });
    expect(allowed.allowed).toBe(true);

    const blocked = canAutoApproveScheduledTool({
      skill,
      taskPolicy: policy({ autoApproveTools: true, allowedTools: [] }),
      toolName: "proxy_check",
    });
    expect(blocked.allowed).toBe(false);
  });

  it("blocks proxy_list when auto-approve is on but it is not allowlisted (FR-16 least-privilege)", () => {
    // Even a pure read-only tool must be explicitly selected by the user: the
    // catalog filter advertises ANY tool this function allows, so read-only
    // tools now require an allowedTools entry (see commit
    // "fix(scheduled-loop): enforce per-tool allowlist for read-only auto-approve").
    const skill = SkillRegistry.getSkill("proxy_list")!;
    const decision = canAutoApproveScheduledTool({
      skill,
      taskPolicy: policy({ autoApproveTools: true, allowedTools: [] }),
      toolName: "proxy_list",
    });
    expect(decision.allowed).toBe(false);
  });

  it("allows proxy_list in scheduled mode once auto-approve is on AND it is allowlisted", () => {
    const skill = SkillRegistry.getSkill("proxy_list")!;
    const decision = canAutoApproveScheduledTool({
      skill,
      taskPolicy: policy({
        autoApproveTools: true,
        allowedTools: ["proxy_list"],
      }),
      toolName: "proxy_list",
    });
    expect(decision.allowed).toBe(true);
    expect(decision.riskLevel).toBe("low");
  });
});
