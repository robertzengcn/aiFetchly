import type { ToolFunction, OpenAITool } from "@/api/aiChatApi";

const ASK_USER_QUESTION_TOOL: ToolFunction = {
  type: "function",
  name: "AskUserQuestion",
  description:
    "Ask the user 1-3 structured clarification questions during Plan Mode. Each question has a short header, the full question text, and 2-4 options with descriptions. The UI appends an 'Other' option. Do NOT use this for final plan approval — use SubmitPlanForApproval for that.",
  parameters: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            header: {
              type: "string",
              description: "Short label, <=12 chars when practical.",
            },
            question: { type: "string" },
            multiSelect: { type: "boolean", default: false },
            options: {
              type: "array",
              minItems: 2,
              maxItems: 4,
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  description: { type: "string" },
                },
                required: ["label", "description"],
              },
            },
          },
          required: ["header", "question", "options"],
        },
      },
    },
    required: ["questions"],
  },
};

const SUBMIT_PLAN_FOR_APPROVAL_TOOL: ToolFunction = {
  type: "function",
  name: "SubmitPlanForApproval",
  description:
    "Submit the final structured plan for user approval in Plan Mode. Saves a new plan version and renders an approval card. Use this exactly once per plan revision.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "User-facing plan title." },
      objective: {
        type: "string",
        description: "Concise objective statement.",
      },
      planMarkdown: {
        type: "string",
        description: "Full readable plan in markdown.",
      },
      planJson: {
        type: "object",
        description:
          "Structured plan payload following the domain-adaptive template.",
        additionalProperties: true,
      },
    },
    required: ["title", "objective", "planMarkdown"],
  },
};

const PLAN_TOOLS: ToolFunction[] = [
  ASK_USER_QUESTION_TOOL,
  SUBMIT_PLAN_FOR_APPROVAL_TOOL,
];

const PLAN_TOOL_NAMES = new Set(PLAN_TOOLS.map((t) => t.name));

export const PlanModeToolRegistry = {
  getToolFunctions(): ToolFunction[] {
    return PLAN_TOOLS;
  },
  toOpenAITools(): OpenAITool[] {
    return PLAN_TOOLS.map((tool) => ({
      type: "function",
      function: {
        name: tool.name!,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  },
  isPlanTool(name: string): boolean {
    return PLAN_TOOL_NAMES.has(name);
  },
} as const;
