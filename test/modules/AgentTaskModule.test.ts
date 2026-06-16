// test/modules/AgentTaskModule.test.ts
import { describe, it, expect, before } from "mocha";
import { AgentTaskModule } from "@/modules/AgentTaskModule";
import type { AgentTaskPacket, AgentResult } from "@/entityTypes/agentTypes";

const PACKET: AgentTaskPacket = {
  lead: { companyName: "Acme" },
  userGoal: "research acme",
  constraints: {},
  priorFindings: [],
  requiredOutputSchema: { type: "object" },
};

describe("AgentTaskModule", () => {
  let m: AgentTaskModule;

  before(() => {
    m = new AgentTaskModule();
  });

  it("creates a task in queued status and reads it back", async () => {
    const id = "agt-test-create";
    await m.createTask({
      agentTaskId: id,
      agentConversationId: "agent-v2-create",
      agentId: "agent-lead-researcher",
      agentVersion: 1,
      prompt: "research",
      taskPacket: PACKET,
    });
    const snap = await m.getSnapshot(id);
    expect(snap).to.not.be.null;
    expect(snap!.status).to.equal("queued");
    expect(snap!.agentId).to.equal("agent-lead-researcher");
  });

  it("transitions status and saves result", async () => {
    const id = "agt-test-result";
    await m.createTask({
      agentTaskId: id,
      agentConversationId: "agent-v2-result",
      agentId: "agent-lead-researcher",
      agentVersion: 1,
      prompt: "research",
      taskPacket: PACKET,
    });
    await m.setStatus(id, "running", { startedAt: new Date() });
    // toolCallsCount is owned by incrementToolCalls, not saveResult.
    await m.incrementToolCalls(id);
    await m.incrementToolCalls(id);
    const result: AgentResult = {
      agentTaskId: id,
      agentId: "agent-lead-researcher",
      agentVersion: 1,
      status: "completed",
      output: { businessSummary: "ok" },
      toolCallsCount: 2,
      sourceUrls: ["https://example.com"],
      confidence: 0.8,
    };
    await m.saveResult(id, result);
    await m.setStatus(id, "completed", { finishedAt: new Date() });
    const snap = await m.getSnapshot(id);
    expect(snap!.status).to.equal("completed");
    expect(snap!.result!.status).to.equal("completed");
    // saveResult must not clobber the count incremented above.
    expect(snap!.toolCallsCount).to.equal(2);
  });

  it("appends transcript messages and lists them in order", async () => {
    const id = "agt-test-msg";
    await m.createTask({
      agentTaskId: id,
      agentConversationId: "agent-v2-msg",
      agentId: "agent-lead-researcher",
      agentVersion: 1,
      prompt: "research",
      taskPacket: PACKET,
    });
    await m.appendMessage({ agentTaskId: id, role: "system", content: "sys" });
    await m.appendMessage({
      agentTaskId: id,
      role: "assistant",
      content: "hello",
    });
    const msgs = await m.listMessages(id);
    expect(msgs.length).to.equal(2);
    expect(msgs[0].role).to.equal("system");
    expect(msgs[1].content).to.equal("hello");
  });

  it("persists tool-call audit rows with sanitized args", async () => {
    const id = "agt-test-tool";
    await m.createTask({
      agentTaskId: id,
      agentConversationId: "agent-v2-tool",
      agentId: "agent-lead-researcher",
      agentVersion: 1,
      prompt: "research",
      taskPacket: PACKET,
    });
    await m.saveToolCall({
      agentTaskId: id,
      toolCallId: "call-1",
      toolName: "google_search",
      argumentsSummary: { q: "acme", password: "shh" },
      status: "completed",
      resultSummary: "3 results",
      durationMs: 120,
    });
    const calls = await m.listToolCalls(id);
    expect(calls.length).to.equal(1);
    expect(calls[0].toolName).to.equal("google_search");
    expect(
      (calls[0].argumentsSummary as Record<string, unknown>).password
    ).to.equal("[redacted]");
  });
});
