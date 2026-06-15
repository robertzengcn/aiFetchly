// test/vitest/main/service/AIChatQueryEngine.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";
import type {
  AIChatQueryLoop,
  AIChatQueryLoopDeps,
} from "@/service/AIChatQueryLoop";
import type {
  AIChatQueryEvent,
  AIChatQueryLoopInput,
  AIChatQueryLoopResult,
} from "@/service/AIChatQueryEvents";

// --- Mock AIChatV2Module -----------------------------------------------
const mockSaveUserMessage = vi
  .fn()
  .mockResolvedValue({ messageId: "user-1" });
const mockGetConversationMessages = vi.fn().mockResolvedValue([]);
const mockSaveAssistantMessage = vi.fn().mockResolvedValue({});
const mockCreateConversationIfNeeded = vi.fn().mockReturnValue("v2-test-conv");
const mockGetDefaultSystemPrompt = vi.fn().mockReturnValue("You are helpful.");

vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(() => ({
    saveUserMessage: mockSaveUserMessage,
    getConversationMessages: mockGetConversationMessages,
    saveAssistantMessage: mockSaveAssistantMessage,
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
  const actual =
    await importOriginal<typeof import("@/config/usersetting")>();
  return { ...actual };
});

/**
 * Create an engine backed by a fake loop whose `run()` returns the given
 * result.  The fakeRun callback can also inspect the loop input.
 */
function createEngineWithFakeLoop(
  fakeRun: (
    input: AIChatQueryLoopInput
  ) => Promise<AIChatQueryLoopResult>
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
      const fakeRun = vi.fn().mockImplementation(
        async (input: AIChatQueryLoopInput) => {
          callOrder.push("loop-run");
          input.eventSink.emit({
            type: "token",
            conversationId: input.conversationId,
            messageId: input.assistantMessageId,
            contentDelta: "hi",
          });
          return {
            type: "completed" as const,
            fullContent: "hi",
            finishReason: "stop",
          };
        }
      );

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

    it("emits error event when loop returns failed", async () => {
      const fakeRun = vi.fn().mockResolvedValue({
        type: "failed" as const,
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
      // First, run the engine so it pauses for permission.
      const fakeRun = vi.fn().mockResolvedValue({
        type: "paused_for_permission" as const,
        pending: {
          conversationId: "v2-test-conv",
          assistantMessageId: "a-1",
          conversationMessages: [],
          abortController: new AbortController(),
          request: { message: "hi" },
          openAITools: [],
          nextRound: 1,
          toolCallId: "call-1",
          toolName: "scrape",
          toolArguments: {},
          eventSink: { emit: vi.fn() },
        },
      });
      const engine = createEngineWithFakeLoop(fakeRun);
      const { sink } = makeEventCollector();

      await engine.submitMessage({
        request: { message: "hi" },
        eventSink: sink,
      });

      // Verify pending permission exists.
      expect(engine.getPendingPermission()).not.toBeNull();

      // Replace the pending eventSink with our collector so we can verify.
      const pending = engine.getPendingPermission();
      if (pending) {
        const { sink: cancelSink, events: cancelEvents } =
          makeEventCollector();
        pending.eventSink = cancelSink;

        engine.stopActiveTurn();

        const cancelled = cancelEvents.find((e) => e.type === "cancelled");
        expect(cancelled).toBeDefined();
      }

      // After stop, pending should be null.
      expect(engine.getPendingPermission()).toBeNull();
    });
  });

  describe("pending state accessors", () => {
    it("returns null when no pending permission", () => {
      const fakeRun = vi.fn();
      const engine = createEngineWithFakeLoop(fakeRun);
      expect(engine.getPendingPermission()).toBeNull();
      expect(engine.getPendingPlanQuestion()).toBeNull();
    });
  });
});
