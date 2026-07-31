import { describe, expect, it } from "vitest";
import { AgentPromptBuilder } from "@/service/AgentPromptBuilder";
import type {
  AgentDefinitionView,
  AgentTaskPacket,
} from "@/entityTypes/agentTypes";

const baseDefinition: AgentDefinitionView = {
  id: "agent-lead-researcher",
  name: "Lead Researcher",
  description: "test",
  version: 1,
  systemPrompt: "You are the Lead Researcher specialist.",
  allowedTools: [],
  mode: "specialist",
  maxToolCalls: 4,
  maxRuntimeMs: 60000,
  maxContinueCalls: 4,
  outputSchema: {
    type: "object",
    required: ["businessSummary", "sourceUrls", "confidence"],
    properties: {
      businessSummary: { type: "string" },
      sourceUrls: { type: "array", items: { type: "string" } },
      confidence: { type: "number" },
    },
  },
  status: "active",
  source: "built-in",
  health: "healthy",
  manifest: {},
};

const basePacket: AgentTaskPacket = {
  lead: { companyName: "Acme Corp", website: "https://acme.io" },
  userGoal: "Research Acme Corp",
  constraints: {},
  priorFindings: [],
  requiredOutputSchema: baseDefinition.outputSchema,
};

describe("AgentPromptBuilder", () => {
  it("injects the output schema inline into the system message", () => {
    const builder = new AgentPromptBuilder();
    const { systemMessage } = builder.build({
      definition: baseDefinition,
      packet: basePacket,
    });
    // Schema content appears in the system message
    expect(systemMessage.content).toMatch(/businessSummary/);
    expect(systemMessage.content).toMatch(/sourceUrls/);
    expect(systemMessage.content).toMatch(/confidence/);
    expect(systemMessage.content).toMatch(/"type":\s*"object"/);
  });

  it("reinforces raw JSON, no markdown fences, no prose", () => {
    const builder = new AgentPromptBuilder();
    const { systemMessage } = builder.build({
      definition: baseDefinition,
      packet: basePacket,
    });
    expect(systemMessage.content).toMatch(/raw JSON object/i);
    expect(systemMessage.content).toMatch(/NO markdown fences/);
    expect(systemMessage.content).toMatch(/NO prose/i);
  });

  it("tells the agent how to handle the cannot-complete case without prose", () => {
    const builder = new AgentPromptBuilder();
    const { systemMessage } = builder.build({
      definition: baseDefinition,
      packet: basePacket,
    });
    expect(systemMessage.content).toMatch(/confidence.*0/i);
    expect(systemMessage.content).toMatch(/businessSummary/);
    expect(systemMessage.content).toMatch(/NEVER respond with prose/i);
  });

  it("preserves the agent's base system prompt", () => {
    const builder = new AgentPromptBuilder();
    const { systemMessage } = builder.build({
      definition: baseDefinition,
      packet: basePacket,
    });
    expect(systemMessage.content.startsWith(baseDefinition.systemPrompt)).toBe(
      true
    );
  });

  it("prefers packet.requiredOutputSchema over the definition default", () => {
    const builder = new AgentPromptBuilder();
    const narrower = {
      type: "object",
      required: ["customField"],
      properties: { customField: { type: "string" } },
    };
    const { systemMessage, userMessage } = builder.build({
      definition: baseDefinition,
      packet: { ...basePacket, requiredOutputSchema: narrower },
    });
    expect(systemMessage.content).toMatch(/customField/);
    // User message also carries the narrower schema
    expect(userMessage.content).toMatch(/customField/);
  });
});
