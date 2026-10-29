// src/service/AgentPromptBuilder.ts
import type {
  OpenAIChatMessage,
  OpenAIImageUrlContentPart,
  OpenAIMessageContent,
} from "@/api/aiChatApi";
import type {
  AgentDefinitionView,
  AgentInitialImageArtifact,
  AgentTaskPacket,
} from "@/entityTypes/agentTypes";

export interface BuildPromptInput {
  definition: AgentDefinitionView;
  packet: AgentTaskPacket;
  /** Runtime-only transient images (AgentRuntime strips them everywhere
   * else). When non-empty, the user message becomes multimodal content
   * parts: the packet JSON text part followed by one image_url part per
   * artifact. The worker receives exactly one image per request. */
  initialImageArtifacts?: readonly AgentInitialImageArtifact[];
}

export type AgentSystemMessage = OpenAIChatMessage & {
  role: "system";
  content: string;
};

export type AgentUserMessage = OpenAIChatMessage & {
  role: "user";
  content: OpenAIMessageContent;
};

export interface BuiltPrompt {
  messages: OpenAIChatMessage[];
  systemMessage: AgentSystemMessage;
  userMessage: AgentUserMessage;
  /** Plain-text projection of userMessage for transcripts/persistence —
   * image parts are excluded so artifact bytes never reach storage. */
  userMessageText: string;
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

    const systemMessage: AgentSystemMessage = {
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
    const packetJson = JSON.stringify(
      { ...input.packet, requiredOutputSchema: schema },
      null,
      2
    );
    const artifacts = input.initialImageArtifacts ?? [];
    const content: OpenAIMessageContent =
      artifacts.length === 0
        ? packetJson
        : [
            { type: "text", text: packetJson },
            ...artifacts.map(
              (artifact): OpenAIImageUrlContentPart => ({
                type: "image_url",
                image_url: { url: artifact.dataUrl, detail: artifact.detail },
              })
            ),
          ];
    const userMessage: AgentUserMessage = { role: "user", content };
    return {
      messages: [systemMessage, userMessage],
      systemMessage,
      userMessage,
      userMessageText: packetJson,
    };
  }
}
