import { describe, expect, it } from "vitest";
import {
  SCHEDULED_LOOP_ALWAYS_BLOCKED_TOOLS,
  SCHEDULED_LOOP_READ_ONLY_TOOLS,
  canAutoApproveScheduledTool,
} from "@/service/ScheduledAiToolPolicy";
import { SkillRegistry } from "@/config/skillsRegistry";
import type { SkillDefinition } from "@/entityTypes/skillTypes";

/**
 * Email organization tool registration + scheduled hard-block coverage
 * (PRD FR-01, FR-16; design §7/§8.3). The mutating tools must never be
 * reachable from unattended scheduled loops — including full-access mode —
 * and the three external side effects must use request-scoped confirmation
 * so generic chat approval modes cannot auto-approve them.
 */

const MUTATING_TOOLS = ["send_email_forward", "move_email_to_trash", "restore_email"] as const;
const ALL_ORGANIZATION_TOOLS = [
  "list_email_folders",
  "create_email_forward_draft",
  "update_email_forward_draft",
  ...MUTATING_TOOLS,
  "get_email_operation",
  "cancel_email_operation",
] as const;

function fakeSkill(name: string): SkillDefinition {
  const registered = SkillRegistry.getSkill(name);
  if (!registered) throw new Error(`tool ${name} is not registered`);
  return registered;
}

describe("email organization tool registration (FR-01)", () => {
  it("registers all organization tools as built-ins", () => {
    for (const name of ALL_ORGANIZATION_TOOLS) {
      const skill = SkillRegistry.getSkill(name);
      expect(skill, name).toBeDefined();
      expect(skill?.source).toBe("built-in");
      expect(skill?.tier).toBe("main");
    }
  });

  it("marks external side effects with request-scoped confirmation policy", () => {
    for (const name of MUTATING_TOOLS) {
      const skill = SkillRegistry.getSkill(name);
      expect(skill?.confirmationPolicy, name).toBe("request_scoped_action");
    }
    // Draft/cancel tools are NOT request-scoped (they never send/move);
    // they still require confirmation but through the standard gate.
    for (const name of ["create_email_forward_draft", "update_email_forward_draft"] as const) {
      const skill = SkillRegistry.getSkill(name);
      expect(skill?.confirmationPolicy ?? "standard_permission", name).toBe(
        "standard_permission"
      );
    }
  });

  it("documents that tool arguments never carry authorization", () => {
    for (const name of MUTATING_TOOLS) {
      const skill = SkillRegistry.getSkill(name) as SkillDefinition;
      const parameterNames = Object.keys(
        (skill.parameters as { properties?: Record<string, unknown> }).properties ?? {}
      );
      for (const forbidden of ["approved", "skip_review", "force", "token", "authorization"]) {
        expect(parameterNames, `${name} argument ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe("scheduled-loop hard block (FR-16)", () => {
  it("hard-blocks all mutating and drafting tools for scheduled loops", () => {
    for (const name of [
      ...MUTATING_TOOLS,
      "create_email_forward_draft",
      "update_email_forward_draft",
      "cancel_email_operation",
    ]) {
      expect(SCHEDULED_LOOP_ALWAYS_BLOCKED_TOOLS.has(name), name).toBe(true);
    }
  });

  it("keeps read-only organization tools out of the always-blocked set", () => {
    expect(SCHEDULED_LOOP_ALWAYS_BLOCKED_TOOLS.has("list_email_folders")).toBe(false);
    expect(SCHEDULED_LOOP_ALWAYS_BLOCKED_TOOLS.has("get_email_operation")).toBe(false);
    expect(SCHEDULED_LOOP_READ_ONLY_TOOLS.has("list_email_folders")).toBe(true);
    expect(SCHEDULED_LOOP_READ_ONLY_TOOLS.has("get_email_operation")).toBe(true);
  });

  it("refuses mutating tools even under full_access approval mode", () => {
    for (const name of MUTATING_TOOLS) {
      const skill = fakeSkill(name);
      const decision = canAutoApproveScheduledTool({
        skill,
        taskPolicy: {
          allowedTools: [name],
          autoApproveTools: [name],
        } as never,
        toolName: name,
        approvalMode: "full_access",
      });
      expect(decision.allowed, name).toBe(false);
      expect(decision.riskLevel, name).toBe("blocked");
    }
  });

  it("refuses mutating tools with explicit task allowlists too", () => {
    for (const name of ["move_email_to_trash", "send_email_forward"] as const) {
      const skill = fakeSkill(name);
      const decision = canAutoApproveScheduledTool({
        skill,
        taskPolicy: {
          allowedTools: [name],
          autoApproveTools: [name],
        } as never,
        toolName: name,
        approvalMode: "approve_for_me",
      });
      expect(decision.allowed, name).toBe(false);
    }
  });
});
