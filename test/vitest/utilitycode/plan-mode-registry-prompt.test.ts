import { describe, expect, it } from "vitest";
import { PlanModeToolRegistry } from "@/service/PlanModeToolRegistry";
import { buildPlanModeSystemPrompt } from "@/service/PlanModePromptBuilder";
import type { AIChatPlanStateView } from "@/entityTypes/aiChatPlanTypes";

describe("PlanModeToolRegistry", () => {
  describe("getToolFunctions", () => {
    it("returns exactly 2 plan tools", () => {
      const tools = PlanModeToolRegistry.getToolFunctions();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toContain("AskUserQuestion");
      expect(tools.map((t) => t.name)).toContain("SubmitPlanForApproval");
    });
  });

  describe("toOpenAITools", () => {
    it("returns OpenAI-compatible tool objects", () => {
      const tools = PlanModeToolRegistry.toOpenAITools();
      expect(tools).toHaveLength(2);
      for (const tool of tools) {
        expect(tool.type).toBe("function");
        expect(tool.function.name).toBeTruthy();
        expect(tool.function.description).toBeTruthy();
        expect(tool.function.parameters).toBeDefined();
        expect(tool.function.parameters.type).toBe("object");
      }
    });

    it("AskUserQuestion enforces 1-3 questions with 2-4 options", () => {
      const tools = PlanModeToolRegistry.toOpenAITools();
      const askTool = tools.find(
        (t) => t.function.name === "AskUserQuestion"
      );
      expect(askTool).toBeDefined();
      const questionsProp = askTool!.function.parameters!.properties!
        .questions;
      expect(questionsProp.minItems).toBe(1);
      expect(questionsProp.maxItems).toBe(3);
    });

    it("SubmitPlanForApproval requires title, objective, planMarkdown", () => {
      const tools = PlanModeToolRegistry.toOpenAITools();
      const submitTool = tools.find(
        (t) => t.function.name === "SubmitPlanForApproval"
      );
      expect(submitTool).toBeDefined();
      const required = submitTool!.function.parameters!.required;
      expect(required).toContain("title");
      expect(required).toContain("objective");
      expect(required).toContain("planMarkdown");
    });
  });

  describe("isPlanTool", () => {
    it("returns true for plan tool names", () => {
      expect(PlanModeToolRegistry.isPlanTool("AskUserQuestion")).toBe(true);
      expect(
        PlanModeToolRegistry.isPlanTool("SubmitPlanForApproval")
      ).toBe(true);
    });

    it("returns false for non-plan tools", () => {
      expect(PlanModeToolRegistry.isPlanTool("scrape_urls")).toBe(false);
      expect(PlanModeToolRegistry.isPlanTool("")).toBe(false);
      expect(PlanModeToolRegistry.isPlanTool("askUserQuestion")).toBe(false);
    });
  });
});

describe("buildPlanModeSystemPrompt", () => {
  it("includes the base system prompt", () => {
    const prompt = buildPlanModeSystemPrompt({
      baseSystemPrompt: "You are a marketing assistant.",
      planState: null,
    });
    expect(prompt).toContain("You are a marketing assistant.");
    expect(prompt).toContain("# Plan Mode");
  });

  it("falls back to default base prompt when empty", () => {
    const prompt = buildPlanModeSystemPrompt({
      baseSystemPrompt: "",
      planState: null,
    });
    expect(prompt).toContain("You are a helpful assistant.");
  });

  it("includes workflow steps", () => {
    const prompt = buildPlanModeSystemPrompt({
      baseSystemPrompt: "Base.",
      planState: null,
    });
    expect(prompt).toContain("Understand");
    expect(prompt).toContain("Explore");
    expect(prompt).toContain("Clarify");
    expect(prompt).toContain("Design");
    expect(prompt).toContain("Submit");
  });

  it("includes domain-adaptive sections guidance", () => {
    const prompt = buildPlanModeSystemPrompt({
      baseSystemPrompt: "Base.",
      planState: null,
    });
    expect(prompt).toContain("universal sections");
    expect(prompt).toContain("marketing-specific");
  });

  it("shows 'No active plan yet' when planState is null", () => {
    const prompt = buildPlanModeSystemPrompt({
      baseSystemPrompt: "Base.",
      planState: null,
    });
    expect(prompt).toContain("No active plan yet");
  });

  it("includes plan state details when plan exists", () => {
    const planState: AIChatPlanStateView = {
      planId: "plan-123",
      conversationId: "v2-conv",
      status: "awaiting_approval",
      title: "Email Campaign Plan",
      objective: "Launch a Q3 email sequence",
      currentVersion: 2,
      latestVersion: {
        planId: "plan-123",
        version: 2,
        planMarkdown: "# Email Campaign\nSend 5 emails",
        createdAt: new Date().toISOString(),
        createdBy: "ai",
      },
    };
    const prompt = buildPlanModeSystemPrompt({
      baseSystemPrompt: "Base.",
      planState,
    });
    expect(prompt).toContain("plan-123");
    expect(prompt).toContain("awaiting_approval");
    expect(prompt).toContain("Email Campaign Plan");
    expect(prompt).toContain("# Email Campaign");
  });

  it("includes tool gating instructions", () => {
    const prompt = buildPlanModeSystemPrompt({
      baseSystemPrompt: "Base.",
      planState: null,
    });
    expect(prompt).toContain("BLOCKED");
    expect(prompt).toContain("AskUserQuestion");
    expect(prompt).toContain("SubmitPlanForApproval");
  });
});
