// src/main-process/communication/agent-runtime-ipc.ts
import { z } from "zod";
import { AgentDefinitionModule } from "@/modules/AgentDefinitionModule";
import { AgentTaskModule } from "@/modules/AgentTaskModule";
import {
  AGENT_DEFINITION_LIST,
  AGENT_TASK_DETAIL,
  AGENT_TASK_TRANSCRIPT,
  AGENT_TASK_LIST,
  AGENT_RESUME_TOOL_AFTER_PERMISSION,
} from "@/config/channellist";
import { lazySchema } from "@/utils/lazySchema";
import { registerAiValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import { agentTaskIdInputSchema, agentResumeToolInputSchema } from "@/schemas/ipc/agentRuntime";

// For handlers that take no meaningful input, but still need to pass through
// the wrapper (for AI gating + uniform envelope shape).
const noInputSchema = lazySchema(() => z.unknown());

/**
 * Register agent runtime IPC handlers.
 *
 * All 4 are AI-gated handlers (original code called isAIEnabled() at the top
 * of each helper). Migrating to registerAiValidatedHandler:
 *  - moves the AI-enabled check into the wrapper (single place)
 *  - replaces JSON.parse(data ?? '{}') + typeof checks with zod schema
 *  - removes the bespoke ok()/denied() helpers
 *
 * LIST and RESUME don't actually consume input; they use z.unknown() schema
 * so the wrapper still runs safeParse (always succeeds) + AI check.
 */
export function registerAgentRuntimeIpcHandlers(): void {
  registerAiValidatedHandler(
    AGENT_DEFINITION_LIST,
    noInputSchema,
    async () => {
      const module = new AgentDefinitionModule();
      return module.listActive();
    }
  );

  registerAiValidatedHandler(
    AGENT_TASK_DETAIL,
    agentTaskIdInputSchema,
    async (input) => {
      const module = new AgentTaskModule();
      return module.getSnapshot(input.agentTaskId);
    }
  );

  registerAiValidatedHandler(
    AGENT_TASK_TRANSCRIPT,
    agentTaskIdInputSchema,
    async (input) => {
      const module = new AgentTaskModule();
      const [messages, toolCalls] = await Promise.all([
        module.listMessages(input.agentTaskId),
        module.listToolCalls(input.agentTaskId),
      ]);
      return { messages, toolCalls };
    }
  );

  registerAiValidatedHandler(
    AGENT_TASK_LIST,
    noInputSchema,
    async () => {
      const module = new AgentTaskModule();
      return module.listRecent(50);
    }
  );

  registerAiValidatedHandler(
    AGENT_RESUME_TOOL_AFTER_PERMISSION,
    agentResumeToolInputSchema,
    async () => {
      // v1 foreground specialist runs do not wire interactive permission resume.
      return {
        ok: false,
        error:
          "Interactive permission resume is not supported for agent tasks in v1.",
      };
    }
  );
}
