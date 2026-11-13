import { describe, expect, it, vi } from "vitest";
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import { AIChatRequestBudgetService } from "@/service/AIChatRequestBudgetService";
import { TOOL_RESULT_CONFIG } from "@/config/toolResultConfig";
import { countTextTokens, utf8ByteLength } from "@/service/ToolResultTextUtil";
import { fitWrappedRetrievalResult } from "@/service/toolResult/retrievalInlineBound";
import type { AIChatQueryLoopInput } from "@/service/AIChatQueryEvents";
import type {
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionRequest,
  OpenAITool,
  ToolExecutionResult,
} from "@/api/aiChatApi";
import {
  TOOL_RESULT_READ_TOOL_NAME,
  TOOL_RESULT_SEARCH_TOOL_NAME,
} from "@/entityTypes/toolResultToolTypes";

function makeTextChunk(
  delta: string,
  finishReason?: string
): OpenAIChatCompletionChunk {
  return {
    id: "resp-guard",
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
    id: "resp-guard",
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

function makeTools(): OpenAITool[] {
  const schema = {
    type: "object",
    properties: { output_id: { type: "string" } },
  };
  return [
    {
      type: "function",
      function: {
        name: "search_maps_businesses",
        description: "Search maps",
        parameters: schema,
      },
    },
    {
      type: "function",
      function: {
        name: TOOL_RESULT_READ_TOOL_NAME,
        description: "Read saved tool result",
        parameters: schema,
      },
    },
    {
      type: "function",
      function: {
        name: TOOL_RESULT_SEARCH_TOOL_NAME,
        description: "Search saved tool result",
        parameters: schema,
      },
    },
  ];
}

function buildInput(
  tools: OpenAITool[],
  overrides?: Partial<AIChatQueryLoopInput>
): AIChatQueryLoopInput {
  return {
    conversationId: "v2-retrieval-guard",
    assistantMessageId: "asst-retrieval-guard",
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Find car wholesale leads and summarize them." },
    ],
    request: {
      message: "Find car wholesale leads and summarize them.",
      model: "gpt-4o",
      conversationId: "v2-retrieval-guard",
      mode: "chat",
    },
    openAITools: tools,
    abortController: new AbortController(),
    eventSink: { emit: () => undefined },
    startRound: 0,
    isActiveTurn: () => true,
    ...overrides,
  };
}

function budgetExhaustedExecutionResult(
  outputId: string,
  toolName: string,
  toolCallId: string
): ToolExecutionResult {
  return {
    tool_call_id: toolCallId,
    tool_name: toolName,
    success: false,
    execution_time_ms: 2,
    result: {
      error: "RETRIEVAL_BUDGET_EXHAUSTED",
      output_id: outputId,
      analysis_complete: false,
      terminal_for_turn: true,
      recovery:
        "Per-turn retrieval budget is exhausted; do NOT call tool_result_read or tool_result_search again in this turn.",
    },
  };
}

describe("AIChatQueryLoop RETRIEVAL_BUDGET_EXHAUSTED guards", () => {
  it("removes tool_result_read and tool_result_search from exposedTools after budget exhaustion", async () => {
    const observedToolsPerRound: string[][] = [];
    let callCount = 0;

    const loop = new AIChatQueryLoop({
      streamChatCompletion: vi.fn(
        async (
          req: OpenAIChatCompletionRequest,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          observedToolsPerRound.push(
            (req.tools ?? []).map((t) => t.function.name)
          );
          if (callCount === 0) {
            callCount += 1;
            onChunk(
              makeToolCallChunk(
                "call-read-1",
                TOOL_RESULT_READ_TOOL_NAME,
                JSON.stringify({ output_id: "out_0123456789abcdef0123456789abcdef" })
              )
            );
            return;
          }
          onChunk(
            makeTextChunk("Here is the summary gathered before retrieval budget ran out.", "stop")
          );
        }
      ),
      executeTool: vi.fn(async (name, _args, ctx) =>
        budgetExhaustedExecutionResult(
          "out_0123456789abcdef0123456789abcdef",
          name,
          ctx.toolCallId ?? "call-read-1"
        )
      ),
      getSkillDefinition: () => undefined,
      requestBudgetService: new AIChatRequestBudgetService(),
      resolveModelLimits: () => ({
        contextLimit: 128_000,
        outputLimit: 16_384,
        limitSource: "provider",
        outputSource: "provider",
      }),
    });

    const result = await loop.run(buildInput(makeTools()));
    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.fullContent).toContain("summary gathered");
    }
    expect(observedToolsPerRound).toEqual([
      [
        "search_maps_businesses",
        TOOL_RESULT_READ_TOOL_NAME,
        TOOL_RESULT_SEARCH_TOOL_NAME,
      ],
      ["search_maps_businesses"],
    ]);
  });

  it("breaks out cleanly after 2 consecutive retrieval-budget-exhausted rounds instead of spinning", async () => {
    let streamCalls = 0;
    const executeTool = vi.fn(async (name, _args, ctx) =>
      budgetExhaustedExecutionResult(
        "out_0123456789abcdef0123456789abcdef",
        name,
        ctx.toolCallId ?? "call-read"
      )
    );

    const loop = new AIChatQueryLoop({
      streamChatCompletion: vi.fn(
        async (
          _req: OpenAIChatCompletionRequest,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          streamCalls += 1;
          onChunk(
            makeToolCallChunk(
              `call-read-${streamCalls}`,
              TOOL_RESULT_READ_TOOL_NAME,
              JSON.stringify({ output_id: "out_0123456789abcdef0123456789abcdef" })
            )
          );
        }
      ),
      executeTool,
      getSkillDefinition: () => undefined,
      requestBudgetService: new AIChatRequestBudgetService(),
      resolveModelLimits: () => ({
        contextLimit: 128_000,
        outputLimit: 16_384,
        limitSource: "provider",
        outputSource: "provider",
      }),
    });

    const result = await loop.run(buildInput(makeTools(), { maxToolRounds: 15 }));
    expect(result.type).toBe("completed");
    expect(streamCalls).toBe(2);
    expect(executeTool).toHaveBeenCalledTimes(2);
    if (result.type === "completed") {
      expect(result.fullContent.toLowerCase()).toContain(
        "per-turn retrieval budget was exhausted"
      );
    }
  });

  it("does not trigger round-cap auto-continuation once retrieval budget is exhausted", async () => {
    let streamCalls = 0;
    const loop = new AIChatQueryLoop({
      streamChatCompletion: vi.fn(
        async (
          _req: OpenAIChatCompletionRequest,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          streamCalls += 1;
          onChunk(
            makeToolCallChunk(
              `call-search-${streamCalls}`,
              TOOL_RESULT_SEARCH_TOOL_NAME,
              JSON.stringify({
                output_id: "out_0123456789abcdef0123456789abcdef",
                query: "wholesale",
              })
            )
          );
        }
      ),
      executeTool: vi.fn(async (name, _args, ctx) =>
        budgetExhaustedExecutionResult(
          "out_0123456789abcdef0123456789abcdef",
          name,
          ctx.toolCallId ?? "call-read-1"
        )
      ),
      getSkillDefinition: () => undefined,
      requestBudgetService: new AIChatRequestBudgetService(),
      resolveModelLimits: () => ({
        contextLimit: 128_000,
        outputLimit: 16_384,
        limitSource: "provider",
        outputSource: "provider",
      }),
    });

    const result = await loop.run(
      buildInput(makeTools(), {
        maxToolRounds: 1,
        maxRoundCapContinuations: 5,
      })
    );
    expect(result.type).toBe("completed");
    expect(streamCalls).toBe(1);
  });

  it("keeps a ~4.9 KB maps-search payload within inline budget and fits a ~4.9 KB read page without shrinking to 900B", () => {
    const mapsPayload = JSON.stringify({
      success: true,
      platform: "google",
      count: 5,
      results: Array.from({ length: 5 }, (_, i) => ({
        name: `Wholesale Auto Dealer ${i + 1}`,
        address: `${1000 + i} Industrial Blvd, Los Angeles, CA 90001`,
        phone: `+1-555-010${i}`,
        website: `https://wholesaleauto${i + 1}.example.com`,
        rating: 4.6,
        review_count: 120 + i,
        summary: "Licensed wholesale auto dealer serving franchised and independent dealerships across the United States.".repeat(4),
      })),
    });

    expect(utf8ByteLength(mapsPayload)).toBeGreaterThan(3000);
    expect(utf8ByteLength(mapsPayload)).toBeLessThanOrEqual(
      TOOL_RESULT_CONFIG.inlineMaxBytes
    );
    expect(countTextTokens(mapsPayload)).toBeLessThanOrEqual(
      TOOL_RESULT_CONFIG.inlineMaxTokens
    );

    const targetPageBytes = Math.floor(TOOL_RESULT_CONFIG.readMaxTokens * 0.8);
    const readEnvelope = fitWrappedRetrievalResult({
      output_id: "out_0123456789abcdef0123456789abcdef",
      revision: 1,
      next_cursor: "v1.out_0123456789abcdef0123456789abcdef.4915.sig1234567890",
      complete: false,
      start_byte: 0,
      end_byte: targetPageBytes,
      total_bytes: 25_000,
      text: "x".repeat(targetPageBytes),
      source_completeness: "complete",
    }) as { text?: string } | null;

    expect(readEnvelope).not.toBeNull();
    expect(readEnvelope?.text?.length).toBe(targetPageBytes);

    const escapedJsonSlice = JSON.stringify(
      {
        results: Array.from({ length: 40 }, (_, i) => ({
          name: `Dealer ${i + 1}`,
          url: `https://dealer${i + 1}.example.com`,
          email: `sales${i + 1}@dealer${i + 1}.example.com`,
          phone: `+1-555-020${i}`,
        })),
      },
      null,
      2
    ).slice(0, targetPageBytes);
    expect(escapedJsonSlice.length).toBe(targetPageBytes);
    const jsonReadEnvelope = fitWrappedRetrievalResult({
      output_id: "out_0123456789abcdef0123456789abcdef",
      revision: 1,
      next_cursor: "v1.out_0123456789abcdef0123456789abcdef.4915.sig1234567890",
      complete: false,
      start_byte: 0,
      end_byte: utf8ByteLength(escapedJsonSlice),
      total_bytes: 25_000,
      text: escapedJsonSlice,
      source_completeness: "complete",
    }) as { text?: string } | null;

    expect(jsonReadEnvelope).not.toBeNull();
    expect((jsonReadEnvelope?.text ?? "").length).toBeGreaterThanOrEqual(4000);
  });

  it("handles mixed tool call round where a retrieval tool exhausts budget but another tool succeeds", async () => {
    const observedToolsPerRound: string[][] = [];
    let callCount = 0;

    const loop = new AIChatQueryLoop({
      streamChatCompletion: vi.fn(
        async (
          req: OpenAIChatCompletionRequest,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          observedToolsPerRound.push(
            (req.tools ?? []).map((t) => t.function.name)
          );
          if (callCount === 0) {
            callCount += 1;
            onChunk({
              id: "resp-mixed",
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
                        id: "call-read-1",
                        type: "function",
                        function: {
                          name: TOOL_RESULT_READ_TOOL_NAME,
                          arguments: JSON.stringify({
                            output_id: "out_0123456789abcdef0123456789abcdef",
                          }),
                        },
                      },
                      {
                        index: 1,
                        id: "call-maps-1",
                        type: "function",
                        function: {
                          name: "search_maps_businesses",
                          arguments: JSON.stringify({ query: "wholesale auto" }),
                        },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
            });
            return;
          }
          onChunk(
            makeTextChunk("Finished with available map data.", "stop")
          );
        }
      ),
      executeTool: vi.fn(async (name, _args, ctx) => {
        if (name === TOOL_RESULT_READ_TOOL_NAME) {
          return budgetExhaustedExecutionResult(
            "out_0123456789abcdef0123456789abcdef",
            name,
            ctx.toolCallId ?? "call-read-1"
          );
        }
        return {
          tool_call_id: ctx.toolCallId ?? "call-maps-1",
          tool_name: name,
          success: true,
          execution_time_ms: 10,
          result: { count: 1, results: [{ name: "Auto Wholesale LLC" }] },
        };
      }),
      getSkillDefinition: () => undefined,
      requestBudgetService: new AIChatRequestBudgetService(),
      resolveModelLimits: () => ({
        contextLimit: 128_000,
        outputLimit: 16_384,
        limitSource: "provider",
        outputSource: "provider",
      }),
    });

    const result = await loop.run(buildInput(makeTools()));
    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.fullContent).toContain("Finished with available map data");
    }
    expect(observedToolsPerRound).toEqual([
      [
        "search_maps_businesses",
        TOOL_RESULT_READ_TOOL_NAME,
        TOOL_RESULT_SEARCH_TOOL_NAME,
      ],
      ["search_maps_businesses"],
    ]);
  });

  it("removes retrieval tools when tool_result_search exhausts per-turn budget", async () => {
    const observedToolsPerRound: string[][] = [];
    let callCount = 0;

    const loop = new AIChatQueryLoop({
      streamChatCompletion: vi.fn(
        async (
          req: OpenAIChatCompletionRequest,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          observedToolsPerRound.push(
            (req.tools ?? []).map((t) => t.function.name)
          );
          if (callCount === 0) {
            callCount += 1;
            onChunk(
              makeToolCallChunk(
                "call-search-1",
                TOOL_RESULT_SEARCH_TOOL_NAME,
                JSON.stringify({
                  output_id: "out_0123456789abcdef0123456789abcdef",
                  query: "dealer phone",
                })
              )
            );
            return;
          }
          onChunk(
            makeTextChunk("Summary without further searching.", "stop")
          );
        }
      ),
      executeTool: vi.fn(async (name, _args, ctx) =>
        budgetExhaustedExecutionResult(
          "out_0123456789abcdef0123456789abcdef",
          name,
          ctx.toolCallId ?? "call-search-1"
        )
      ),
      getSkillDefinition: () => undefined,
      requestBudgetService: new AIChatRequestBudgetService(),
      resolveModelLimits: () => ({
        contextLimit: 128_000,
        outputLimit: 16_384,
        limitSource: "provider",
        outputSource: "provider",
      }),
    });

    const result = await loop.run(buildInput(makeTools()));
    expect(result.type).toBe("completed");
    expect(observedToolsPerRound).toEqual([
      [
        "search_maps_businesses",
        TOOL_RESULT_READ_TOOL_NAME,
        TOOL_RESULT_SEARCH_TOOL_NAME,
      ],
      ["search_maps_businesses"],
    ]);
  });

  it("resets retrieval budget exhaustion state on a subsequent turn", async () => {
    const observedToolsPerTurn: string[][] = [];
    let turn = 1;

    const loop = new AIChatQueryLoop({
      streamChatCompletion: vi.fn(
        async (
          req: OpenAIChatCompletionRequest,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          observedToolsPerTurn.push(
            (req.tools ?? []).map((t) => t.function.name)
          );
          if (turn === 1) {
            onChunk(
              makeToolCallChunk(
                "call-read-turn-1",
                TOOL_RESULT_READ_TOOL_NAME,
                JSON.stringify({ output_id: "out_0123456789abcdef0123456789abcdef" })
              )
            );
            return;
          }
          onChunk(makeTextChunk("Turn 2 text answer.", "stop"));
        }
      ),
      executeTool: vi.fn(async (name, _args, ctx) =>
        budgetExhaustedExecutionResult(
          "out_0123456789abcdef0123456789abcdef",
          name,
          ctx.toolCallId ?? "call-read-turn-1"
        )
      ),
      getSkillDefinition: () => undefined,
      requestBudgetService: new AIChatRequestBudgetService(),
      resolveModelLimits: () => ({
        contextLimit: 128_000,
        outputLimit: 16_384,
        limitSource: "provider",
        outputSource: "provider",
      }),
    });

    // Turn 1: single round where tool_result_read is called and budget exhausted
    await loop.run(buildInput(makeTools(), { maxToolRounds: 1 }));

    // Turn 2: fresh run on the same AIChatQueryLoop instance
    turn = 2;
    await loop.run(
      buildInput(makeTools(), {
        assistantMessageId: "asst-retrieval-guard-turn-2",
        startRound: 0,
      })
    );

    expect(observedToolsPerTurn[0]).toEqual([
      "search_maps_businesses",
      TOOL_RESULT_READ_TOOL_NAME,
      TOOL_RESULT_SEARCH_TOOL_NAME,
    ]);
    expect(observedToolsPerTurn[1]).toEqual([
      "search_maps_businesses",
      TOOL_RESULT_READ_TOOL_NAME,
      TOOL_RESULT_SEARCH_TOOL_NAME,
    ]);
  });
});
