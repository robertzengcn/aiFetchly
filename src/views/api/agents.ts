import { windowInvoke } from "@/views/utils/apirequest";
import {
  AGENT_MANAGEMENT_LIST,
  AGENT_MANAGEMENT_GET,
  AGENT_MANAGEMENT_CREATE,
  AGENT_MANAGEMENT_UPDATE,
  AGENT_MANAGEMENT_TOGGLE,
  AGENT_MANAGEMENT_DELETE,
} from "@/config/channellist";
import type {
  AgentDefinitionView,
  AgentDefinitionSource,
  AgentDefinitionHealth,
  AgentMode,
  CreateManualAgentDefinitionInput,
  UpdateManualAgentDefinitionInput,
} from "@/entityTypes/agentTypes";

export type {
  AgentDefinitionView,
  AgentDefinitionSource,
  AgentDefinitionHealth,
  AgentMode,
  CreateManualAgentDefinitionInput,
  UpdateManualAgentDefinitionInput,
};

export async function listAgentDefinitions(): Promise<
  AgentDefinitionView[] | null
> {
  return await windowInvoke(AGENT_MANAGEMENT_LIST);
}

export async function getAgentDefinition(
  agentId: string
): Promise<AgentDefinitionView | null> {
  return await windowInvoke(AGENT_MANAGEMENT_GET, { agentId });
}

export async function createAgentDefinition(
  input: CreateManualAgentDefinitionInput
): Promise<AgentDefinitionView | null> {
  return await windowInvoke(AGENT_MANAGEMENT_CREATE, input);
}

export async function updateAgentDefinition(
  agentId: string,
  input: UpdateManualAgentDefinitionInput
): Promise<AgentDefinitionView | null> {
  return await windowInvoke(AGENT_MANAGEMENT_UPDATE, { agentId, ...input });
}

export async function toggleAgentDefinition(
  agentId: string,
  enabled: boolean
): Promise<void> {
  await windowInvoke(AGENT_MANAGEMENT_TOGGLE, { agentId, enabled });
}

export async function deleteAgentDefinition(agentId: string): Promise<void> {
  await windowInvoke(AGENT_MANAGEMENT_DELETE, { agentId });
}
