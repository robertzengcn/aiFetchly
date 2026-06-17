// test/vitest/main/service/AIChatQueryEngine.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";
import type {
  AIChatQueryLoop,
  AIChatQueryLoopDeps,
} from "@/service/AIChatQueryLoop";
import type { OpenAIChatMessage } from "@/api/aiChatApi";
import type { AIChatContextAssembler } from "@/service/AIChatContextAssembler";
import type { AIChatCompactAgentService } from "@/service/AIChatCompactAgentService";
import type {
  AIChatQueryEvent,
  AIChatQueryLoopInput,
  AIChatQueryLoopResult,
} from "@/service/AIChatQueryEvents";

// --- Mock AIChatV2Module -----------------------------------------------
const mockSaveUserMessage = vi.fn().mockResolvedValue({ messageId: "user-1" });
const mockGetConversationMessages = vi.fn().mockResolvedValue([]);
const mockSaveAssistantMessage = vi.fn().mockResolvedValue({});
const mockSaveToolCallMessage = vi.fn().mockResolvedValue({});
const mockSaveToolResultMessage = vi.fn().mockResolvedValue({});
const mockCreateConversationIfNeeded = vi.fn().mockReturnValue("v2-test-conv");
const mockGetDefaultSystemPrompt = vi.fn().mockReturnValue("You are helpful.");

vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(() => ({
    saveUserMessage: mockSaveUserMessage,
    getConversationMessages: mockGetConversationMessages,
    saveAssistantMessage: mockSaveAssistantMessage,
    saveToolCallMessage: mockSaveToolCallMessage,
    saveToolResultMessage: mockSaveToolResultMessage,
    createConversationIfNeeded: mockCreateConversationIfNeeded,
    getDefaultSystemPrompt: mockGetDefaultSystemPrompt,
  })),
}));

// --- Mock AIChatPlanModule ---------------------------------------------
vi.mock("@/modules/AIChatPlanModule", () => ({
  AIChatPlanModule: vi.fn().mockImplementation(() => ({
    getPlanState: vi.fn().mockResolvedValue(null),
    ensurePlanForConversation: vi.fn().mockResolvedValue(null),
  })),
}));

// --- Mock compact modules (used by default AIChatContextAssembler) -----
vi.mock("@/modules/AIChatSessionMemoryModule", () => ({
  AIChatSessionMemoryModule: vi.fn().mockImplementation(() => ({
    getByConversation: vi.fn().mockResolvedValue(null),
  })),
}));
vi.mock("@/modules/AIChatCompactModule", () => ({
  AIChatCompactModule: vi.fn().mockImplementation(() => ({
    getActiveSummary: vi.fn().mockResolvedValue(null),
  })),
}));

// --- Mock AiChatApi ----------------------------------------------------
vi.mock("@/api/aiChatApi", () => ({
  AiChatApi: vi.fn().mockImplementation(() => ({})),
}));

// --- Mock SkillRegistry ------------------------------------------------
vi.mock("@/config/skillsRegistry", () => ({
  SkillRegistry: {
    getAllToolFunctions: vi.fn().mockResolvedValue([]),
    getSkill: vi.fn().mockReturnValue(undefined),
  },
}));

// --- Mock SkillExecutor ------------------------------------------------
vi.mock("@/service/SkillExecutor", () => ({
  SkillExecutor: { execute: vi.fn() },
}));

// --- Mock Token --------------------------------------------------------
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn().mockReturnValue("true"),
  })),
}));

// --- Mock usersetting --------------------------------------------------
vi.mock("@/config/usersetting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/usersetting")>();
  return { ...actual };
});

/**
 * Create an engine backed by a fake loop whose `run()` returns the given
 * result.  The fakeRun callback can also inspect the loop input.
 */
function createEngineWithFakeLoop(
  fakeRun: (input: AIChatQueryLoopInput) => Promise<AIChatQueryLoopResult>
): AIChatQueryEngine {
  const fakeLoop = {
    run: fakeRun,
  } as unknown as AIChatQueryLoop;
  return new AIChatQueryEngine(fakeLoop);
}

