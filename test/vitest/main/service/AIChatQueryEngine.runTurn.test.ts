// test/vitest/main/service/AIChatQueryEngine.runTurn.test.ts
//
// P0 baseline for the generator-streaming PRD: pins the segment-outcome
// contract of the engine's queue-dispatch entry point before Stage A reuses
// it for every owner (PRD §10 P0 exit gate — "every segment outcome has a
// test owner"). Stage A Task A1 extends this file with runTurn() coverage.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";
import type { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type {
  AIChatQueryEvent,
  AIChatQueryLoopInput,
  AIChatQueryLoopResult,
} from "@/service/AIChatQueryEvents";
import type { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";

// --- Mock AIChatV2Module -----------------------------------------------
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
  AIChatV2Module: vi.fn().mockImplementation(() => ({
    getConversationMessages: mockGetConversationMessages,
    saveUserMessage: mockSaveUserMessage,
    saveAssistantMessage: mockSaveAssistantMessage,
    saveToolCallMessage: mockSaveToolCallMessage,
    saveToolResultMessage: mockSaveToolResultMessage,
    createConversationIfNeeded: mockCreateConversationIfNeeded,
    getDefaultSystemPrompt: mockGetDefaultSystemPrompt,
  })),
}));

vi.mock("@/modules/AIChatAttachmentModule", () => ({
  AIChatAttachmentModule: vi.fn().mockImplementation(() => ({
    saveUploadedFiles: vi.fn().mockResolvedValue(undefined),
  })),
}));

