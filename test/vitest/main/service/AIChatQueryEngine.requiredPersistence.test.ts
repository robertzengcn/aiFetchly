// test/vitest/main/service/AIChatQueryEngine.requiredPersistence.test.ts
//
// Stage A2 (generator-streaming PRD FR-006/007, AC-02/AC-08): required
// tool-call/tool-result persistence is strict — a failed save prevents
// dependent execution, publishes a classified failure, and is never retried
// as a transient provider error.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";
import type { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type {
  AIChatQueryEvent,
  AIChatQueryLoopInput,
  AIChatQueryLoopResult,
} from "@/service/AIChatQueryEvents";
import { AIChatRequiredPersistenceError } from "@/service/AIChatQueryEvents";
import { isContentLevelTransientError } from "@/service/AIChatErrorMapper";
import type { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";

const mockGetConversationMessages = vi.fn().mockResolvedValue([]);
const mockSaveUserMessage = vi.fn().mockResolvedValue({ messageId: "user-1" });
const mockSaveAssistantMessage = vi.fn().mockResolvedValue({});
const mockSaveToolCallMessage = vi.fn().mockResolvedValue({});
const mockSaveToolResultMessage = vi.fn().mockResolvedValue({});
const mockCreateConversationIfNeeded = vi
  .fn()
  .mockImplementation((id: string) => id);
const mockGetDefaultSystemPrompt = vi.fn().mockReturnValue("You are helpful.");

vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(function () {
    return {
    getConversationMessages: mockGetConversationMessages,
    getRecentMessages: vi.fn().mockResolvedValue([]),
    saveUserMessage: mockSaveUserMessage,
    saveAssistantMessage: mockSaveAssistantMessage,
    saveToolCallMessage: mockSaveToolCallMessage,
    saveToolResultMessage: mockSaveToolResultMessage,
    createConversationIfNeeded: mockCreateConversationIfNeeded,
    getDefaultSystemPrompt: mockGetDefaultSystemPrompt,
    };
  }),
}));

