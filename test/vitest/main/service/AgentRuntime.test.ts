import { beforeEach, describe, expect, it, vi } from "vitest";
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

// Phase 16 / Plan 03 — registry-first resolution with DB fallback.
// Both lookups are controllable per-test. Defaults preserve the original
// "agent-test" DB-fallback behavior so the pre-existing test stays GREEN.
const mockRegistryGetById = vi.fn((): AgentDefinitionView | null => null);
const mockDefGetActiveById = vi.fn(
  async (id: string): Promise<AgentDefinitionView | null> => {
    // Bare built-in / legacy DB path: only resolve the seeded test id.
    return id === "agent-test" ? definition : null;
  }
);

vi.mock("@/service/aifetchlyConfig/AIFetchlyConfigManager", () => ({
  getAIFetchlyConfigManager: () => ({
    getAgentRegistry: () => ({ getById: mockRegistryGetById }),
  }),
}));

vi.mock("@/modules/AgentDefinitionModule", () => ({
  AgentDefinitionModule: class {
    getActiveById = mockDefGetActiveById;
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
    constructor(
      private readonly deps: {
        executeTool: (
          name: string,
          args: unknown,
          ctx: { toolCallId: string }
        ) => Promise<unknown>;
      }
    ) {}
    async run() {
      await this.deps.executeTool(
        "lookup",
        { q: "one" },
        {
          toolCallId: "call-1",
        }
      );
      await this.deps.executeTool(
        "lookup",
        { q: "two" },
        {
          toolCallId: "call-2",
        }
      );
      return {
        type: "completed",
        fullContent: JSON.stringify({ summary: "ok" }),
      };
    }
  },
}));

import { AgentRuntime } from "@/service/AgentRuntime";

const dynamicDefinition: AgentDefinitionView = {
  id: "user:agent:lead-researcher",
  name: "Lead Researcher",
  description: "dynamic",
  version: 1,
  systemPrompt: "You are a lead researcher.",
  allowedTools: ["lookup"],
  mode: "specialist",
  maxToolCalls: 8,
  maxRuntimeMs: 1000,
  maxContinueCalls: 8,
  outputSchema: { required: ["summary"] },
  status: "active",
};

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

// Phase 16 / Plan 03 — Task 1: registry-first resolution with DB fallback.
// The dispatch path at AgentRuntime.runSync resolves the agent id REGISTRY-FIRST
// (in-memory, precedence-aware, scoped dynamic IDs) and only falls back to the
// existing DB lookup when the registry misses. (AGT-03, D-AgentIDs.)
describe("AgentRuntime dispatch resolution (Phase 16 / Plan 03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Defaults: registry empty, DB resolves only "agent-test".
    mockRegistryGetById.mockReturnValue(null);
  });

  it("resolves a dynamic scoped id via the registry REGISTRY-FIRST (DB not consulted)", async () => {
    mockRegistryGetById.mockReturnValue(dynamicDefinition);
    const runtime = new AgentRuntime();
    const result = await runtime.runSync({
      agentId: "user:agent:lead-researcher",
      prompt: "research",
      executionMode: "foreground",
      taskPacket: {
        lead: { companyName: "Acme" },
        userGoal: "research acme",
        constraints: {},
        priorFindings: [],
        requiredOutputSchema: { type: "object" },
      },
    });

    // Registry resolved it; the DB fallback was never consulted.
    expect(mockRegistryGetById).toHaveBeenCalledWith(
      "user:agent:lead-researcher"
    );
    expect(mockDefGetActiveById).not.toHaveBeenCalled();
    // Dispatch proceeded with the registry-provided definition.
    expect(result.agentId).toBe("user:agent:lead-researcher");
  });

  it("falls back to the DB when the registry misses (legacy / built-in path)", async () => {
    // Registry misses; DB mock resolves agent-test (seeded above).
    const runtime = new AgentRuntime();
    const result = await runtime.runSync({
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
    });

    // Registry was consulted first, then DB fallback.
    expect(mockRegistryGetById).toHaveBeenCalledWith("agent-test");
    expect(mockDefGetActiveById).toHaveBeenCalledWith("agent-test");
    // Resolved via DB and dispatched (ran until max-tool-caps hit).
    expect(result.agentId).toBe("agent-test");
  });

  it("returns the fail() error for an unknown id (neither registry nor DB) — NO fuzzy resolution", async () => {
    // Registry misses, DB misses (agent id is not agent-test).
    const runtime = new AgentRuntime();
    const result = await runtime.runSync({
      agentId: "totally-unknown-id",
      prompt: "research",
      executionMode: "foreground",
      taskPacket: {
        lead: { companyName: "Acme" },
        userGoal: "research acme",
        constraints: {},
        priorFindings: [],
        requiredOutputSchema: { type: "object" },
      },
    });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/Unknown or disabled agent/);
    expect(result.errorMessage).toContain("totally-unknown-id");
  });
});