const mockGetPlanState = vi.fn().mockResolvedValue(null);
vi.mock("@/modules/AIChatPlanModule", () => ({
  AIChatPlanModule: vi.fn().mockImplementation(() => ({
    getPlanState: mockGetPlanState,
    getPlanStateByPlanId: vi.fn().mockResolvedValue(null),
    saveQuestion: vi.fn().mockResolvedValue(undefined),
    submitPlanForApproval: vi.fn().mockResolvedValue(undefined),
    answerQuestion: vi.fn().mockResolvedValue({
      question: { questionId: "q-1" },
      planState: null,
    }),
    ensurePlanForConversation: vi.fn().mockResolvedValue(null),
    cancelDraft: vi.fn().mockResolvedValue(undefined),
  })),
}));

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
vi.mock("@/modules/AgentDefinitionModule", () => ({
  AgentDefinitionModule: vi.fn().mockImplementation(() => ({
    listActiveForRuntime: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock("@/api/aiChatApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/aiChatApi")>();
  return { ...actual, AiChatApi: vi.fn().mockImplementation(() => ({})) };
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
  Token: vi.fn().mockImplementation(() => ({ getValue: vi.fn() })),
}));

function createEngineWithFakeLoop(
  fakeRun: (input: AIChatQueryLoopInput) => Promise<AIChatQueryLoopResult>
): AIChatQueryEngine {
  const fakeLoop = { run: fakeRun } as unknown as AIChatQueryLoop;
  return new AIChatQueryEngine(fakeLoop);
}

function makeEventCollector(): {
  sink: { emit: (e: AIChatQueryEvent) => void };
  events: AIChatQueryEvent[];
} {
  const events: AIChatQueryEvent[] = [];
  return { sink: { emit: (e) => events.push(e) }, events };
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

describe("AIChatQueryEngine segment outcomes (P0 baseline)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlanState.mockResolvedValue(null);
    mockCreateConversationIfNeeded.mockImplementation((id: string) => id);
  });

  it("submitPersistedUserMessage returns the completed segment outcome", async () => {
    const engine = createEngineWithFakeLoop(async (input) => ({
      type: "completed",
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      fullContent: "done",
      finishReason: "stop",
    }));

    const outcome = await engine.submitPersistedUserMessage({
      eventSink: makeEventCollector().sink,
      request: { message: "queued msg", conversationId: "v2-A" },
      savedUser: makeSavedUser("v2-A", "user-pending-1"),
      modelContent: "queued msg",
      assistantMessageId: "assistant-pending-1",
    });

    expect(outcome).toEqual({
      type: "completed",
      conversationId: "v2-A",
      assistantMessageId: "assistant-pending-1",
    });
  });

  it("submitPersistedUserMessage returns paused_for_permission and parks the pending turn", async () => {
    const engine = createEngineWithFakeLoop((input) =>
      Promise.resolve({
        type: "paused_for_permission",
        pending: {
          conversationId: input.conversationId,
          assistantMessageId: input.assistantMessageId,
          conversationMessages: [],
          abortController: new AbortController(),
          request: input.request,
          openAITools: [],
          nextRound: 1,
          toolCallId: "tool-1",
          toolName: "test_tool",
          toolArguments: {},
          eventSink: { emit: () => undefined },
        },
      })
    );

    const outcome = await engine.submitPersistedUserMessage({
      eventSink: makeEventCollector().sink,
      request: { message: "needs approval", conversationId: "v2-A" },
      savedUser: makeSavedUser("v2-A", "user-pending-2"),
      modelContent: "needs approval",
      assistantMessageId: "assistant-pending-2",
    });

    expect(outcome).toEqual({
      type: "paused_for_permission",
      conversationId: "v2-A",
      assistantMessageId: "assistant-pending-2",
    });
    expect(engine.getConversationRuntimeStatus("v2-A")).toBe(
      "awaiting_permission"
    );
  });

  it("submitPersistedUserMessage returns conversation_busy when a turn already owns the conversation", async () => {
    let releaseFirst!: (value: AIChatQueryLoopResult) => void;
    const firstRun = new Promise<AIChatQueryLoopResult>((resolve) => {
      releaseFirst = resolve;
    });
    const engine = createEngineWithFakeLoop(() => firstRun);

    const first = engine.submitPersistedUserMessage({
      eventSink: makeEventCollector().sink,
      request: { message: "first", conversationId: "v2-A" },
      savedUser: makeSavedUser("v2-A", "user-pending-3"),
      modelContent: "first",
      assistantMessageId: "assistant-pending-3",
    });
    await vi.waitFor(() =>
      expect(engine.getConversationRuntimeStatus("v2-A")).toBe("running")
    );

    const second = await engine.submitPersistedUserMessage({
      eventSink: makeEventCollector().sink,
      request: { message: "second", conversationId: "v2-A" },
      savedUser: makeSavedUser("v2-A", "user-pending-4"),
      modelContent: "second",
      assistantMessageId: "assistant-pending-4",
    });
    expect(second.type).toBe("conversation_busy");

    releaseFirst({
      type: "completed",
      conversationId: "v2-A",
      assistantMessageId: "assistant-pending-3",
      fullContent: "",
      finishReason: "stop",
    });
    await expect(first).resolves.toMatchObject({ type: "completed" });
  });
});

describe("AIChatQueryEngine.runTurn (Stage A1 — PRD FR-022)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlanState.mockResolvedValue(null);
    mockCreateConversationIfNeeded.mockImplementation((id: string) => id);
  });

  it("runTurn returns the terminal outcome that submitMessage used to swallow", async () => {
    const engine = createEngineWithFakeLoop(async (input) => ({
      type: "completed",
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      fullContent: "hi",
      finishReason: "stop",
    }));

    const outcome = await engine.runTurn({
      request: { message: "hello", conversationId: "v2-A" },
      eventSink: makeEventCollector().sink,
    });

    expect(outcome).toEqual({
      type: "completed",
      conversationId: "v2-A",
      assistantMessageId: expect.any(String),
    });
  });

  it("submitMessage stays a void wrapper and surfaces busy as an error event", async () => {
    let releaseFirst!: (value: AIChatQueryLoopResult) => void;
    const firstRun = new Promise<AIChatQueryLoopResult>((resolve) => {
      releaseFirst = resolve;
    });
    const engine = createEngineWithFakeLoop(() => firstRun);

    const first = engine.submitMessage({
      request: { message: "first", conversationId: "v2-A" },
      eventSink: makeEventCollector().sink,
    });
    await vi.waitFor(() =>
      expect(engine.getConversationRuntimeStatus("v2-A")).toBe("running")
    );

    const secondSink = makeEventCollector();
    await engine.submitMessage({
      request: { message: "second", conversationId: "v2-A" },
      eventSink: secondSink.sink,
    });
    const busyError = secondSink.events.find((e) => e.type === "error");
    expect(busyError).toBeTruthy();

    releaseFirst({
      type: "completed",
      conversationId: "v2-A",
      assistantMessageId: "assistant-first",
      fullContent: "",
      finishReason: "stop",
    });
    await first;
  });
});
