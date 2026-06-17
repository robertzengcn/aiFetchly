import { describe, expect, it, vi } from "vitest";
import type { AgentDefinitionView } from "@/entityTypes/agentTypes";

const definition: AgentDefinitionView = {
  id: "agent-test",
  name: "Test Agent",
  description: "Test",
  version: 1,
  systemPrompt: "You are a test agent.",
  allowedTools: ["lookup"],
  mode: "specialist",
  maxToolCalls: 1,
  maxRuntimeMs: 1000,
  maxContinueCalls: 4,
  outputSchema: { required: ["summary"] },
  status: "active",
};

vi.mock("@/modules/AgentDefinitionModule", () => ({
  AgentDefinitionModule: class {
    async getActiveById() {
      return definition;
    }
  },
}));

vi.mock("@/modules/AgentTaskModule", () => ({
  AgentTaskModule: class {
    toolCallsCount = 0;
    async createTask() {
      return undefined;
    }
    async appendMessage() {
      return undefined;
    }
    async setStatus() {
      return undefined;
    }
    async saveResult() {
      return undefined;
    }
    async incrementToolCalls() {
      this.toolCallsCount += 1;
    }
    async getSnapshot() {
      return { toolCallsCount: this.toolCallsCount };
    }
    async saveToolCall() {
      return undefined;
    }
  },
}));

vi.mock("@/config/skillsRegistry", () => ({
  SkillRegistry: {
    getAllToolFunctions: vi.fn(async () => [
      {
        type: "function",
        name: "lookup",
        description: "Lookup",
        parameters: { type: "object" },
      },
    ]),
    getSkill: vi.fn(() => ({
      name: "lookup",
      description: "Lookup",
      parameters: { type: "object" },
      permissionCategory: "pure",
    })),
  },
}));

vi.mock("@/service/SkillExecutor", () => ({
  SkillExecutor: {
    execute: vi.fn(),
  },
}));

vi.mock("@/api/aiChatApi", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/api/aiChatApi")>();
  return {
    ...original,
    AiChatApi: class {
      openAIChatCompletionStream() {
        return Promise.resolve();
      }
    },
  };
});

vi.mock("@/service/AIChatQueryLoop", () => ({
  AIChatQueryLoop: class {
    constructor(private readonly deps: { executeTool: Function }) {}
    async run() {
      await this.deps.executeTool("lookup", { q: "one" }, {
        toolCallId: "call-1",
      });
      await this.deps.executeTool("lookup", { q: "two" }, {
        toolCallId: "call-2",
      });
      return {
        type: "completed",
        fullContent: JSON.stringify({ summary: "ok" }),
      };
    }
  },
}));

import { AgentRuntime } from "@/service/AgentRuntime";

describe("AgentRuntime", () => {
  it("fails when an agent exceeds its max tool calls", async () => {
    const runtime = new AgentRuntime();
    const result = await runtime.runSync(
      {
        agentId: "agent-test",
        prompt: "research",
        executionMode: "foreground",
        taskPacket: {
          lead: { companyName: "Acme" },
          userGoal: "research acme",
          constraints: {},
          priorFindings: [],
          requiredOutputSchema: { type: "object" },
        },
      },
      {
        executeTool: vi.fn(async (name, _args, ctx) => ({
          tool_call_id: ctx.toolCallId,
          tool_name: name,
          success: true,
          result: { summary: "ok" },
          execution_time_ms: 1,
        })),
      }
    );

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("exceeded max tool calls");
  });
});
