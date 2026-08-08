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
  // Default high enough that regression tests (whose mock loop doesn't
  // call executeTool) never hit the limit. The "exceeded max tool calls"
  // test mutates this to 1 via `mockDefinition`.
  maxToolCalls: 10,
  maxRuntimeMs: 1000,
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

// Mutable handle so individual tests can swap the active definition
// (e.g. set maxToolCalls=1 to exercise the exceeded-limit path).
let mockDefinition: AgentDefinitionView = { ...definition };

vi.mock("@/modules/AgentDefinitionModule", () => ({
  AgentDefinitionModule: class {
    async getActiveById() {
      return mockDefinition;
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
      {
        type: "function",
        name: "file_read",
        description: "Read file",
        parameters: { type: "object" },
      },
      {
        type: "function",
        name: "grep_files",
        description: "Search files",
        parameters: { type: "object" },
      },
      {
        type: "function",
        name: "glob_files",
        description: "Find files",
        parameters: { type: "object" },
      },
      {
        type: "function",
        name: "check_tool_job_status",
        description: "Check job",
        parameters: { type: "object" },
      },
      {
        type: "function",
        name: "cancel_tool_job",
        description: "Cancel job",
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

// Default mocked loop returns valid JSON matching the schema and does not
// invoke executeTool. Tests that need tool calls (the exceeded-limit test)
// flip `mockLoopCallCount` to a positive number.
let mockLoopResult: {
  type: string;
  fullContent: string;
  partialContent?: string;
  error?: unknown;
} = {
  type: "completed",
  fullContent: JSON.stringify({
    businessSummary: "ok",
    sourceUrls: [],
    confidence: 0.8,
  }),
};
let mockLoopCallCount = 0;
let lastLoopInput:
  | {
      request: { model?: string };
      openAITools: Array<{ function: { name: string } }>;
      transientRetryConfig?: { maxAttempts?: number; baseDelayMs?: number };
    }
  | undefined;

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
    async run(input: {
      request: { model?: string };
      openAITools: Array<{ function: { name: string } }>;
    }) {
      lastLoopInput = input;
      for (let i = 0; i < mockLoopCallCount; i++) {
        await this.deps.executeTool(
          "lookup",
          { q: `call-${i}` },
          { toolCallId: `call-${i}` }
        );
      }
      return mockLoopResult;
    }
  },
}));

import { AgentRuntime } from "@/service/AgentRuntime";

function makeRequest(
  overrides: Partial<{
    outputSchemaOverride: Record<string, unknown>;
  }> = {}
) {
  return {
    agentId: "agent-test",
    prompt: "research",
    executionMode: "foreground" as const,
    taskPacket: {
      lead: { companyName: "Acme" },
      userGoal: "research acme",
      constraints: {},
      priorFindings: [],
      requiredOutputSchema: { type: "object" },
    },
    ...overrides,
  };
}

describe("AgentRuntime", () => {
  beforeEach(() => {
    // Reset mutable test state between tests.
    mockDefinition = { ...definition };
    mockLoopCallCount = 0;
    mockLoopResult = {
      type: "completed",
      fullContent: JSON.stringify({
        businessSummary: "ok",
        sourceUrls: [],
        confidence: 0.8,
      }),
    };
    lastLoopInput = undefined;
  });

  it("fails when an agent exceeds its max tool calls", async () => {
    // Lower the limit and have the loop call executeTool twice.
    mockDefinition = { ...definition, maxToolCalls: 1 };
    mockLoopCallCount = 2;
    mockLoopResult = {
      type: "completed",
      fullContent: JSON.stringify({ businessSummary: "ok" }),
    };
    const runtime = new AgentRuntime();
    const result = await runtime.runSync(makeRequest(), {
      executeTool: vi.fn(async (name, _args, ctx) => ({
        tool_call_id: ctx.toolCallId,
        tool_name: name,
        success: true,
        result: { summary: "ok" },
        execution_time_ms: 1,
      })),
    });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("exceeded max tool calls");
  });

  // Regression: subagents run under a tight maxRuntimeMs deadline, so they
  // must retry transient AI-server failures INSTANTLY (baseDelayMs: 0) rather
  // than burning their runtime budget on exponential backoff sleeps. The
  // actual retry mechanics are covered by AIChatQueryLoop's transient-retry
  // suite; here we verify AgentRuntime wires the instant-retry contract.
  it("passes instant-retry config (baseDelayMs: 0) to the agent's query loop", async () => {
    const runtime = new AgentRuntime();
    await runtime.runSync(makeRequest());
    expect(lastLoopInput?.transientRetryConfig).toEqual({ baseDelayMs: 0 });
  });

  // Regression: when the inner agent emits prose instead of JSON, the runtime
  // must NOT fail the whole task. It should salvage the text into a
  // low-confidence partial result so the caller still gets useful research.
  // Reproduces the Acme Corp case where agnes-2.0-flash wrote a markdown
  // conclusion and the parser returned "missing required fields".
  it("salvages non-JSON agent output as a low-confidence partial result", async () => {
    const proseText = [
      "Based on my extensive research, I need to report an important finding:",
      "",
      "## Research Result: Acme Corp (acme.io)",
      "",
      "Acme Corp with domain acme.io appears to be a fictional/demo company.",
      "DNS resolution failed. No CEO or CTO could be identified.",
    ].join("\n");
    mockLoopResult = { type: "completed", fullContent: proseText };

    const runtime = new AgentRuntime();
    const result = await runtime.runSync(makeRequest());

    expect(result.status).toBe("completed");
    expect(result.confidence).toBe(0);
    expect(result.sourceUrls).toEqual([]);
    expect(result.parseWarning).toMatch(
      /missing required fields|not valid JSON/
    );
    expect(result.output?.businessSummary).toBe(proseText);
    expect(result.text).toBe(proseText);
  });

  // Regression: partially-valid JSON (parsed but missing required fields) is
  // preserved as the base of the fallback so any extra fields the agent did
  // return survive.
  it("preserves partial JSON fields when required fields are missing", async () => {
    mockLoopResult = {
      type: "completed",
      fullContent: JSON.stringify({
        industry: "SaaS",
        productsOrServices: ["ai-terminal"],
        // Missing: businessSummary, sourceUrls, confidence
      }),
    };

    const runtime = new AgentRuntime();
    const result = await runtime.runSync(makeRequest());

    expect(result.status).toBe("completed");
    expect(result.confidence).toBe(0);
    expect(result.parseWarning).toMatch(/missing required fields/);
    // Preserved extra fields
    expect(result.output?.industry).toBe("SaaS");
    expect(result.output?.productsOrServices).toEqual(["ai-terminal"]);
    // Filled-in defaults
    expect(typeof result.output?.businessSummary).toBe("string");
    expect(result.output?.sourceUrls).toEqual([]);
    expect(result.output?.confidence).toBe(0);
  });

  it("parses and extracts clean JSON output with valid sourceUrls", async () => {
    mockLoopResult = {
      type: "completed",
      fullContent: JSON.stringify({
        businessSummary: "Real company",
        sourceUrls: [
          "https://example.com/about",
          "not-a-url",
          "ftp://bad.example.com",
          "https://linkedin.com/company/acme",
        ],
        confidence: 0.9,
      }),
    };

    const runtime = new AgentRuntime();
    const result = await runtime.runSync(makeRequest());

    expect(result.status).toBe("completed");
    expect(result.parseWarning).toBeUndefined();
    expect(result.confidence).toBe(0.9);
    expect(result.sourceUrls).toEqual([
      "https://example.com/about",
      "https://linkedin.com/company/acme",
    ]);
  });

  // Regression: outputSchemaOverride was plumbed through RunAgentRequest but
  // silently ignored. Verify it now actually narrows validation.
  it("respects outputSchemaOverride instead of the definition default", async () => {
    // Agent returns JSON matching the override schema, NOT the default one.
    mockLoopResult = {
      type: "completed",
      fullContent: JSON.stringify({ customField: "value" }),
    };

    const runtime = new AgentRuntime();
    const result = await runtime.runSync(
      makeRequest({
        outputSchemaOverride: {
          type: "object",
          required: ["customField"],
          properties: { customField: { type: "string" } },
        },
      })
    );

    expect(result.status).toBe("completed");
    expect(result.parseWarning).toBeUndefined();
    expect(result.output?.customField).toBe("value");
  });

  it("normalizes persisted Claude plugin model and tool aliases at runtime", async () => {
    mockDefinition = {
      ...definition,
      id: "caveman:cavecrew-investigator",
      source: "plugin",
      pluginName: "caveman",
      allowedTools: ["Read", "Grep", "Glob", "Bash"],
      defaultModel: "haiku",
    };

    const runtime = new AgentRuntime();
    const result = await runtime.runSync({
      ...makeRequest(),
      agentId: "caveman:cavecrew-investigator",
    });

    expect(result.status).toBe("completed");
    expect(lastLoopInput?.request.model).toBeUndefined();
    const toolNames =
      lastLoopInput?.openAITools.map((tool) => tool.function.name) ?? [];
    expect(toolNames).toContain("file_read");
    expect(toolNames).toContain("grep_files");
    expect(toolNames).toContain("glob_files");
    expect(toolNames).not.toContain("Bash");
    expect(toolNames).not.toContain("haiku");
  });

  it("rejects override-mismatched JSON with a parseWarning (lenient fallback)", async () => {
    // Override demands customField, agent returns something else.
    mockLoopResult = {
      type: "completed",
      fullContent: JSON.stringify({ wrongField: "x" }),
    };

    const runtime = new AgentRuntime();
    const result = await runtime.runSync(
      makeRequest({
        outputSchemaOverride: {
          type: "object",
          required: ["customField"],
        },
      })
    );

    expect(result.status).toBe("completed");
    expect(result.parseWarning).toMatch(/missing required fields/);
    expect(result.output?.wrongField).toBe("x");
  });
});
