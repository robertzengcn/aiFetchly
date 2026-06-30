import { describe, expect, it, vi } from "vitest";

// Mock heavy dependencies to prevent import cascade (AgentRuntime → skillsRegistry → DB)
vi.mock("@/service/AgentRuntimeRegistry", () => ({
  AgentRuntimeRegistry: { getRuntime: vi.fn() },
  getDefaultAgentRuntimeDeps: vi.fn(),
}));

vi.mock("@/entityTypes/agentTypes", () => ({}));

import { RUN_SUBAGENT_TOOL } from "@/service/agentTools/runSubagentTool";

describe("run_subagent tool definition", () => {
  const params = RUN_SUBAGENT_TOOL.parameters as Record<string, unknown>;
  const props = params.properties as Record<string, unknown>;

  it("requires agentId, prompt, and taskPacket", () => {
    const required = params.required as string[];
    expect(required).toContain("agentId");
    expect(required).toContain("prompt");
    expect(required).toContain("taskPacket");
  });

  it("has taskPacket with explicit sub-properties to guide the model", () => {
    const taskPacket = props.taskPacket as Record<string, unknown>;
    expect(taskPacket).toBeDefined();
    expect(taskPacket.type).toBe("object");

    const taskPacketProps = taskPacket.properties as Record<string, unknown>;
    expect(taskPacketProps).toBeDefined();
    expect(taskPacketProps).toHaveProperty("lead");
    expect(taskPacketProps).toHaveProperty("userGoal");
    expect(taskPacketProps).toHaveProperty("constraints");
    expect(taskPacketProps).toHaveProperty("priorFindings");
    expect(taskPacketProps).toHaveProperty("requiredOutputSchema");
  });

  it("taskPacket.lead description discourages inlining full contact lists", () => {
    const taskPacket = props.taskPacket as Record<string, unknown>;
    const taskPacketProps = taskPacket.properties as Record<string, unknown>;
    const lead = taskPacketProps.lead as Record<string, unknown>;

    expect(lead.description).toContain("companyName + website only");
    expect(lead.description).toContain("look up full details");

    // Ensure lead has defined sub-properties so the model knows what's expected
    const leadProps = lead.properties as Record<string, unknown>;
    expect(leadProps).toHaveProperty("companyName");
    expect(leadProps).toHaveProperty("website");
  });

  it("taskPacket description tells the model to keep it compact", () => {
    const taskPacket = props.taskPacket as Record<string, unknown>;
    expect(taskPacket.description).toMatch(/KEEP THIS COMPACT/i);
    expect(taskPacket.description).toMatch(/do NOT inline/i);
    expect(taskPacket.description).toMatch(/research and enrich/i);
  });

  it("prompt description encourages brevity", () => {
    const prompt = props.prompt as Record<string, unknown>;
    expect(prompt.description).toMatch(/concise/i);
    expect(prompt.description).toMatch(/1-2 sentences/i);
  });

  it("exposes the async contract so models know to poll", () => {
    expect(RUN_SUBAGENT_TOOL.async).toBe(true);
    expect(RUN_SUBAGENT_TOOL.description).toMatch(/ASYNCHRONOUSLY/i);
    expect(RUN_SUBAGENT_TOOL.description).toMatch(/check_tool_job_status/i);
  });

  it("routes unconditionally to async timeout class", () => {
    expect(RUN_SUBAGENT_TOOL.resolveTimeoutClass).toBeDefined();
    expect(RUN_SUBAGENT_TOOL.resolveTimeoutClass!({})).toBe("async");
    expect(
      RUN_SUBAGENT_TOOL.resolveTimeoutClass!({
        agentId: "agent-lead-researcher",
        prompt: "test",
        taskPacket: { lead: { companyName: "X" } },
      })
    ).toBe("async");
  });
});
