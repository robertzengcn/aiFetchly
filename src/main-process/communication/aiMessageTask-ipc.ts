import { AiMessageTaskModule } from "@/modules/AiMessageTaskModule";
import { AiMessageTaskRunModule } from "@/modules/AiMessageTaskRunModule";
import { listSchedulableBuiltInTools } from "@/service/AiMessageToolCatalogService";
import {
  AI_MESSAGE_TASK_CREATE,
  AI_MESSAGE_TASK_UPDATE,
  AI_MESSAGE_TASK_DELETE,
  AI_MESSAGE_TASK_LIST,
  AI_MESSAGE_TASK_DETAIL,
  AI_MESSAGE_TASK_RUN_LIST,
  AI_MESSAGE_TASK_RUN_DETAIL,
  AI_MESSAGE_TASK_LIST_AVAILABLE_TOOLS,
} from "@/config/channellist";
import type {
  CreateAiMessageTaskRequest,
  UpdateAiMessageTaskRequest,
} from "@/entityTypes/aiMessageTaskTypes";
import {
  registerAiValidatedHandler,
  registerValidatedHandler,
} from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  aiMessageTaskWriteInputSchema,
  aiMessageTaskByIdInputSchema,
  aiMessageTaskListInputSchema,
  aiMessageTaskRunListInputSchema,
  aiMessageTaskListToolsInputSchema,
} from "@/schemas/ipc/aiMessageTask";

/**
 * AI Message Task IPC handlers.
 *
 * Create/update/delete/list/detail/run handlers are AI-gated. The tools
 * catalog is a local SkillRegistry lookup with no AI API call, so it stays
 * on registerValidatedHandler — same pattern as RAG_GET_AVAILABLE_MODELS
 * and SKILL_LIST_INSTALLED. The schedule create form needs that catalog
 * even when hosted AI is off (local provider, or filling the form first).
 */
export function registerAiMessageTaskIpcHandlers(): void {
  console.log("AI Message Task IPC handlers registered");

  registerAiValidatedHandler(
    AI_MESSAGE_TASK_CREATE,
    aiMessageTaskWriteInputSchema,
    async (input) => {
      const module = new AiMessageTaskModule();
      return module.createTask(input as unknown as CreateAiMessageTaskRequest);
    },
  );

  registerAiValidatedHandler(
    AI_MESSAGE_TASK_UPDATE,
    aiMessageTaskWriteInputSchema,
    async (input) => {
      const module = new AiMessageTaskModule();
      await module.updateTask(input as unknown as UpdateAiMessageTaskRequest);
      return null;
    },
  );

  registerAiValidatedHandler(
    AI_MESSAGE_TASK_DELETE,
    aiMessageTaskByIdInputSchema,
    async (input) => {
      const module = new AiMessageTaskModule();
      await module.deleteTask(input.id);
      return null;
    },
  );

  registerAiValidatedHandler(
    AI_MESSAGE_TASK_LIST,
    aiMessageTaskListInputSchema,
    async (input) => {
      const module = new AiMessageTaskModule();
      return module.listTasks(input.page ?? 1, input.limit ?? 50);
    },
  );

  registerAiValidatedHandler(
    AI_MESSAGE_TASK_DETAIL,
    aiMessageTaskByIdInputSchema,
    async (input) => {
      const module = new AiMessageTaskModule();
      const task = await module.getTask(input.id);
      if (!task) {
        throw new Error("AI message task not found");
      }
      return task;
    },
  );

  registerAiValidatedHandler(
    AI_MESSAGE_TASK_RUN_LIST,
    aiMessageTaskRunListInputSchema,
    async (input) => {
      const module = new AiMessageTaskRunModule();
      return module.listRunsByTask(input.taskId, input.page ?? 1, input.limit ?? 20);
    },
  );

  registerAiValidatedHandler(
    AI_MESSAGE_TASK_RUN_DETAIL,
    aiMessageTaskByIdInputSchema,
    async (input) => {
      const module = new AiMessageTaskRunModule();
      const run = await module.getRun(input.id);
      if (!run) {
        throw new Error("AI message task run not found");
      }
      return run;
    },
  );

  // Local catalog only — do not gate on USER_AI_ENABLED.
  registerValidatedHandler(
    AI_MESSAGE_TASK_LIST_AVAILABLE_TOOLS,
    aiMessageTaskListToolsInputSchema,
    async () => {
      return listSchedulableBuiltInTools();
    },
  );
}