vi.mock("@/modules/AIChatAttachmentModule", () => ({
  AIChatAttachmentModule: vi.fn().mockImplementation(function () {
    return {
    saveUploadedFiles: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock("@/modules/AIChatPlanModule", () => ({
  AIChatPlanModule: vi.fn().mockImplementation(function () {
    return {
    getPlanState: vi.fn().mockResolvedValue(null),
    getPlanStateByPlanId: vi.fn().mockResolvedValue(null),
    saveQuestion: vi.fn().mockResolvedValue(undefined),
    submitPlanForApproval: vi.fn().mockResolvedValue(undefined),
    answerQuestion: vi.fn().mockResolvedValue({
      question: { questionId: "q-1" },
      planState: null,
    }),
    ensurePlanForConversation: vi.fn().mockResolvedValue(null),
    cancelDraft: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock("@/modules/AIChatSessionMemoryModule", () => ({
  AIChatSessionMemoryModule: vi.fn().mockImplementation(function () {
    return {
    getByConversation: vi.fn().mockResolvedValue(null),
    };
  }),
}));
vi.mock("@/modules/AIChatCompactModule", () => ({
  AIChatCompactModule: vi.fn().mockImplementation(function () {
    return {
    getActiveSummary: vi.fn().mockResolvedValue(null),
    };
  }),
}));
vi.mock("@/modules/AgentDefinitionModule", () => ({
  AgentDefinitionModule: vi.fn().mockImplementation(function () {
    return {
    listActiveForRuntime: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock("@/api/aiChatApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/aiChatApi")>();
  return {
    ...actual,
    AiChatApi: vi.fn().mockImplementation(function () {
      return {};
    }),
  };
});

vi.mock("@/service/DesktopNotifyService", () => ({
  DesktopNotifyService: {
    getInstance: () => ({ show: vi.fn().mockResolvedValue(false) }),
  },
}));

vi.mock("@/config/skillsRegistry", () => ({
  SkillRegistry: {
    getAllToolFunctions: vi.fn().mockResolvedValue([]),
    getSkill: vi.fn().mockReturnValue(undefined),
  },
}));
vi.mock("@/service/SkillExecutor", () => ({
  SkillExecutor: { execute: vi.fn() },
}));
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(function () {
    return { getValue: vi.fn() };
  }),
}));

function makeEventCollector(): {
  sink: { emit: (e: AIChatQueryEvent) => void };
  events: AIChatQueryEvent[];
} {
  const events: AIChatQueryEvent[] = [];
  return { sink: { emit: (e) => events.push(e) }, events };
}

/**
 * Fake loop that mirrors the REAL AIChatQueryLoop tool contract: emit
 * tool_call -> await eventSink.flush() -> execute the tool -> emit
 * tool_result -> await flush -> completed. A flush rejection propagates to
 * the failed result exactly as runOnce's catch produces it.
 */
function makeToolLoop(options: {
  onToolStart?: () => void;
}): (input: AIChatQueryLoopInput) => Promise<AIChatQueryLoopResult> {
  return async (input) => {
    try {
      input.eventSink.emit({
        type: "tool_call",
        conversationId: input.conversationId,
        messageId: input.assistantMessageId,
        toolCallId: "tc-strict-1",
        toolName: "test_tool",
        toolArguments: { a: 1 },
      });
      await input.eventSink.flush?.();
      options.onToolStart?.();
      input.eventSink.emit({
        type: "tool_result",
        conversationId: input.conversationId,
        messageId: input.assistantMessageId,
        toolCallId: "tc-strict-1",
        toolName: "test_tool",
        fullContent: "ok",
        toolResult: { success: true },
      });
      await input.eventSink.flush?.();
      return {
        type: "completed",
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        fullContent: "done",
        finishReason: "stop",
      };
    } catch (error) {
      return {
        type: "failed",
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        error,
        partialContent: "",
      };
    }
  };
}

function makeEngine(
  fakeRun: (input: AIChatQueryLoopInput) => Promise<AIChatQueryLoopResult>
): AIChatQueryEngine {
  const fakeLoop = { run: fakeRun } as unknown as AIChatQueryLoop;
  return new AIChatQueryEngine(fakeLoop);
}

function makeSavedUser(
  conversationId: string,
  messageId: string
): AIChatMessageEntity {
  return {
    messageId,
    conversationId,
    content: "queued",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as AIChatMessageEntity;
}

describe("AIChatQueryEngine strict required persistence (Stage A2, FR-006)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConversationMessages.mockResolvedValue([]);
    mockCreateConversationIfNeeded.mockImplementation((id: string) => id);
    mockSaveToolCallMessage.mockResolvedValue({});
    mockSaveToolResultMessage.mockResolvedValue({});
  });

  it("a failed tool-call save prevents tool execution and publishes tool_call_persist_failed (AC-02)", async () => {
    mockSaveToolCallMessage.mockRejectedValue(new Error("db locked"));
    let toolStarted = false;
    const collector = makeEventCollector();
    const engine = makeEngine(makeToolLoop({ onToolStart: () => (toolStarted = true) }));

    const outcome = await engine.submitPersistedUserMessage({
      eventSink: collector.sink,
      request: { message: "run tool", conversationId: "v2-strict" },
      savedUser: makeSavedUser("v2-strict", "user-1"),
      modelContent: "run tool",
      assistantMessageId: "assistant-strict-1",
    });

    expect(outcome.type).toBe("failed");
    expect(toolStarted).toBe(false);
    const errorEvent = collector.events.find(
      (e) => e.type === "error"
    ) as { errorCode?: string; toolCallId?: string } | undefined;
    expect(errorEvent?.errorCode).toBe("tool_call_persist_failed");
    expect(errorEvent?.toolCallId).toBe("tc-strict-1");
  });

  it("a failed tool-result save publishes tool_result_persist_failed and fails the segment (AC-08)", async () => {
    mockSaveToolResultMessage.mockRejectedValue(new Error("disk full"));
    const collector = makeEventCollector();
    const engine = makeEngine(makeToolLoop({}));

    const outcome = await engine.submitPersistedUserMessage({
      eventSink: collector.sink,
      request: { message: "run tool", conversationId: "v2-strict" },
      savedUser: makeSavedUser("v2-strict", "user-2"),
      modelContent: "run tool",
      assistantMessageId: "assistant-strict-2",
    });

    expect(outcome.type).toBe("failed");
    const errorEvent = collector.events.find(
      (e) => e.type === "error"
    ) as { errorCode?: string; toolCallId?: string } | undefined;
    expect(errorEvent?.errorCode).toBe("tool_result_persist_failed");
    expect(errorEvent?.toolCallId).toBe("tc-strict-1");
    // The tool DID run (its call was saved) — the failure is about the
    // result write, and the tool must never be re-run.
    expect(mockSaveToolCallMessage).toHaveBeenCalled();
  });

  it("a delayed tool-call save blocks tool execution until it settles (AC-02)", async () => {
    let resolveSave!: (value: unknown) => void;
    mockSaveToolCallMessage.mockImplementation(
      () =>
        new Promise<unknown>((resolve) => {
          resolveSave = resolve;
        })
    );
    let toolStarted = false;
    const collector = makeEventCollector();
    const engine = makeEngine(
      makeToolLoop({ onToolStart: () => (toolStarted = true) })
    );

    const outcomePromise = engine.submitPersistedUserMessage({
      eventSink: collector.sink,
      request: { message: "run tool", conversationId: "v2-strict" },
      savedUser: makeSavedUser("v2-strict", "user-3"),
      modelContent: "run tool",
      assistantMessageId: "assistant-strict-3",
    });
    // Let the loop reach its flush await.
    await new Promise((r) => setTimeout(r, 20));
    expect(toolStarted).toBe(false);

    resolveSave({});
    const outcome = await outcomePromise;
    expect(toolStarted).toBe(true);
    expect(outcome.type).toBe("completed");
  });

  it("persistence failures are not classified as transient provider errors (FR-011)", () => {
    const persistError = new AIChatRequiredPersistenceError(
      "tool_call_persist_failed",
      "tc-1",
      new Error("db locked")
    );
    expect(
      isContentLevelTransientError(persistError)
    ).toBe(false);
    expect(persistError.persistenceCode).toBe("tool_call_persist_failed");
    expect(persistError.toolCallId).toBe("tc-1");
    expect(persistError.name).toBe("AIChatRequiredPersistenceError");
  });
});