/** Collect event types emitted into a sink. */
function makeEventCollector(): {
  sink: { emit: (e: AIChatQueryEvent) => void };
  events: AIChatQueryEvent[];
} {
  const events: AIChatQueryEvent[] = [];
  return {
    sink: { emit: (e: AIChatQueryEvent) => events.push(e) },
    events,
  };
}

describe("AIChatQueryEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("submitMessage", () => {
    it("saves user message before calling the loop", async () => {
      const fakeRun = vi.fn().mockResolvedValue({
        type: "completed" as const,
        conversationId: "v2-test-conv",
        assistantMessageId: "assistant-test",
        fullContent: "",
        finishReason: "stop",
      });
      const engine = createEngineWithFakeLoop(fakeRun);
      const { sink, events } = makeEventCollector();

      await engine.submitMessage({
        request: { message: "hello" },
        eventSink: sink,
      });

      // User message saved with the correct content.
      expect(mockSaveUserMessage).toHaveBeenCalledWith(
        expect.objectContaining({ content: "hello" })
      );
      // Loop was called.
      expect(fakeRun).toHaveBeenCalledOnce();
      // Events include start and complete.
      expect(events.map((e) => e.type)).toContain("start");
      expect(events.map((e) => e.type)).toContain("complete");
    });

    it("emits start event before loop runs", async () => {
      const callOrder: string[] = [];
      const fakeRun = vi
        .fn()
        .mockImplementation(async (input: AIChatQueryLoopInput) => {
          callOrder.push("loop-run");
          input.eventSink.emit({
            type: "token",
            conversationId: input.conversationId,
            messageId: input.assistantMessageId,
            contentDelta: "hi",
          });
          return {
            type: "completed" as const,
            conversationId: input.conversationId,
            assistantMessageId: input.assistantMessageId,
            fullContent: "hi",
            finishReason: "stop",
          };
        });

      const engine = createEngineWithFakeLoop(fakeRun);
      const { sink, events } = makeEventCollector();

      await engine.submitMessage({
        request: { message: "hello" },
        eventSink: {
          emit: (e) => {
            events.push(e);
            if (e.type === "start") callOrder.push("start-emitted");
          },
        },
      });

      // start event should have been emitted before the loop was called.
      const startIndex = callOrder.indexOf("start-emitted");
      const loopIndex = callOrder.indexOf("loop-run");
      expect(startIndex).toBeLessThan(loopIndex);
    });

    it("emits complete event when loop returns completed", async () => {
      const fakeRun = vi.fn().mockResolvedValue({
        type: "completed" as const,
        conversationId: "v2-test-conv",
        assistantMessageId: "assistant-test",
        fullContent: "Hello!",
        finishReason: "stop",
        model: "gpt-4",
      });
      const engine = createEngineWithFakeLoop(fakeRun);
      const { sink, events } = makeEventCollector();

      await engine.submitMessage({
        request: { message: "hello" },
        eventSink: sink,
      });

      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent).toBeDefined();
      if (completeEvent && completeEvent.type === "complete") {
        expect(completeEvent.fullContent).toBe("Hello!");
        expect(completeEvent.model).toBe("gpt-4");
      }
    });

    it("saves assistant message when loop completes with content", async () => {
      const fakeRun = vi.fn().mockResolvedValue({
        type: "completed" as const,
        conversationId: "v2-test-conv",
        assistantMessageId: "assistant-test",
        fullContent: "response text",
        finishReason: "stop",
        model: "gpt-4",
        responseId: "resp-123",
      });
      const engine = createEngineWithFakeLoop(fakeRun);
      const { sink } = makeEventCollector();

      await engine.submitMessage({
        request: { message: "hello" },
        eventSink: sink,
      });

      expect(mockSaveAssistantMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "response text",
          model: "gpt-4",
        })
      );
    });

    it("persists tool call and tool result events for history reload", async () => {
      const fakeRun = vi
        .fn()
        .mockImplementation(async (input: AIChatQueryLoopInput) => {
          input.eventSink.emit({
            type: "tool_call",
            conversationId: input.conversationId,
            messageId: input.assistantMessageId,
            toolCallId: "call-1",
            toolName: "get_time",
            toolArguments: { timezone: "UTC" },
          });
          input.eventSink.emit({
            type: "tool_result",
            conversationId: input.conversationId,
            messageId: input.assistantMessageId,
            toolCallId: "call-1",
            toolName: "get_time",
            fullContent: "{\"success\":true}",
            toolResult: { success: true, summary: "12:00 UTC" },
          });
          return {
            type: "completed" as const,
            conversationId: input.conversationId,
            assistantMessageId: input.assistantMessageId,
            fullContent: "It is noon.",
            finishReason: "stop",
          };
        });
      const engine = createEngineWithFakeLoop(fakeRun);
      const { sink } = makeEventCollector();

      await engine.submitMessage({
        request: { message: "what time is it?" },
        eventSink: sink,
      });

      expect(mockSaveToolCallMessage).toHaveBeenCalledWith({
        conversationId: "v2-test-conv",
        assistantMessageId: expect.stringMatching(/^assistant-/),
        toolCallId: "call-1",
        toolName: "get_time",
        toolArguments: { timezone: "UTC" },
      });
      expect(mockSaveToolResultMessage).toHaveBeenCalledWith({
        conversationId: "v2-test-conv",
        assistantMessageId: expect.stringMatching(/^assistant-/),
        toolCallId: "call-1",
        toolName: "get_time",
        content: "{\"success\":true}",
        toolResult: { success: true, summary: "12:00 UTC" },
        replacesPermissionPromptForToolId: undefined,
      });
    });

    it("emits error event when loop returns failed", async () => {
      const fakeRun = vi.fn().mockResolvedValue({
        type: "failed" as const,
        conversationId: "v2-test-conv",
        assistantMessageId: "assistant-test",
        error: new Error("stream broke"),
        partialContent: "",
      });
      const engine = createEngineWithFakeLoop(fakeRun);
      const { sink, events } = makeEventCollector();

      await engine.submitMessage({
        request: { message: "hello" },
        eventSink: sink,
      });

      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      if (errorEvent && errorEvent.type === "error") {
        expect(errorEvent.errorMessage).toBeDefined();
      }
    });

    it("emits error when pre-stream setup throws", async () => {
      mockCreateConversationIfNeeded.mockImplementationOnce(() => {
        throw new Error("DB locked");
      });
      const fakeRun = vi.fn();
      const engine = createEngineWithFakeLoop(fakeRun);
      const { sink, events } = makeEventCollector();

      await engine.submitMessage({
        request: { message: "hello" },
        eventSink: sink,
      });

      // Loop should not have been called.
      expect(fakeRun).not.toHaveBeenCalled();
      // Error event should have been emitted.
      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
    });
  });

  describe("stopActiveTurn", () => {
    it("does not throw when no active turn exists", () => {
      const fakeRun = vi.fn();
      const engine = createEngineWithFakeLoop(fakeRun);
      expect(() => engine.stopActiveTurn()).not.toThrow();
    });

    it("emits cancelled for pending permission turn", async () => {
      // The fake loop returns paused_for_permission using the same eventSink
      // it received in the input, so stopActiveTurn emits to the same sink.
      const fakeRun = vi
        .fn()
        .mockImplementation(async (input: AIChatQueryLoopInput) => ({
          type: "paused_for_permission" as const,
          pending: {
            conversationId: input.conversationId,
            assistantMessageId: input.assistantMessageId,
            conversationMessages: [],
            abortController: input.abortController,
            request: input.request,
            openAITools: input.openAITools,
            nextRound: 1,
            toolCallId: "call-1",
            toolName: "scrape",
            toolArguments: {},
            eventSink: input.eventSink,
          },
        }));
      const engine = createEngineWithFakeLoop(fakeRun);
      const { sink, events } = makeEventCollector();

      await engine.submitMessage({
        request: { message: "hi" },
        eventSink: sink,
      });

      // After pause, stop the turn. The engine emits cancelled through
      // the pending turn's eventSink (same sink passed to submitMessage).
      engine.stopActiveTurn();

      const cancelled = events.find((e) => e.type === "cancelled");
      expect(cancelled).toBeDefined();
    });
  });

  describe("resumeToolAfterPermission", () => {
    it("returns ok:false when no pending permission exists", async () => {
      const fakeRun = vi.fn();
      const engine = createEngineWithFakeLoop(fakeRun);
      const result = await engine.resumeToolAfterPermission({
        toolId: "call-1",
        conversationId: "v2-test",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});

describe("AIChatQueryEngine context assembly", () => {
  it("delegates message building to the context assembler", async () => {
    const captured: OpenAIChatMessage[][] = [];
    const fakeAssembler = {
      assemble: vi.fn(async (input: unknown) => {
        const msgs: OpenAIChatMessage[] = [
          { role: "system", content: "custom-sysp" },
          {
            role: "user",
            content: (input as { currentUserMessage: string })
              .currentUserMessage,
          },
        ];
        captured.push(msgs);
        return {
          messages: msgs,
          tokenEstimate: 10,
          usedSessionMemory: false,
          usedFullCompact: false,
          compactTriggered: false,
          warnings: [],
        };
      }),
    };
    const engine = new AIChatQueryEngine(
      {
        run: vi.fn().mockResolvedValue({
          type: "completed",
          conversationId: "v2-test-conv",
          assistantMessageId: "assistant-1",
          fullContent: "ok",
          finishReason: "stop",
          model: "m",
        }),
      } as unknown as AIChatQueryLoop,
      {
        contextAssembler: fakeAssembler as unknown as AIChatContextAssembler,
      }
    );
    const { sink } = makeEventCollector();
    await engine.submitMessage({
      request: { message: "hi" },
      eventSink: sink,
    });

    expect(fakeAssembler.assemble).toHaveBeenCalledTimes(1);
    expect(captured[0]).toEqual([
      { role: "system", content: "custom-sysp" },
      { role: "user", content: "hi" },
    ]);
  });
});

describe("AIChatQueryEngine compact integration", () => {
  it("enqueues session memory update after a completed turn", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const fakeAgent = { enqueueSessionMemoryUpdate: enqueue };
    const engine = new AIChatQueryEngine(
      {
        run: vi.fn().mockResolvedValue({
          type: "completed",
          conversationId: "v2-test-conv",
          assistantMessageId: "assistant-1",
          fullContent: "ok",
          finishReason: "stop",
        }),
      } as unknown as AIChatQueryLoop,
      {
        contextAssembler: {
          assemble: vi.fn().mockResolvedValue({
            messages: [{ role: "system", content: "x" }],
            tokenEstimate: 0,
            usedSessionMemory: false,
            usedFullCompact: false,
            compactTriggered: false,
            warnings: [],
          }),
        } as unknown as AIChatContextAssembler,
        compactAgent: fakeAgent as unknown as AIChatCompactAgentService,
      }
    );
    const { sink } = makeEventCollector();
    await engine.submitMessage({
      request: { message: "hi" },
      eventSink: sink,
    });

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toEqual({
      conversationId: "v2-test-conv",
      reason: "assistant_turn_completed",
    });
  });

  it("does not enqueue after a cancelled turn", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const fakeAgent = { enqueueSessionMemoryUpdate: enqueue };
    const engine = new AIChatQueryEngine(
      {
        run: vi.fn().mockResolvedValue({
          type: "cancelled",
          conversationId: "v2-test-conv",
          assistantMessageId: "assistant-1",
          partialContent: "",
        }),
      } as unknown as AIChatQueryLoop,
      {
        contextAssembler: {
          assemble: vi.fn().mockResolvedValue({
            messages: [{ role: "system", content: "x" }],
            tokenEstimate: 0,
            usedSessionMemory: false,
            usedFullCompact: false,
            compactTriggered: false,
            warnings: [],
          }),
        } as unknown as AIChatContextAssembler,
        compactAgent: fakeAgent as unknown as AIChatCompactAgentService,
      }
    );
    const { sink } = makeEventCollector();
    await engine.submitMessage({
      request: { message: "hi" },
      eventSink: sink,
    });

    expect(enqueue).not.toHaveBeenCalled();
  });
});
