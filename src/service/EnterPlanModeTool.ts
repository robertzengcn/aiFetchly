import type { OpenAITool, ToolFunction } from "@/api/aiChatApi";

/**
 * Arguments for the EnterPlanMode tool. The model supplies a rationale
 * (shown to the user) and an optional restated objective that seeds the
 * plan record.
 */
export interface EnterPlanModeArguments {
  rationale: string;
  objective?: string;
}

export const ENTER_PLAN_MODE_TOOL_FUNCTION: ToolFunction = {
  type: "function",
  name: "EnterPlanMode",
  description:
    "Transition this conversation into Plan Mode when the user's request is " +
    "complex, multi-step, or touches high-impact marketing actions. Plan Mode " +
    "lets you clarify requirements, design a structured plan, and get user " +
    "approval BEFORE executing actions like sending emails, posting to social " +
    "platforms, modifying campaigns, scraping at scale, or automating accounts. " +
    "Do NOT call this for: simple lookups, single-shot Q&A, one-line asset " +
    "generation, or reading existing data. The switch is silent — the user " +
    "will see a Plan Mode indicator. After calling, immediately begin the " +
    "plan-mode workflow (Understand, Explore, Clarify, Design, Submit).",
  parameters: {
    type: "object",
    properties: {
      rationale: {
        type: "string",
        description:
          "One sentence explaining why this task warrants planning. May be shown to the user.",
      },
      objective: {
        type: "string",
        description: "Restated objective for the plan, <=500 chars.",
        maxLength: 500,
      },
    },
    required: ["rationale"],
  },
};

export const ENTER_PLAN_MODE_TOOL: OpenAITool = {
  type: "function",
  function: {
    name: ENTER_PLAN_MODE_TOOL_FUNCTION.name,
    description: ENTER_PLAN_MODE_TOOL_FUNCTION.description,
    parameters: ENTER_PLAN_MODE_TOOL_FUNCTION.parameters,
  },
};

export function isEnterPlanModeToolName(name: string): boolean {
  return name === "EnterPlanMode";
}

/**
 * Coerce raw tool arguments into a safe EnterPlanModeArguments, truncating
 * the objective to the same limit AIChatPlanModule enforces.
 */
export function sanitizeEnterPlanModeArgs(
  raw: Record<string, unknown>
): EnterPlanModeArguments {
  const rationale =
    typeof raw.rationale === "string"
      ? raw.rationale
      : String(raw.rationale ?? "");
  const objective =
    typeof raw.objective === "string"
      ? raw.objective.slice(0, 500)
      : undefined;
  return { rationale, objective };
}
