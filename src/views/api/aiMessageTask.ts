import { windowInvoke } from "@/views/utils/apirequest";
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
  SchedulableAiToolSummary,
} from "@/entityTypes/aiMessageTaskTypes";

export async function createAiMessageTask(
  request: CreateAiMessageTaskRequest
): Promise<number> {
  return windowInvoke(AI_MESSAGE_TASK_CREATE, request);
}

export async function updateAiMessageTask(
  request: UpdateAiMessageTaskRequest
): Promise<void> {
  await windowInvoke(AI_MESSAGE_TASK_UPDATE, request);
}

export async function deleteAiMessageTask(id: number): Promise<void> {
  await windowInvoke(AI_MESSAGE_TASK_DELETE, id);
}

export async function listAiMessageTasks(
  page = 1,
  limit = 50
): Promise<{ items: unknown[]; total: number }> {
  return windowInvoke(AI_MESSAGE_TASK_LIST, { page, limit });
}

export async function getAiMessageTaskDetail(
  id: number
): Promise<unknown> {
  return windowInvoke(AI_MESSAGE_TASK_DETAIL, id);
}

export async function listAiMessageTaskRuns(
  taskId: number,
  page = 1,
  limit = 20
): Promise<{ items: unknown[]; total: number }> {
  return windowInvoke(AI_MESSAGE_TASK_RUN_LIST, { taskId, page, limit });
}

export async function getAiMessageTaskRunDetail(
  id: number
): Promise<unknown> {
  return windowInvoke(AI_MESSAGE_TASK_RUN_DETAIL, id);
}

export async function listAvailableAiMessageTaskTools(): Promise<
  SchedulableAiToolSummary[]
> {
  return windowInvoke(AI_MESSAGE_TASK_LIST_AVAILABLE_TOOLS);
}
