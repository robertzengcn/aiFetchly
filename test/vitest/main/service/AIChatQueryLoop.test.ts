import { describe, expect, it, vi } from "vitest";
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
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
      const badChunk = makeToolCallChunk(
        "call-1",
        "search",
        "{invalid json"
      );
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
      };
      const result = await loop.run(input);
      expect(result.type).toBe("failed");
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
      };
      const result = await loop.run(input);
      expect(result.type).toBe("paused_for_permission");
      if (result.type === "paused_for_permission") {
        expect(result.pending.toolCallId).toBe("call-1");
        expect(result.pending.nextRound).toBe(1);
      }
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
      };
      await loop.run(input);
      expect(events).toContain("tool_call");
      expect(events).toContain("tool_result");
    });
  });
});
