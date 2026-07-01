// src/main-process/communication/agent-runtime-ipc.ts
import { ipcMain } from "electron";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import { AgentDefinitionModule } from "@/modules/AgentDefinitionModule";
import { AgentTaskModule } from "@/modules/AgentTaskModule";
import {
  AGENT_DEFINITION_LIST,
  AGENT_TASK_DETAIL,
  AGENT_TASK_TRANSCRIPT,
  AGENT_TASK_LIST,
  AGENT_RESUME_TOOL_AFTER_PERMISSION,
} from "@/config/channellist";
import type { CommonMessage } from "@/entityTypes/commonType";

function isAIEnabled(): boolean {
  const tokenService = new Token();
  return tokenService.getValue(USER_AI_ENABLED) === "true";
}

function denied<T>(msg: string): CommonMessage<T> {
  return { status: false, msg, data: undefined };
}

function ok<T>(data: T): CommonMessage<T> {
  return { status: true, msg: "", data };
}

async function handleDefinitionList(): Promise<
  CommonMessage<unknown[] | null>
> {
  if (!isAIEnabled()) return denied("AI is not enabled");
  try {
    const module = new AgentDefinitionModule();
    return ok(await module.listActive());
  } catch (err) {
    return denied(err instanceof Error ? err.message : String(err));
  }
}

async function handleTaskDetail(
  data: string
): Promise<CommonMessage<unknown | null>> {
  if (!isAIEnabled()) return denied("AI is not enabled");
  try {
    const req = JSON.parse(data ?? "{}");
    if (typeof req.agentTaskId !== "string") {
      return denied("agentTaskId is required");
    }
    const module = new AgentTaskModule();
    const snapshot = await module.getSnapshot(req.agentTaskId);
    return ok(snapshot);
  } catch (err) {
    return denied(err instanceof Error ? err.message : String(err));
  }
}

async function handleTaskTranscript(
  data: string
): Promise<CommonMessage<unknown | null>> {
  if (!isAIEnabled()) return denied("AI is not enabled");
  try {
    const req = JSON.parse(data ?? "{}");
    if (typeof req.agentTaskId !== "string") {
      return denied("agentTaskId is required");
    }
    const module = new AgentTaskModule();
    const messages = await module.listMessages(req.agentTaskId);
    const toolCalls = await module.listToolCalls(req.agentTaskId);
    return ok({ messages, toolCalls });
  } catch (err) {
    return denied(err instanceof Error ? err.message : String(err));
  }
}

async function handleTaskList(
  data: string
): Promise<CommonMessage<unknown[] | null>> {
  if (!isAIEnabled()) return denied("AI is not enabled");
  try {
    const req = JSON.parse(data ?? "{}");
    const limit = typeof req.limit === "number" ? req.limit : 50;
    const statusFilter: string | undefined =
      typeof req.status === "string" && req.status.length > 0
        ? req.status
        : undefined;
    const module = new AgentTaskModule();
    const tasks = await module.listRecent(limit, statusFilter as any);
    return ok(tasks);
  } catch (err) {
    return denied(err instanceof Error ? err.message : String(err));
  }
}

async function handleResumeToolAfterPermission(
  _data: string
): Promise<CommonMessage<{ ok: boolean; error?: string } | null>> {
  if (!isAIEnabled()) return denied("AI is not enabled");
  // v1 foreground specialist runs do not wire interactive permission resume;
  // return a clear message so the renderer can surface it.
  return ok({
    ok: false,
    error:
      "Interactive permission resume is not supported for agent tasks in v1.",
  });
}

export function registerAgentRuntimeIpcHandlers(): void {
  ipcMain.handle(AGENT_DEFINITION_LIST, async () => handleDefinitionList());
  ipcMain.handle(AGENT_TASK_DETAIL, async (_e, data: unknown) =>
    handleTaskDetail((data as string) ?? "")
  );
  ipcMain.handle(AGENT_TASK_TRANSCRIPT, async (_e, data: unknown) =>
    handleTaskTranscript((data as string) ?? "")
  );
  ipcMain.handle(AGENT_TASK_LIST, async (_e, data: unknown) =>
    handleTaskList((data as string) ?? "")
  );
  ipcMain.handle(
    AGENT_RESUME_TOOL_AFTER_PERMISSION,
    async (_e, data: unknown) =>
      handleResumeToolAfterPermission((data as string) ?? "")
  );
}
