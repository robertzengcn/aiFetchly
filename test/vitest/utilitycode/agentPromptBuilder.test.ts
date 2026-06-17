// test/vitest/utilitycode/agentPromptBuilder.test.ts
import { describe, it, expect } from "vitest";
import { AgentPromptBuilder } from "@/service/AgentPromptBuilder";
import type {
  AgentDefinitionView,
  AgentTaskPacket,
} from "@/entityTypes/agentTypes";

const DEF: AgentDefinitionView = {
  id: "agent-lead-researcher",
  name: "Lead Researcher",
  description: "",
  version: 1,
  systemPrompt: "You are the lead researcher.",
  allowedTools: [],
  mode: "specialist",
  maxToolCalls: 8,
  maxRuntimeMs: 180000,
  maxContinueCalls: 8,
  outputSchema: { type: "object", properties: { x: { type: "string" } } },
  status: "active",
};

const PACKET: AgentTaskPacket = {
  lead: { companyName: "Acme", website: "https://acme.com" },
  userGoal: "prepare outreach",
  constraints: { requireSourceUrls: true },
  priorFindings: [],
  requiredOutputSchema: { type: "object" },
};

describe("AgentPromptBuilder", () => {
  it("builds a system message from the definition prompt", () => {
    const builder = new AgentPromptBuilder();
    const { systemMessage } = builder.build({
      definition: DEF,
      packet: PACKET,
    });
    expect(systemMessage.role).toBe("system");
    expect(systemMessage.content).toContain("lead researcher");
  });

  it("builds a user message containing the task packet as JSON", () => {
    const builder = new AgentPromptBuilder();
    const { userMessage } = builder.build({
      definition: DEF,
      packet: PACKET,
    });
    expect(userMessage.role).toBe("user");
    const parsed = JSON.parse(userMessage.content);
    expect(parsed.lead.companyName).toBe("Acme");
    expect(parsed.userGoal).toBe("prepare outreach");
  });

  it("injects the required output schema into the user message", () => {
    const builder = new AgentPromptBuilder();
    const { userMessage } = builder.build({
      definition: DEF,
      packet: PACKET,
    });
    expect(userMessage.content).toContain("requiredOutputSchema");
  });

  it("does not include parent chat history", () => {
    const builder = new AgentPromptBuilder();
    const { messages } = builder.build({ definition: DEF, packet: PACKET });
    expect(messages.length).toBe(2);
  });
});
