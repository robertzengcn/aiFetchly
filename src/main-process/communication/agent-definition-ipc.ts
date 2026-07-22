// src/main-process/communication/agent-definition-ipc.ts
import { AgentDefinitionModule } from "@/modules/AgentDefinitionModule";
import {
  AGENT_MANAGEMENT_LIST,
  AGENT_MANAGEMENT_GET,
  AGENT_MANAGEMENT_CREATE,
  AGENT_MANAGEMENT_UPDATE,
  AGENT_MANAGEMENT_TOGGLE,
  AGENT_MANAGEMENT_DELETE,
} from "@/config/channellist";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  agentDefinitionListInputSchema,
  agentDefinitionByIdInputSchema,
  agentDefinitionCreateInputSchema,
  agentDefinitionUpdateInputSchema,
  agentDefinitionToggleInputSchema,
  agentDefinitionDeleteInputSchema,
} from "@/schemas/ipc/agentDefinition";

/**
 * Management-only agent definition IPC. NOT AI-gated (design §15.5): these
 * handlers do not execute agents or call AI APIs — they only read/write
 * definitions. Runtime listing stays AI-gated in agent-runtime-ipc.ts.
 */
export function registerAgentDefinitionIpcHandlers(): void {
  registerValidatedHandler(
    AGENT_MANAGEMENT_LIST,
    agentDefinitionListInputSchema,
    async () => new AgentDefinitionModule().listAllForManagement()
  );

  registerValidatedHandler(
    AGENT_MANAGEMENT_GET,
    agentDefinitionByIdInputSchema,
    async (input) => new AgentDefinitionModule().getForManagement(input.agentId)
  );

  registerValidatedHandler(
    AGENT_MANAGEMENT_CREATE,
    agentDefinitionCreateInputSchema,
    async (input) => new AgentDefinitionModule().createManualAgent(input)
  );

  registerValidatedHandler(
    AGENT_MANAGEMENT_UPDATE,
    agentDefinitionUpdateInputSchema,
    async (input) => {
      const { agentId, ...patch } = input;
      return new AgentDefinitionModule().updateManualAgent(agentId, patch);
    }
  );

  registerValidatedHandler(
    AGENT_MANAGEMENT_TOGGLE,
    agentDefinitionToggleInputSchema,
    async (input) =>
      new AgentDefinitionModule().toggleAgent(input.agentId, input.enabled)
  );

  registerValidatedHandler(
    AGENT_MANAGEMENT_DELETE,
    agentDefinitionDeleteInputSchema,
    async (input) =>
      new AgentDefinitionModule().deleteManualAgent(input.agentId)
  );
}
