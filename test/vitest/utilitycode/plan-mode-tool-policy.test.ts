import { describe, expect, it } from "vitest";
import {
  checkPlanModeToolPolicy,
  isPlanToolName,
  PLAN_TOOL_NAMES,
} from "@/service/PlanModeToolPolicy";
import type { AIChatPlanStateView } from "@/entityTypes/aiChatPlanTypes";

function makePlanState(
  status: AIChatPlanStateView["status"]
): AIChatPlanStateView {
  return {
    planId: "plan-test",
    conversationId: "v2-test",
    status,
    title: "Test Plan",
    objective: "Test objective",
    currentVersion: 1,
  };
}

describe("PlanModeToolPolicy", () => {
  describe("isPlanToolName", () => {
    it("returns true for AskUserQuestion", () => {
      expect(isPlanToolName("AskUserQuestion")).toBe(true);
    });

    it("returns true for SubmitPlanForApproval", () => {
      expect(isPlanToolName("SubmitPlanForApproval")).toBe(true);
    });

    it("returns false for non-plan tools", () => {
      expect(isPlanToolName("scrape_urls")).toBe(false);
      expect(isPlanToolName("send_email")).toBe(false);
      expect(isPlanToolName("")).toBe(false);
    });

    it("exports the correct plan tool name set", () => {
      expect(PLAN_TOOL_NAMES.has("AskUserQuestion")).toBe(true);
      expect(PLAN_TOOL_NAMES.has("SubmitPlanForApproval")).toBe(true);
      expect(PLAN_TOOL_NAMES.size).toBe(2);
    });
  });

  describe("checkPlanModeToolPolicy — plan tools", () => {
    it("always allows plan tools regardless of plan state", () => {
      const result = checkPlanModeToolPolicy({
        toolName: "AskUserQuestion",
        context: { conversationId: "v2-test", planState: null },
      });
      expect(result.allowed).toBe(true);
      expect(result.category).toBe("plan_tool");
    });

    it("allows SubmitPlanForApproval even before any plan exists", () => {
      const result = checkPlanModeToolPolicy({
        toolName: "SubmitPlanForApproval",
        context: { conversationId: "v2-test", planState: null },
      });
      expect(result.allowed).toBe(true);
      expect(result.category).toBe("plan_tool");
    });
  });

  describe("checkPlanModeToolPolicy — after approval", () => {
    it("allows all tools when plan is approved", () => {
      const result = checkPlanModeToolPolicy({
        toolName: "send_email",
        skillPermissionCategory: "automation",
        context: {
          conversationId: "v2-test",
          planState: makePlanState("approved"),
        },
      });
      expect(result.allowed).toBe(true);
    });

    it("allows network tools after approval", () => {
      const result = checkPlanModeToolPolicy({
        toolName: "scrape_urls",
        skillPermissionCategory: "network",
        context: {
          conversationId: "v2-test",
          planState: makePlanState("approved"),
        },
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe("checkPlanModeToolPolicy — pre-approval pure tools", () => {
    it("allows pure-category tools before approval", () => {
      const result = checkPlanModeToolPolicy({
        toolName: "some_pure_calculator",
        skillPermissionCategory: "pure",
        context: {
          conversationId: "v2-test",
          planState: makePlanState("draft"),
        },
      });
      expect(result.allowed).toBe(true);
      expect(result.category).toBe("pure");
    });

    it("allows named allowlist tools before approval", () => {
      const result = checkPlanModeToolPolicy({
        toolName: "knowledge_base_search",
        skillPermissionCategory: "network",
        context: {
          conversationId: "v2-test",
          planState: makePlanState("draft"),
        },
      });
      expect(result.allowed).toBe(true);
      expect(result.category).toBe("read_only_allowed");
    });

    it("allows list_available_skills via allowlist", () => {
      const result = checkPlanModeToolPolicy({
        toolName: "list_available_skills",
        context: {
          conversationId: "v2-test",
          planState: makePlanState("draft"),
        },
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe("checkPlanModeToolPolicy — pre-approval blocked tools", () => {
    it("blocks network tools before approval", () => {
      const result = checkPlanModeToolPolicy({
        toolName: "scrape_urls",
        skillPermissionCategory: "network",
        context: {
          conversationId: "v2-test",
          planState: makePlanState("draft"),
        },
      });
      expect(result.allowed).toBe(false);
      expect(result.category).toBe("blocked_until_approval");
      expect(result.reason).toContain("scrape_urls");
    });

    it("blocks automation tools before approval", () => {
      const result = checkPlanModeToolPolicy({
        toolName: "send_email",
        skillPermissionCategory: "automation",
        context: {
          conversationId: "v2-test",
          planState: makePlanState("awaiting_approval"),
        },
      });
      expect(result.allowed).toBe(false);
      expect(result.category).toBe("blocked_until_approval");
    });

    it("blocks filesystem tools before approval", () => {
      const result = checkPlanModeToolPolicy({
        toolName: "write_file",
        skillPermissionCategory: "filesystem",
        context: {
          conversationId: "v2-test",
          planState: makePlanState("draft"),
        },
      });
      expect(result.allowed).toBe(false);
    });

    it("blocks shell tools before approval", () => {
      const result = checkPlanModeToolPolicy({
        toolName: "execute_shell",
        skillPermissionCategory: "shell",
        context: {
          conversationId: "v2-test",
          planState: makePlanState("draft"),
        },
      });
      expect(result.allowed).toBe(false);
    });
  });

  describe("checkPlanModeToolPolicy — unknown tools", () => {
    it("blocks unknown tools before approval", () => {
      const result = checkPlanModeToolPolicy({
        toolName: "some_unknown_tool",
        context: {
          conversationId: "v2-test",
          planState: makePlanState("draft"),
        },
      });
      expect(result.allowed).toBe(false);
      expect(result.category).toBe("blocked_until_approval");
      expect(result.reason).toContain("some_unknown_tool");
    });
  });

  describe("checkPlanModeToolPolicy — no plan state", () => {
    it("blocks non-plan, non-allowlist tools when planState is null", () => {
      const result = checkPlanModeToolPolicy({
        toolName: "send_email",
        skillPermissionCategory: "automation",
        context: {
          conversationId: "v2-test",
          planState: null,
        },
      });
      expect(result.allowed).toBe(false);
    });

    it("still allows pure tools when planState is null", () => {
      const result = checkPlanModeToolPolicy({
        toolName: "some_pure_tool",
        skillPermissionCategory: "pure",
        context: {
          conversationId: "v2-test",
          planState: null,
        },
      });
      expect(result.allowed).toBe(true);
    });
  });
});
