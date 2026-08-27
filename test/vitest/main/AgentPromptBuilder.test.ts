import { describe, it, expect } from "vitest";
import { AgentPromptBuilder } from "@/service/AgentPromptBuilder";
import type {
  AgentDefinitionView,
  AgentTaskPacket,
} from "@/entityTypes/agentTypes";

const baseDefinition = (
  overrides: Partial<AgentDefinitionView> = {}
): AgentDefinitionView => ({
  id: "agent-batch-worker",
  name: "Batch Worker",
  description: "test",
  version: 1,
  systemPrompt: "You are the Batch Worker.",
  allowedTools: ["attach_local_images"],
  mode: "specialist",
  maxToolCalls: 6,
  maxRuntimeMs: 240000,
  maxContinueCalls: 4,
  outputSchema: {
    type: "object",
    required: ["status"],
    properties: { status: { type: "string" } },
  },
  status: "active",
  source: "built-in",
  health: "healthy",
  manifest: {},
  ...overrides,
});

describe("AgentPromptBuilder", () => {
  it("forwards a generic batch-worker packet {files, instruction} into the user message", () => {
    const builder = new AgentPromptBuilder();
    const packet: AgentTaskPacket = {
      files: ["/ws/a.png", "/ws/b.png", "/ws/c.png"],
      instruction: "make the background white",
    };
    const { userMessageText } = builder.build({ definition: baseDefinition(), packet });
    const parsed = JSON.parse(userMessageText) as Record<string, unknown>;
    expect(parsed.files).toEqual(["/ws/a.png", "/ws/b.png", "/ws/c.png"]);
    expect(parsed.instruction).toBe("make the background white");
    // schema is still attached so the model sees the output contract
    expect(parsed.requiredOutputSchema).toBeDefined();
  });

  it("still forwards lead-researcher packets unchanged in shape", () => {
    const builder = new AgentPromptBuilder();
    const packet: AgentTaskPacket = {
      lead: { companyName: "Acme" },
      userGoal: "enrich",
      constraints: {},
      priorFindings: [],
      requiredOutputSchema: { type: "object" },
    };
    const { userMessageText } = builder.build({ definition: baseDefinition(), packet });
    const parsed = JSON.parse(userMessageText) as Record<string, unknown>;
    expect(parsed.lead).toEqual({ companyName: "Acme" });
    expect(parsed.userGoal).toBe("enrich");
  });

  it("injects the output schema reinforcement into the system message", () => {
    const builder = new AgentPromptBuilder();
    const { systemMessage } = builder.build({
      definition: baseDefinition(),
      packet: { files: ["/ws/a.png"], instruction: "x" },
    });
    expect(systemMessage.content).toContain("Output format (MANDATORY)");
    expect(systemMessage.content).toContain("NO markdown fences");
  });

  // Task 16: trusted initialImageArtifacts turn the user message into
  // multimodal content parts — packet JSON text first, then one image_url
  // part per artifact with the exact dataUrl and detail preserved.
  it("emits multimodal content parts when initialImageArtifacts are present", () => {
    const builder = new AgentPromptBuilder();
    const artifact = {
      sourceId: "msg-1:0",
      fileName: "generated.png",
      mimeType: "image/png" as const,
      dataUrl: "data:image/png;base64,YXJ0aWZhY3Q=",
      detail: "high" as const,
    };
    const { userMessage, userMessageText } = builder.build({
      definition: baseDefinition(),
      packet: { files: [], instruction: "brighten" },
      initialImageArtifacts: [artifact],
    });

    expect(Array.isArray(userMessage.content)).toBe(true);
    const parts = userMessage.content as Array<Record<string, unknown>>;
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({
      type: "text",
      text: userMessageText,
    });
    expect(JSON.parse(userMessageText)).toMatchObject({
      instruction: "brighten",
    });
    expect(parts[1]).toEqual({
      type: "image_url",
      image_url: { url: artifact.dataUrl, detail: "high" },
    });
  });
});
