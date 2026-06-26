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

/**
 * Timeout class for run_subagent.
 *
 * A specialist subagent runs its own model→tool→model loop. Inner-agent
 * work routinely takes 1–3 minutes (lead-researcher default cap is
 * maxRuntimeMs=180000ms via AgentDefinitionRegistry), and a subagent
 * that internally calls another async tool (e.g. extract_contact_info
 * with 8+ URLs) can take longer still.
 *
 * Previously this was declared "browser" (240s synchronous), which caused
 * two coupled problems:
 *
 *   1. Outer race: executeToolWithTimeout raced run_subagent against a
 *      240s ceiling. Any subagent whose maxRuntimeMs was raised above
 *      240s — or whose wall-clock pushed past 240s with overhead — hit
 *      the outer race and returned an opaque timedOut error, even though
 *      the inner agent would have completed.
 *
 *   2. Inner-cascade: the inner agent's tool calls (e.g. a 10-URL
 *      extract_contact_info) go through their own executeToolWithTimeout.
 *      If the inner tool is itself long-running, the OUTER 240s race
 *      fires first and orphans the still-running inner work.
 *
 * Routing unconditionally to "async" eliminates both:
 *   - The outer loop returns { async: true, job_id } within ~2s and the
 *     model polls check_tool_job_status every 15-30s.
 *   - The inner agent's own maxRuntimeMs (via abortController at
 *     AgentRuntime.ts:221) becomes the real upper bound on subagent
 *     work. The outer race is unreachable.
 *
 * Why unconditional (not argument-driven like extract_contact_info):
 *   Unlike URLs or max_results, nothing in the run_subagent args
 *   (agentId, prompt, taskPacket) reliably predicts runtime. Even
 *   trivial subagent tasks take 30-60s. Always-async makes the contract
 *   uniform — the model always polls, no conditional description logic.
 */

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
    "Run a built-in marketing specialist agent (e.g. lead researcher) and return its structured result. Use this to delegate a focused research/enrichment task to a specialist with its own narrowed tools. " +
    "This tool ALWAYS runs ASYNCHRONOUSLY: it returns { async: true, job_id } within ~2 seconds and continues working in the background. " +
    "Poll the result with check_tool_job_status(job_id) every 15-30 seconds until status is 'completed' or 'failed'. " +
    "Do not call run_subagent again while a job is running. Use cancel_tool_job(job_id) if the user wants to stop the specialist early.",
  parameters: PARAMETERS,
  tier: "main",
  requiresConfirmation: false,
  permissionCategory: "pure",
  source: "built-in",
  // Always route to the async ToolJobRegistry path. See the block-level
  // comment above for why this is unconditional and what cascades it
  // prevents. resolveTimeoutClass wins over any static timeoutClass.
  resolveTimeoutClass: () => "async",
  async: true,
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
