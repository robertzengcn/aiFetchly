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
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
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
 * All of these are local SQLite / SkillRegistry lookups. They do not call
 * hosted AI APIs, so they stay on registerValidatedHandler — same pattern as
 * RAG document CRUD and SKILL_LIST_INSTALLED. The schedule create/edit form
 * and run history need this even when hosted AI is off (local provider).
 *
 * Actual model invocation is gated in ScheduledAiMessageRunner via
 * AIProviderResolver.resolveForChat() (hosted subscription OR local provider).
 */
export function registerAiMessageTaskIpcHandlers(): void {
  console.log("AI Message Task IPC handlers registered");

  registerValidatedHandler(
    AI_MESSAGE_TASK_CREATE,
    aiMessageTaskWriteInputSchema,
    async (input) => {
      const module = new AiMessageTaskModule();
      return module.createTask(input as unknown as CreateAiMessageTaskRequest);
    },
  );

  registerValidatedHandler(
    AI_MESSAGE_TASK_UPDATE,
    aiMessageTaskWriteInputSchema,
    async (input) => {
      const module = new AiMessageTaskModule();
      await module.updateTask(input as unknown as UpdateAiMessageTaskRequest);
      return null;
    },
  );

  registerValidatedHandler(
    AI_MESSAGE_TASK_DELETE,
    aiMessageTaskByIdInputSchema,
    async (input) => {
      const module = new AiMessageTaskModule();
      await module.deleteTask(input.id);
      return null;
    },
  );

  registerValidatedHandler(
    AI_MESSAGE_TASK_LIST,
    aiMessageTaskListInputSchema,
    async (input) => {
      const module = new AiMessageTaskModule();
      return module.listTasks(input.page ?? 1, input.limit ?? 50);
    },
  );

  registerValidatedHandler(
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

  registerValidatedHandler(
    AI_MESSAGE_TASK_RUN_LIST,
    aiMessageTaskRunListInputSchema,
    async (input) => {
      const module = new AiMessageTaskRunModule();
      return module.listRunsByTask(input.taskId, input.page ?? 1, input.limit ?? 20);
    },
  );

  registerValidatedHandler(
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

  registerValidatedHandler(
    AI_MESSAGE_TASK_LIST_AVAILABLE_TOOLS,
    aiMessageTaskListToolsInputSchema,
    async () => {
      return listSchedulableBuiltInTools();
    },
  );
}
