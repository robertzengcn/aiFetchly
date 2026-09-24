/**
 * Regression: `/goal` Plan Mode was rejected with
 * "serialized input (6551) + output (1024) + safety (820) exceeds context (8192)"
 * because the query loop's budget resolver read an unloaded catalog and
 * treated every model as the 8,192-token unknown-model fallback.
 */
import { describe, expect, it, vi } from "vitest";
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import { AIChatModelCatalogService } from "@/service/AIChatModelCatalogService";
import { AIChatRequestBudgetService } from "@/service/AIChatRequestBudgetService";
import type { AIChatQueryLoopInput } from "@/service/AIChatQueryEvents";
import type {
  OpenAIChatCompletionChunk,
  OpenAIModelsResponse,
  OpenAITool,
} from "@/api/aiChatApi";

function makeChunk(
  delta: string,
  finishReason?: string
): OpenAIChatCompletionChunk {
  return {
    id: "resp-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "gpt-4o",
    choices: [
      {
        index: 0,
        delta: { content: delta },
        finish_reason: finishReason ?? null,
      },
    ],
  };
}

function fatTools(count: number): OpenAITool[] {
  return Array.from({ length: count }, (_, i) => ({
    type: "function",
    function: {
      name: `tool_${i}`,
      description: "d".repeat(2_400),
      parameters: {
        type: "object",
        properties: { q: { type: "string" } },
      },
    },
  }));
}

function goalSizedInput(tools: OpenAITool[]): AIChatQueryLoopInput {
  return {
    conversationId: "v2-goal-budget",
    assistantMessageId: "asst-goal",
    messages: [
      {
        role: "system",
        content: `${"You are aiFetchly's built-in helpful assistant. ".repeat(
          40
        )}`,
      },
      {
        role: "user",
        content:
          "Plan how to accomplish this goal: find 1000+ company do trade in Canada, and get their contact method, the item we collect must have email\n\nBreak the work into safe, ordered steps. Do not begin execution until the plan is approved.",
      },
    ],
    request: {
      message: "/goal find 1000+ company do trade in Canada",
      model: "gpt-4o",
      conversationId: "v2-goal-budget",
      mode: "plan",
    },
    openAITools: tools,
    abortController: new AbortController(),
    eventSink: { emit: () => undefined },
    startRound: 0,
    isActiveTurn: () => true,
  };
}

function catalogWithWindow(
  contextWindow: number,
  maxTokens?: number
): AIChatModelCatalogService {
  const resp: OpenAIModelsResponse = {
    object: "list",
    data: [
      {
        id: "gpt-4o",
        object: "model",
        created: 1,
        owned_by: "test",
        context_window: contextWindow,
        ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
      },
    ],
    default_model: "gpt-4o",
  };
  const api = {
    listOpenAIModels: vi.fn().mockResolvedValue(resp),
  } as unknown as ConstructorParameters<typeof AIChatModelCatalogService>[0];
  return new AIChatModelCatalogService(api, 128_000);
}

describe("AIChatQueryLoop request budget (/goal regression)", () => {
  it("does not treat an unloaded catalog as an 8,192-token model", () => {
    const loop = new AIChatQueryLoop({
      streamChatCompletion: vi.fn(),
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
    });
    const limits = loop.getDefaultModelLimitResolver()("gpt-4o");
    expect(limits.contextLimit).toBe(128_000);
    expect(limits.limitSource).toBe("fallback");
  });

  it("uses the provider context window after the catalog loads", async () => {
    const catalog = catalogWithWindow(128_000, 16_384);
    await catalog.ensureLoaded();
    const loop = new AIChatQueryLoop({
      streamChatCompletion: vi.fn(),
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
      modelCatalogService: catalog,
    });
    expect(loop.getDefaultModelLimitResolver()("gpt-4o")).toEqual({
      contextLimit: 128_000,
      outputLimit: 16_384,
      limitSource: "provider",
    });
  });

  it("dispatches a /goal-sized first turn when the catalog reports 128k context", async () => {
    const tools = fatTools(12);
    const budget = new AIChatRequestBudgetService();
    const estimated = budget.estimateInputTokens({
      messages: goalSizedInput(tools).messages,
      tools,
    });
    // Same ballpark as the production rejection (I=6551 on 8k fallback).
    expect(estimated).toBeGreaterThan(6_348);

    const catalog = catalogWithWindow(128_000, 16_384);
    await catalog.ensureLoaded();
    const stream = vi.fn(
      async (
        _req: unknown,
        onChunk: (c: OpenAIChatCompletionChunk) => void
      ) => {
        onChunk(makeChunk("Plan:", "stop"));
      }
    );
    const loop = new AIChatQueryLoop({
      streamChatCompletion: stream,
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
      modelCatalogService: catalog,
    });
    const result = await loop.run(goalSizedInput(tools));
    expect(result.type).toBe("completed");
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("still rejects a /goal-sized turn against a genuine 8,192-token window", async () => {
    const tools = fatTools(12);
    const stream = vi.fn();
    const loop = new AIChatQueryLoop({
      streamChatCompletion: stream,
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
      resolveModelLimits: () => ({
        contextLimit: 8_192,
        outputLimit: 1_024,
        limitSource: "configured",
      }),
    });
    const result = await loop.run(goalSizedInput(tools));
    expect(result.type).toBe("failed");
    expect(stream).not.toHaveBeenCalled();
    const err = (result as { error: unknown }).error;
    expect(String((err as Error)?.message ?? err)).toMatch(
      /request budget rejected: serialized input .* exceeds context \(8192\)/
    );
  });

  it("compacts once and retries when the serialized request exceeds the window", async () => {
    const tools: OpenAITool[] = [
      {
        type: "function",
        function: {
          name: "echo",
          description: "echo",
          parameters: { type: "object", properties: {} },
        },
      },
    ];
    const stream = vi.fn(
      async (
        _req: unknown,
        onChunk: (chunk: OpenAIChatCompletionChunk) => void
      ) => {
        onChunk(makeChunk("ok", "stop"));
      }
    );
    const events: string[] = [];
    const relieve = vi.fn(async () => [
      { role: "system" as const, content: "compacted summary" },
      { role: "user" as const, content: "continue" },
    ]);
    const loop = new AIChatQueryLoop({
      streamChatCompletion: stream,
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
      resolveModelLimits: () => ({
        contextLimit: 8_192,
        outputLimit: 1_024,
        limitSource: "configured",
      }),
    });
    const input = goalSizedInput(tools);
    input.messages = [
      { role: "system", content: "s" },
      { role: "user", content: "x".repeat(40_000) },
    ];
    input.eventSink = {
      emit: (event) => {
        events.push(event.type);
      },
    };
    input.relieveBudgetPressure = relieve;
    const result = await loop.run(input);
    expect(relieve).toHaveBeenCalledTimes(1);
    expect(events).toContain("usage_update");
    expect(result.type).toBe("completed");
    expect(stream).toHaveBeenCalledTimes(1);
  });
});
