// src/service/AgentPromptBuilder.ts
import type { OpenAIChatMessage } from "@/api/aiChatApi";
import type {
  AgentDefinitionView,
  AgentTaskPacket,
} from "@/entityTypes/agentTypes";

export interface BuildPromptInput {
  definition: AgentDefinitionView;
  packet: AgentTaskPacket;
}

export type AgentPromptMessage = OpenAIChatMessage & { content: string };

export interface BuiltPrompt {
  messages: OpenAIChatMessage[];
  systemMessage: AgentPromptMessage;
  userMessage: AgentPromptMessage;
}

export class AgentPromptBuilder {
  build(input: BuildPromptInput): BuiltPrompt {
    const systemMessage: AgentPromptMessage = {
      role: "system",
      content: input.definition.systemPrompt,
    };
    // The packet is the entire context the agent sees — no parent chat history.
    const userMessage: AgentPromptMessage = {
      role: "user",
      content: JSON.stringify(
        {
          lead: input.packet.lead,
          userGoal: input.packet.userGoal,
          constraints: input.packet.constraints,
          priorFindings: input.packet.priorFindings,
          requiredOutputSchema:
            input.packet.requiredOutputSchema ?? input.definition.outputSchema,
        },
        null,
        2
      ),
    };
    return {
      messages: [systemMessage, userMessage],
      systemMessage,
      userMessage,
    };
  }
}
