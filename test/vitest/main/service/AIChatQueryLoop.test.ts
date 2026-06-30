import { describe, expect, it, vi } from "vitest";
import {
  AIChatQueryLoop,
  resolveToolChoiceForRound,
} from "@/service/AIChatQueryLoop";
import type { AIChatQueryLoopInput } from "@/service/AIChatQueryEvents";
import type { OpenAIChatCompletionChunk } from "@/api/aiChatApi";

function makeChunk(
  delta: string,
  finishReason?: string
): OpenAIChatCompletionChunk {
  return {
    id: "resp-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
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
    model: "test-model",
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

describe("AIChatQueryLoop", () => {
  describe("tool choice", () => {
    it("forces SubmitPlanForApproval on explicit submit-now plan requests", () => {
      expect(
        resolveToolChoiceForRound({
          message:
            "Do not ask more questions; submit the plan for approval now.",
          hasTools: true,
          isPlanMode: true,
          round: 0,
          startRound: 0,
        })
      ).toEqual({
        type: "function",
        function: { name: "SubmitPlanForApproval" },
      });
    });
  });

  describe("normal streaming", () => {
    it("returns completed with full content when model finishes without tool calls", async () => {
      const emitted: string[] = [];
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          onChunk(makeChunk("Hello, "));
          onChunk(makeChunk("world!", "stop"));
        }
      );
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: vi.fn(),
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const input: AIChatQueryLoopInput = {
        conversationId: "v2-test",
        assistantMessageId: "assistant-1",
        messages: [],
        request: { message: "hi" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: {
          emit: (e) => {
            if (e.type === "token") emitted.push(e.contentDelta);
          },
        },
        startRound: 0,
        isActiveTurn: () => true,
      };
      const result = await loop.run(input);
      expect(result.type).toBe("completed");
      if (result.type === "completed") {
        expect(result.fullContent).toBe("Hello, world!");
        expect(result.finishReason).toBe("stop");
        expect(result.model).toBe("test-model");
      }
      expect(emitted.join("")).toBe("Hello, world!");
    });
  });

  describe("tool calls", () => {
    it("submits an immediate approval plan when explicit submit-now plan mode gets an empty model response", async () => {
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          onChunk(makeChunk("", "stop"));
        }
      );
      const events: unknown[] = [];
      const submittedPlan = {
        planId: "plan-immediate",
        conversationId: "v2-test",
        status: "awaiting_approval",
        title: "Immediate approval plan",
        objective: "Submit a plan now",
        currentVersion: 1,
      };
      const submitPlanForApproval = vi.fn().mockResolvedValue(submittedPlan);
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: vi.fn(),
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });

      const result = await loop.run({
        conversationId: "v2-test",
        assistantMessageId: "a-1",
        messages: [],
        request: {
          message:
            "Create an approval plan. Do not ask questions. Submit the plan for approval now.",
          mode: "plan",
        },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: { emit: (event) => events.push(event) },
        planContext: {
          planModule: {
            saveQuestion: vi.fn(),
            submitPlanForApproval,
            getPlanStateByPlanId: vi.fn(),
            answerQuestion: vi.fn(),
          },
          planState: {
            planId: "plan-immediate",
            conversationId: "v2-test",
            status: "draft",
            title: "Immediate approval plan",
            objective: "Submit a plan now",
            currentVersion: 0,
          } as never,
        },
        startRound: 0,
        isActiveTurn: () => true,
      });

      expect(result.type).toBe("completed");
      expect(submitPlanForApproval).toHaveBeenCalled();
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "plan_submitted",
          planState: submittedPlan,
        })
      );
      if (result.type === "completed") {
        expect(result.fullContent).toContain("submitted for approval");
      }
    });

    it("executes tool and continues to next round when finish_reason is tool_calls", async () => {
      const toolCallChunk = makeToolCallChunk(
        "call-1",
        "search",
        '{"q":"test"}'
      );
      const finalChunk = makeChunk("Done", "stop");
      let callCount = 0;
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          if (callCount === 0) {
            onChunk(toolCallChunk);
            callCount++;
          } else {
            onChunk(finalChunk);
          }
        }
      );
      const fakeExecute = vi.fn().mockResolvedValue({
        tool_call_id: "call-1",
        tool_name: "search",
        success: true,
        result: { answer: "found" },
        execution_time_ms: 10,
      });
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: fakeExecute,
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const input: AIChatQueryLoopInput = {
        conversationId: "v2-test",
        assistantMessageId: "a-1",
        messages: [],
        request: { message: "hi" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: { emit: vi.fn() },
        startRound: 0,
        isActiveTurn: () => true,
      };
      const result = await loop.run(input);
      expect(result.type).toBe("completed");
      expect(fakeExecute).toHaveBeenCalledWith(
        "search",
        { q: "test" },
        expect.objectContaining({ toolCallId: "call-1" })
      );
    });

    it("returns failed for malformed tool arguments", async () => {
      const badChunk = makeToolCallChunk("call-1", "search", "{invalid json");
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          onChunk(badChunk);
        }
      );
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: vi.fn(),
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const input: AIChatQueryLoopInput = {
        conversationId: "v2-test",
        assistantMessageId: "a-1",
        messages: [],
        request: { message: "hi" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: { emit: vi.fn() },
        startRound: 0,
        isActiveTurn: () => true,
      };
      const result = await loop.run(input);
      expect(result.type).toBe("failed");
    });

    it("returns failed when stream ends after an unusable tool call delta", async () => {
      const incompleteChunk: OpenAIChatCompletionChunk = {
        id: "resp-1",
        object: "chat.completion.chunk",
        created: 1,
        model: "test-model",
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: "" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      };
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          onChunk(incompleteChunk);
        }
      );
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: vi.fn(),
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const input: AIChatQueryLoopInput = {
        conversationId: "v2-test",
        assistantMessageId: "a-1",
        messages: [],
        request: { message: "hi" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: { emit: vi.fn() },
        startRound: 0,
        isActiveTurn: () => true,
      };

      const result = await loop.run(input);

      expect(result.type).toBe("failed");
      if (result.type === "failed") {
        expect(result.error).toBeInstanceOf(Error);
        expect((result.error as Error).message).toContain(
          "ended before returning a complete response"
        );
      }
    });

    it("returns paused_for_permission when tool result needs permission", async () => {
      const toolCallChunk = makeToolCallChunk("call-1", "scrape", "{}");
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          onChunk(toolCallChunk);
        }
      );
      const fakeExecute = vi.fn().mockResolvedValue({
        tool_call_id: "call-1",
        tool_name: "scrape",
        success: false,
        result: { needsPermissionPrompt: true },
        execution_time_ms: 1,
      });
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: fakeExecute,
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const input: AIChatQueryLoopInput = {
        conversationId: "v2-test",
        assistantMessageId: "a-1",
        messages: [],
        request: { message: "hi" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: { emit: vi.fn() },
        startRound: 0,
        isActiveTurn: () => true,
      };
      const result = await loop.run(input);
      expect(result.type).toBe("paused_for_permission");
      if (result.type === "paused_for_permission") {
        expect(result.pending.toolCallId).toBe("call-1");
        expect(result.pending.nextRound).toBe(1);
      }
    });

    it("executes tool calls even when server sends finish_reason=stop with tool_calls delta", async () => {
      // Some OpenAI-compatible servers emit finish_reason="stop" even when
      // tool-call deltas were streamed. The loop must still execute the
      // parsed tool calls — relying on parsedCalls rather than finish_reason.
      const toolCallChunkWithStop: OpenAIChatCompletionChunk = {
        id: "resp-1",
        object: "chat.completion.chunk",
        created: 1,
        model: "test-model",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call-1",
                  type: "function",
                  function: { name: "search", arguments: '{"q":"canada"}' },
                },
              ],
            },
            finish_reason: "stop",
          },
        ],
      };
      const finalChunk = makeChunk("Found customers.", "stop");
      let callCount = 0;
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          if (callCount === 0) {
            onChunk(toolCallChunkWithStop);
            callCount++;
          } else {
            onChunk(finalChunk);
          }
        }
      );
      const fakeExecute = vi.fn().mockResolvedValue({
        tool_call_id: "call-1",
        tool_name: "search",
        success: true,
        result: { answer: "found" },
        execution_time_ms: 10,
      });
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: fakeExecute,
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const input: AIChatQueryLoopInput = {
        conversationId: "v2-test",
        assistantMessageId: "a-1",
        messages: [],
        request: { message: "find customers in Canada" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: { emit: vi.fn() },
        startRound: 0,
        isActiveTurn: () => true,
      };
      const result = await loop.run(input);
      expect(result.type).toBe("completed");
      expect(fakeExecute).toHaveBeenCalledWith(
        "search",
        { q: "canada" },
        expect.objectContaining({ toolCallId: "call-1" })
      );
    });

    it("emits tool_call and tool_result events through eventSink", async () => {
      const toolCallChunk = makeToolCallChunk("call-1", "get_time", "{}");
      const finalChunk = makeChunk("It is noon.", "stop");
      let callCount = 0;
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          if (callCount === 0) {
            onChunk(toolCallChunk);
            callCount++;
          } else {
            onChunk(finalChunk);
          }
        }
      );
      const fakeExecute = vi.fn().mockResolvedValue({
        tool_call_id: "call-1",
        tool_name: "get_time",
        success: true,
        result: { time: "12:00" },
        execution_time_ms: 5,
      });
      const events: string[] = [];
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: fakeExecute,
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const input: AIChatQueryLoopInput = {
        conversationId: "v2-test",
        assistantMessageId: "a-1",
        messages: [],
        request: { message: "hi" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: {
          emit: (e) => {
            events.push(e.type);
          },
        },
        startRound: 0,
        isActiveTurn: () => true,
      };
      await loop.run(input);
      expect(events).toContain("tool_call");
      expect(events).toContain("tool_result");
    });

    it("returns a clear fallback message when a failed tool is followed by an empty model response", async () => {
      const toolCallChunk = makeToolCallChunk(
        "call-1",
        "run_subagent",
        '{"agentId":"agent-lead-researcher"}'
      );
      let callCount = 0;
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          if (callCount === 0) {
            callCount += 1;
            onChunk(toolCallChunk);
            return;
          }
          onChunk(makeChunk("", "stop"));
        }
      );
      const fakeExecute = vi.fn().mockResolvedValue({
        tool_call_id: "call-1",
        tool_name: "run_subagent",
        success: false,
        result: { error: "Agent task timed out." },
        execution_time_ms: 180000,
      });
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: fakeExecute,
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const result = await loop.run({
        conversationId: "v2-test",
        assistantMessageId: "a-1",
        messages: [],
        request: { message: "run a subagent" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: { emit: vi.fn() },
        startRound: 0,
        isActiveTurn: () => true,
      });

      expect(result.type).toBe("completed");
      if (result.type === "completed") {
        expect(result.fullContent).toContain("run_subagent");
        expect(result.fullContent).toContain("Agent task timed out.");
      }
    });
  });

  describe("truncated JSON tool arguments", () => {
    it("emits compact-payload guidance when tool call JSON looks truncated", async () => {
      // Simulates run_subagent with a taskPacket so large the JSON gets
      // truncated mid-object (missing closing brace). The loop should emit
      // a tool_result event with specific guidance about keeping args compact.
      // Built as a raw string because the truncation is in the mock data itself.
      const truncated =
        '{"agentId":"agent-lead-researcher","prompt":"Research Stripe","taskPacket":' +
        '{"lead":{"companyName":"Stripe","contacts":[{"name":"John"';
      const truncChunk = makeToolCallChunk("call-trunc", "run_subagent", truncated);

      const eventSink = { emit: vi.fn() };

      // Return the same truncated chunk on every round
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          onChunk(truncChunk);
        }
      );

      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: vi.fn(),
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });

      const result = await loop.run({
        conversationId: "v2-trunc",
        assistantMessageId: "a-trunc",
        messages: [],
        request: { message: "enrich these leads" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink,
        startRound: 0,
        isActiveTurn: () => true,
      });

      // After 4 consecutive malformed rounds, the loop returns "failed"
      expect(result.type).toBe("failed");

      // Check that at least one tool_result event carried the compact-payload
      // guidance message (emitted before the retry limit was exhausted)
      const toolResultEvents = (eventSink.emit as ReturnType<typeof vi.fn>).mock.calls
        .filter((call: unknown[]) => (call[0] as { type?: string }).type === "tool_result")
        .map((call: unknown[]) => (call[0] as { toolResult?: { error?: string } }).toolResult?.error ?? "");

      expect(toolResultEvents.length).toBeGreaterThan(0);
      const hasTruncationGuidance = toolResultEvents.some(
        (msg: string) =>
          msg.includes("truncated") && msg.includes("MORE COMPACT")
      );
      expect(hasTruncationGuidance).toBe(true);
    });
  });

  describe("server-side error finish_reason", () => {
    it("surfaces a retryable-tagged error when the stream ends with finish_reason=error and empty content", async () => {
      // Reproduces the real-world failure mode where the AI server returns
      // finish_reason="error" with empty content (typically under load).
      // The SSE recovery path in aiChatApi emits a chunk carrying the
      // error finish_reason; the loop must surface it as a recognizable
      // error so userSafeError can translate it to an actionable message.
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          onChunk(makeChunk("", "error"));
        }
      );
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: vi.fn(),
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const input: AIChatQueryLoopInput = {
        conversationId: "v2-err",
        assistantMessageId: "assistant-err",
        messages: [],
        request: { message: "hi" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: { emit: vi.fn() },
        startRound: 0,
        isActiveTurn: () => true,
      };

      const result = await loop.run(input);
      expect(result.type).toBe("failed");
      if (result.type === "failed") {
        expect(result.error).toBeInstanceOf(Error);
        const msg = (result.error as Error).message;
        expect(msg).toMatch(/finish_reason=error/i);
        expect(msg).toMatch(/transient server/i);
      }
    });
  });
});
