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
    // Inject the output schema inline into the system message. Models comply
    // much more reliably when the schema is in the system prompt (not just
    // the user message body), especially in failure modes where they would
    // otherwise drift to prose summaries. The explicit "raw JSON, no markdown"
    // reinforcement and the partial-findings escape hatch prevent the agent
    // from writing a narrative conclusion when it cannot complete the task.
    const schema =
      input.packet.requiredOutputSchema ?? input.definition.outputSchema;
    const schemaJson = JSON.stringify(schema, null, 2);
    const schemaReinforcement = [
      "",
      "",
      "## Output format (MANDATORY)",
      "Respond with a SINGLE raw JSON object. Rules:",
      "1. NO markdown fences (no ```json blocks).",
      "2. NO prose, headings, or commentary before or after the JSON.",
      "3. The JSON object MUST satisfy this JSON schema:",
      schemaJson,
      "4. If you cannot gather enough evidence to fill a required field,",
      "   still return a JSON object — put the explanation inside",
      "   `businessSummary`, set `sourceUrls` to an empty array, and set",
      "   `confidence` to 0. NEVER respond with prose instead of JSON.",
    ].join("\n");

    const systemMessage: AgentPromptMessage = {
      role: "system",
      content: input.definition.systemPrompt + schemaReinforcement,
    };
    // Forward the FULL task packet so any agent family — lead-researcher
    // ({lead,userGoal,constraints,...}) or batch-worker ({files,instruction})
    // — receives its packet verbatim. The packet is the entire context the
    // agent sees (no parent chat history). JSON.stringify drops undefined-
    // valued keys, so the message stays clean. The resolved output schema is
    // attached explicitly so the model always sees the output contract
    // regardless of whether the packet carried requiredOutputSchema.
    const userMessage: AgentPromptMessage = {
      role: "user",
      content: JSON.stringify(
        { ...input.packet, requiredOutputSchema: schema },
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
