import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { AIChatQueryLoopInput } from "@/service/AIChatQueryEvents";
import type { AgentDefinitionView } from "@/entityTypes/agentTypes";

const definition: AgentDefinitionView = {
  id: "agent-allowlist",
  name: "Allowlist Agent",
  description: "Test",
  version: 1,
  systemPrompt: "You are a test agent.",
  // Agent may only use these two tools; mcp_1_secret is NOT allowed.
  allowedTools: ["lookup", "file_read"],
  mode: "specialist",
  maxToolCalls: 4,
  maxRuntimeMs: 5000,
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
      return undefined;
    }
    async getSnapshot() {
      return { toolCallsCount: 0 };
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
      {
        type: "function",
        name: "file_read",
        description: "Read a file",
        parameters: { type: "object" },
      },
      {
        type: "function",
        name: "mcp_1_secret",
        description: "Secret MCP tool",
        parameters: { type: "object" },
      },
    ]),
    getSkill: vi.fn((name: string) => ({
      name,
      description: `${name} tool`,
      parameters: { type: "object" },
      permissionCategory: "pure",
      source: "built-in",
    })),
  },
}));

vi.mock("@/service/SkillExecutor", () => ({
  SkillExecutor: { execute: vi.fn() },
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

// Capture the loopInput the runtime passes into the loop.
let capturedInput: AIChatQueryLoopInput | undefined;

vi.mock("@/service/AIChatQueryLoop", () => ({
  AIChatQueryLoop: class {
    async run(input: AIChatQueryLoopInput) {
      capturedInput = input;
      return {
        type: "completed",
        fullContent: JSON.stringify({ summary: "ok" }),
      };
    }
  },
}));

import { AgentRuntime } from "@/service/AgentRuntime";

describe("AgentRuntime deferred catalog (AC-4)", () => {
  beforeEach(() => {
    capturedInput = undefined;
  });
  afterEach(() => {
    delete process.env.AI_TOOL_SEARCH;
  });

  it("builds a catalog scoped to the agent allowlist (excludes non-allowed tools)", async () => {
    process.env.AI_TOOL_SEARCH = "on";
    const runtime = new AgentRuntime();
    await runtime.runSync(
      {
        agentId: "agent-allowlist",
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
        executeTool: vi.fn(async (name: string, _args, ctx) => ({
          tool_call_id: ctx.toolCallId,
          tool_name: name,
          success: true,
          result: { summary: "ok" },
          execution_time_ms: 1,
        })),
      }
    );

    expect(capturedInput).toBeDefined();
    const catalog = capturedInput?.toolCatalog;
    expect(catalog).toBeDefined();
    expect(capturedInput?.toolCatalogModeDecision?.mode).toBe("deferred");
    // Catalog contains only allowlisted tools — the blocked/non-allowed
    // mcp_1_secret never enters the catalog, so discovery cannot surface it.
    const names = Array.from(catalog!.byName.keys());
    expect(names).toEqual(expect.arrayContaining(["lookup", "file_read"]));
    expect(names).not.toContain("mcp_1_secret");
  });

  it("does not build a catalog when AI_TOOL_SEARCH is off", async () => {
    process.env.AI_TOOL_SEARCH = "off";
    const runtime = new AgentRuntime();
    await runtime.runSync(
      {
        agentId: "agent-allowlist",
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
        executeTool: vi.fn(async (name: string, _args, ctx) => ({
          tool_call_id: ctx.toolCallId,
          tool_name: name,
          success: true,
          result: { summary: "ok" },
          execution_time_ms: 1,
        })),
      }
    );
    expect(capturedInput?.toolCatalog).toBeUndefined();
    expect(capturedInput?.toolCatalogModeDecision).toBeUndefined();
  });
});
