import { ipcMain } from "electron";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
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
import type { CommonMessage } from "@/entityTypes/commonType";
import type {
  CreateAiMessageTaskRequest,
  UpdateAiMessageTaskRequest,
} from "@/entityTypes/aiMessageTaskTypes";

function isAiEnabled(): boolean {
  const token = new Token();
  return token.getValue(USER_AI_ENABLED) === "true";
}

export function registerAiMessageTaskIpcHandlers(): void {
  console.log("AI Message Task IPC handlers registered");

  // Create AI message task
  ipcMain.handle(
    AI_MESSAGE_TASK_CREATE,
    async (_event, data: unknown): Promise<CommonMessage<number>> => {
      if (!isAiEnabled()) {
        return {
          status: false,
          msg: "AI features are not enabled",
          data: null,
        };
      }
      try {
        const request = (typeof data === "string"
          ? JSON.parse(data)
          : data) as CreateAiMessageTaskRequest;
        const module = new AiMessageTaskModule();
        const id = await module.createTask(request);
        return { status: true, msg: "AI message task created", data: id };
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        console.error("AI_MESSAGE_TASK_CREATE error:", msg);
        return { status: false, msg, data: null };
      }
    }
  );

  // Update AI message task
  ipcMain.handle(
    AI_MESSAGE_TASK_UPDATE,
    async (_event, data: unknown): Promise<CommonMessage<null>> => {
      if (!isAiEnabled()) {
        return {
          status: false,
          msg: "AI features are not enabled",
          data: null,
        };
      }
      try {
        const request = (typeof data === "string"
          ? JSON.parse(data)
          : data) as UpdateAiMessageTaskRequest;
        const module = new AiMessageTaskModule();
        await module.updateTask(request);
        return { status: true, msg: "AI message task updated", data: null };
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        console.error("AI_MESSAGE_TASK_UPDATE error:", msg);
        return { status: false, msg, data: null };
      }
    }
  );

  // Delete AI message task
  ipcMain.handle(
    AI_MESSAGE_TASK_DELETE,
    async (_event, data: unknown): Promise<CommonMessage<null>> => {
      if (!isAiEnabled()) {
        return {
          status: false,
          msg: "AI features are not enabled",
          data: null,
        };
      }
      try {
        const id =
          typeof data === "string" ? JSON.parse(data) : (data as number);
        const module = new AiMessageTaskModule();
        await module.deleteTask(id);
        return { status: true, msg: "AI message task deleted", data: null };
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        console.error("AI_MESSAGE_TASK_DELETE error:", msg);
        return { status: false, msg, data: null };
      }
    }
  );

  // List AI message tasks
  ipcMain.handle(
    AI_MESSAGE_TASK_LIST,
    async (
      _event,
      data: unknown
    ): Promise<
      CommonMessage<{
        items: unknown[];
        total: number;
      } | null>
    > => {
      if (!isAiEnabled()) {
        return {
          status: false,
          msg: "AI features are not enabled",
          data: null,
        };
      }
      try {
        const params = typeof data === "string" ? JSON.parse(data) : data;
        const page = (params as { page?: number })?.page ?? 1;
        const limit = (params as { limit?: number })?.limit ?? 50;
        const module = new AiMessageTaskModule();
        const result = await module.listTasks(page, limit);
        return {
          status: true,
          msg: "AI message tasks retrieved",
          data: result,
        };
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        console.error("AI_MESSAGE_TASK_LIST error:", msg);
        return { status: false, msg, data: null };
      }
    }
  );

  // Get AI message task detail
  ipcMain.handle(
    AI_MESSAGE_TASK_DETAIL,
    async (_event, data: unknown): Promise<CommonMessage<unknown>> => {
      if (!isAiEnabled()) {
        return {
          status: false,
          msg: "AI features are not enabled",
          data: null,
        };
      }
      try {
        const id =
          typeof data === "string" ? JSON.parse(data) : (data as number);
        const module = new AiMessageTaskModule();
        const task = await module.getTask(id);
        if (!task) {
          return {
            status: false,
            msg: "AI message task not found",
            data: null,
          };
        }
        return { status: true, msg: "Task retrieved", data: task };
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        console.error("AI_MESSAGE_TASK_DETAIL error:", msg);
        return { status: false, msg, data: null };
      }
    }
  );

  // List AI message task runs
  ipcMain.handle(
    AI_MESSAGE_TASK_RUN_LIST,
    async (
      _event,
      data: unknown
    ): Promise<
      CommonMessage<{
        items: unknown[];
        total: number;
      } | null>
    > => {
      if (!isAiEnabled()) {
        return {
          status: false,
          msg: "AI features are not enabled",
          data: null,
        };
      }
      try {
        const params = typeof data === "string" ? JSON.parse(data) : data;
        const taskId = (params as { taskId: number }).taskId;
        const page = (params as { page?: number })?.page ?? 1;
        const limit = (params as { limit?: number })?.limit ?? 20;
        const module = new AiMessageTaskRunModule();
        const result = await module.listRunsByTask(taskId, page, limit);
        return {
          status: true,
          msg: "Run history retrieved",
          data: result,
        };
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        console.error("AI_MESSAGE_TASK_RUN_LIST error:", msg);
        return { status: false, msg, data: null };
      }
    }
  );

  // Get AI message task run detail
  ipcMain.handle(
    AI_MESSAGE_TASK_RUN_DETAIL,
    async (_event, data: unknown): Promise<CommonMessage<unknown>> => {
      if (!isAiEnabled()) {
        return {
          status: false,
          msg: "AI features are not enabled",
          data: null,
        };
      }
      try {
        const id =
          typeof data === "string" ? JSON.parse(data) : (data as number);
        const module = new AiMessageTaskRunModule();
        const run = await module.getRun(id);
        if (!run) {
          return {
            status: false,
            msg: "AI message task run not found",
            data: null,
          };
        }
        return { status: true, msg: "Run retrieved", data: run };
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        console.error("AI_MESSAGE_TASK_RUN_DETAIL error:", msg);
        return { status: false, msg, data: null };
      }
    }
  );

  // List available built-in tools for AI message task
  ipcMain.handle(
    AI_MESSAGE_TASK_LIST_AVAILABLE_TOOLS,
    async (): Promise<CommonMessage<unknown[]>> => {
      if (!isAiEnabled()) {
        return {
          status: false,
          msg: "AI features are not enabled",
          data: [],
        };
      }
      try {
        const tools = listSchedulableBuiltInTools();
        return {
          status: true,
          msg: "Available tools retrieved",
          data: tools,
        };
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        console.error("AI_MESSAGE_TASK_LIST_AVAILABLE_TOOLS error:", msg);
        return { status: false, msg, data: [] };
      }
    }
  );
}
