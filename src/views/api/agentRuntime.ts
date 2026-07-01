// src/views/api/agentRuntime.ts
import { windowInvoke } from "@/views/utils/apirequest";
import {
  AGENT_DEFINITION_LIST,
  AGENT_TASK_DETAIL,
  AGENT_TASK_TRANSCRIPT,
  AGENT_TASK_LIST,
} from "@/config/channellist";
import type {
  AgentDefinitionView,
  AgentTaskSnapshot,
  AgentTaskMessageRecord,
  AgentToolCallRecord,
} from "@/entityTypes/agentTypes";

export async function listAgentDefinitions(): Promise<
  AgentDefinitionView[]
> {
  const resp = await windowInvoke(AGENT_DEFINITION_LIST);
  return (resp as AgentDefinitionView[]) ?? [];
}

export async function getAgentTaskDetail(
  agentTaskId: string
): Promise<AgentTaskSnapshot | null> {
  const resp = await windowInvoke(AGENT_TASK_DETAIL, { agentTaskId });
  return (resp as AgentTaskSnapshot | null) ?? null;
}

export async function listAgentTasks(
  limit?: number,
  status?: string
): Promise<AgentTaskSnapshot[]> {
  const resp = await windowInvoke(AGENT_TASK_LIST, { limit, status });
  return (resp as AgentTaskSnapshot[]) ?? [];
}

export async function getAgentTaskTranscript(
  agentTaskId: string
): Promise<{
  messages: AgentTaskMessageRecord[];
  toolCalls: AgentToolCallRecord[];
} | null> {
  const resp = await windowInvoke(AGENT_TASK_TRANSCRIPT, { agentTaskId });
  return resp as {
    messages: AgentTaskMessageRecord[];
    toolCalls: AgentToolCallRecord[];
  } | null;
}
