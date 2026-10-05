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
  OpenAIChatCompletionRequest,
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

function makeToolCallChunk(
  toolCallId: string,
  toolName: string,
  argsJson: string
): OpenAIChatCompletionChunk {
  return {
    id: "resp-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "gpt-4o",
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: toolCallId,
              type: "function",
              function: { name: toolName, arguments: argsJson },
            },
          ],
        },
        finish_reason: "tool_calls",
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
    // Models without a server-reported context window default to 256k so
    // long scheduled-loop turns are not rejected on a too-small 128k guess.
    expect(limits.contextLimit).toBe(256_000);
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

  it("stubs older tool payloads when the live turn exceeds the window", async () => {
    const stream = vi.fn(
      async (
        req: OpenAIChatCompletionRequest,
        onChunk: (chunk: OpenAIChatCompletionChunk) => void
      ) => {
        const toolMessages = req.messages.filter((m) => m.role === "tool");
        const older = toolMessages.slice(0, -1);
        expect(
          older.every(
            (m) => typeof m.content !== "string" || m.content.length < 500
          )
        ).toBe(true);
        onChunk(makeChunk("ok", "stop"));
      }
    );
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
    const input = goalSizedInput([
      {
        type: "function",
        function: {
          name: "extract_contact_info",
          description: "extract",
          parameters: { type: "object", properties: {} },
        },
      },
    ]);
    const fat = "email html ".repeat(2_000);
    input.messages = [
      { role: "system", content: "system" },
      { role: "user", content: "keep finding contacts" },
      ...Array.from({ length: 8 }, (_, i) => [
        {
          role: "assistant" as const,
          content: null,
          tool_calls: [
            {
              id: `call_${i}`,
              type: "function" as const,
              function: {
                name: "start_email_send_task",
                arguments: JSON.stringify({ email_html_content: fat }),
              },
            },
          ],
        },
        {
          role: "tool" as const,
          tool_call_id: `call_${i}`,
          content: fat,
        },
      ]).flat(),
    ];
    const result = await loop.run(input);
    expect(result.type).toBe("completed");
    expect(stream).toHaveBeenCalledTimes(1);
  });

  // Regression: a scheduled-loop turn runs many tool rounds in a single
  // runOnce. The live transcript keeps growing after the first budget
  // relief (compaction), so relief must re-trigger on later rounds as
  // pressure climbs again — not be gated off for the whole turn. Before
  // the fix, `relievedBudgetPressure` was a per-turn boolean that blocked
  // a second relief; the turn overflowed 128k and was rejected.
  it("re-triggers budget relief across multiple tool rounds of one turn", async () => {
    const tools: OpenAITool[] = [
      {
        type: "function",
        function: {
          name: "scrape",
          description: "scrape a page",
          parameters: { type: "object", properties: {} },
        },
      },
    ];
    // Each round emits a tool call; the tool result is fat enough to push
    // pressure back up after relief shrinks the transcript.
    const fatResult = "x".repeat(20_000);
    let round = 0;
    const stream = vi.fn(
      async (
        _req: unknown,
        onChunk: (c: OpenAIChatCompletionChunk) => void
      ) => {
        if (round < 2) {
          onChunk(makeToolCallChunk(`call-${round}`, "scrape", "{}"));
        } else {
          onChunk(makeChunk("done", "stop"));
        }
      }
    );
    const fakeExecute = vi.fn().mockImplementation(() => {
      round += 1;
      return Promise.resolve({
        tool_call_id: `call-${round - 1}`,
        tool_name: "scrape",
        success: true,
        result: { page: fatResult },
        execution_time_ms: 5,
      });
    });
    // Relief returns a shrunken transcript each time it is called.
    let reliefCalls = 0;
    const relieve = vi.fn(async () => {
      reliefCalls += 1;
      return [
        { role: "system" as const, content: "compacted summary" },
        { role: "user" as const, content: "continue" },
      ];
    });
    const loop = new AIChatQueryLoop({
      streamChatCompletion: stream,
      executeTool: fakeExecute,
      getSkillDefinition: () => undefined,
      resolveModelLimits: () => ({
        // Small window so pressure is reached with modest tool results.
        contextLimit: 8_192,
        outputLimit: 1_024,
        limitSource: "configured",
      }),
    });
    const input = goalSizedInput(tools);
    input.messages = [
      { role: "system", content: "s" },
      { role: "user", content: "keep scraping" },
    ];
    input.eventSink = { emit: () => undefined };
    input.relieveBudgetPressure = relieve;
    input.maxToolRounds = 3;
    const result = await loop.run(input);
    expect(result.type).toBe("completed");
    expect(stream).toHaveBeenCalled();
    // Relief fired more than once across the multi-round turn — the per-turn
    // gate no longer blocks the second+ relief. (Capped at
    // maxBudgetReliefAttemptsPerTurn so it can't loop forever.)
    expect(reliefCalls).toBeGreaterThan(1);
    expect(reliefCalls).toBeLessThanOrEqual(
      // maxBudgetReliefAttemptsPerTurn default is 3.
      3
    );
  });
});
