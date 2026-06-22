// src/service/agentTools/runSubagentTool.ts
import type { SkillDefinition } from "@/entityTypes/skillTypes";
import {
  AgentRuntimeRegistry,
  getDefaultAgentRuntimeDeps,
} from "@/service/AgentRuntimeRegistry";
import type {
  AgentTaskPacket,
  RunAgentRequest,
} from "@/entityTypes/agentTypes";

const PARAMETERS = {
  type: "object",
  properties: {
    agentId: {
      type: "string",
      description:
        "Built-in agent ID to run, e.g. 'agent-lead-researcher'. Must be active.",
    },
    prompt: {
      type: "string",
      description: "Short instruction for the specialist agent.",
    },
    taskPacket: {
      type: "object",
      description:
        "Self-contained task packet: lead, userGoal, constraints, priorFindings, requiredOutputSchema.",
    },
    outputSchema: {
      type: "object",
      description:
        "Optional narrower output schema (cannot remove audit fields).",
    },
  },
  required: ["agentId", "prompt", "taskPacket"],
};

export const RUN_SUBAGENT_TOOL: SkillDefinition = {
  name: "run_subagent",
  description:
    "Run a built-in marketing specialist agent (e.g. lead researcher) synchronously and return its structured result. Use this to delegate a focused research/enrichment task to a specialist with its own narrowed tools.",
  parameters: PARAMETERS,
  tier: "main",
  requiresConfirmation: false,
  permissionCategory: "pure",
  source: "built-in",
  execute: async (args, context) => {
    const agentId = args.agentId as string;
    const prompt = args.prompt as string;
    const taskPacket = args.taskPacket as AgentTaskPacket;
    if (!agentId || !prompt || !taskPacket) {
      return {
        success: false,
        result: { error: "agentId, prompt, and taskPacket are required" },
      };
    }
    const request: RunAgentRequest = {
      agentId,
      prompt,
      taskPacket,
      parentConversationId: context.conversationId,
      executionMode: "foreground",
      outputSchemaOverride: args.outputSchema as
        | Record<string, unknown>
        | undefined,
    };
    const runtime = AgentRuntimeRegistry.getRuntime();
    const result = await runtime.runSync(request, getDefaultAgentRuntimeDeps());
    return {
      success: result.status === "completed",
      result: {
        agentTaskId: result.agentTaskId,
        agentId: result.agentId,
        status: result.status,
        output: result.output,
        sourceUrls: result.sourceUrls,
        confidence: result.confidence,
        error: result.errorMessage,
      },
    };
  },
};
