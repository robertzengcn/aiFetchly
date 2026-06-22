import { describe, it, expect } from "vitest";
import {
  ENTER_PLAN_MODE_TOOL,
  isEnterPlanModeToolName,
  sanitizeEnterPlanModeArgs,
  type EnterPlanModeArguments,
} from "@/service/EnterPlanModeTool";

describe("EnterPlanModeTool", () => {
  describe("ENTER_PLAN_MODE_TOOL definition", () => {
    it("exposes the OpenAI tool shape", () => {
      expect(ENTER_PLAN_MODE_TOOL.type).toBe("function");
      expect(ENTER_PLAN_MODE_TOOL.function.name).toBe("EnterPlanMode");
      const params = ENTER_PLAN_MODE_TOOL.function.parameters;
      expect(params?.required).toEqual(["rationale"]);
    });

    it("marks rationale as required and objective as optional", () => {
      const props = ENTER_PLAN_MODE_TOOL.function.parameters
        ?.properties as Record<string, unknown>;
      expect(props.rationale).toBeDefined();
      expect(props.objective).toBeDefined();
    });
  });

  describe("isEnterPlanModeToolName", () => {
    it("matches the tool name", () => {
      expect(isEnterPlanModeToolName("EnterPlanMode")).toBe(true);
    });

    it("rejects other names", () => {
      expect(isEnterPlanModeToolName("AskUserQuestion")).toBe(false);
      expect(isEnterPlanModeToolName("SubmitPlanForApproval")).toBe(false);
      expect(isEnterPlanModeToolName("")).toBe(false);
    });
  });

  describe("sanitizeEnterPlanModeArgs", () => {
    it("accepts a valid rationale", () => {
      const out = sanitizeEnterPlanModeArgs({ rationale: "complex campaign" });
      expect(out.rationale).toBe("complex campaign");
      expect(out.objective).toBeUndefined();
    });

    it("truncates objective to 500 chars", () => {
      const long = "x".repeat(600);
      const out = sanitizeEnterPlanModeArgs({ rationale: "r", objective: long });
      expect((out.objective ?? "").length).toBe(500);
    });

    it("coerces missing rationale to empty string", () => {
      const out = sanitizeEnterPlanModeArgs({});
      expect(out.rationale).toBe("");
    });

    it("returns a well-typed EnterPlanModeArguments", () => {
      const out: EnterPlanModeArguments = sanitizeEnterPlanModeArgs({
        rationale: "x",
      });
      expect(out.rationale).toBe("x");
    });
  });
});
