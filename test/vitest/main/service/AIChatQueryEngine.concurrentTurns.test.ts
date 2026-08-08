// test/vitest/main/service/AIChatQueryEngine.concurrentTurns.test.ts
//
// Validates the per-concurrency refactor of AIChatQueryEngine: active turns
// are tracked in per-conversation Maps so a streaming turn in conversation A
// keeps running when conversation B sends a message, and a late terminal
// result for one conversation never clobbers another's (or a newer
// same-conversation turn's) state.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";
import type { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type {
  AIChatQueryEvent,
  AIChatQueryLoopInput,
  AIChatQueryLoopResult,
  PendingPermissionTurn,
} from "@/service/AIChatQueryEvents";
import { HookRegistry } from "@/service/hooks/HookRegistry";

// --- Mock AIChatV2Module -----------------------------------------------
const mockSaveUserMessage = vi.fn().mockResolvedValue({ messageId: "user-1" });
const mockGetConversationMessages = vi.fn().mockResolvedValue([]);
const mockSaveAssistantMessage = vi.fn().mockResolvedValue({});
const mockSaveToolCallMessage = vi.fn().mockResolvedValue({});
const mockSaveToolResultMessage = vi.fn().mockResolvedValue({});
// Passthrough so each request keeps its own conversationId (the default mock
// returns a single hard-coded id, which would collapse A and B into one).
const mockCreateConversationIfNeeded = vi
  .fn()
  .mockImplementation((id: string) => id);
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

vi.mock("@/modules/AIChatAttachmentModule", () => ({
  AIChatAttachmentModule: vi.fn().mockImplementation(() => ({
    saveUploadedFiles: vi.fn().mockResolvedValue(undefined),
  })),
}));

const mockGetPlanState = vi.fn().mockResolvedValue(null);
const mockEnsurePlanForConversation = vi.fn().mockResolvedValue(null);
vi.mock("@/modules/AIChatPlanModule", () => ({
  AIChatPlanModule: vi.fn().mockImplementation(() => ({
    getPlanState: mockGetPlanState,
    ensurePlanForConversation: mockEnsurePlanForConversation,
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
vi.mock("@/config/usersetting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/usersetting")>();
  return { ...actual };
});

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

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
} {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Fake loop behaviour that mirrors production: the turn resolves with the
 * deferred result, OR — if its abort controller fires first — resolves
 * `cancelled`. This lets stopActiveTurn tests observe the entry being cleared
 * via the loop's own cancelled path (as the real AIChatQueryLoop does).
 */
function abortableRun(
  input: AIChatQueryLoopInput,
  deferred: { promise: Promise<AIChatQueryLoopResult> }
): Promise<AIChatQueryLoopResult> {
  const signal = input.abortController.signal;
  const cancelled = (): AIChatQueryLoopResult => ({
    type: "cancelled",
    conversationId: input.conversationId,
    assistantMessageId: input.assistantMessageId,
    partialContent: "",
    model: "gpt-4",
  });
  if (signal.aborted) return Promise.resolve(cancelled());
  return new Promise<AIChatQueryLoopResult>((resolve) => {
    const onAbort = (): void => resolve(cancelled());
    signal.addEventListener("abort", onAbort, { once: true });
    deferred.promise.then((result) => {
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    });
  });
}

/** Minimal typed PendingPermissionTurn for paused_for_permission results. */
function makePendingPermission(
  conversationId: string,
  assistantMessageId: string
): PendingPermissionTurn {
  return {
    conversationId,
    assistantMessageId,
    conversationMessages: [],
    abortController: new AbortController(),
    request: { message: "pending", conversationId },
    openAITools: [],
    nextRound: 1,
    toolCallId: `tool-${assistantMessageId}`,
    toolName: "test_tool",
    toolArguments: {},
    eventSink: { emit: () => undefined },
  };
}

describe("AIChatQueryEngine concurrent turns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlanState.mockResolvedValue(null);
    mockEnsurePlanForConversation.mockResolvedValue(null);
    mockCreateConversationIfNeeded.mockImplementation((id: string) => id);
    HookRegistry.unregisterSource("plugin:test-hooks");
  });

  it("cancelled result for A does not clobber a concurrently-streaming B", async () => {
    const aDeferred = createDeferred<AIChatQueryLoopResult>();
    const bDeferred = createDeferred<AIChatQueryLoopResult>();
    const fakeRun = vi.fn((input: AIChatQueryLoopInput) =>
      abortableRun(
        input,
        input.conversationId === "v2-A" ? aDeferred : bDeferred
      )
    );
    const engine = createEngineWithFakeLoop(fakeRun);

    // Kick off A (deferred — its loop won't resolve until we trigger it).
    const aPromise = engine.submitMessage({
      request: { message: "goal A", conversationId: "v2-A" },
      eventSink: makeEventCollector().sink,
    });
    await vi.waitFor(() => expect(fakeRun).toHaveBeenCalledTimes(1));

    // Kick off B while A is still streaming.
    const bPromise = engine.submitMessage({
      request: { message: "hello B", conversationId: "v2-B" },
      eventSink: makeEventCollector().sink,
    });
    await vi.waitFor(() => expect(fakeRun).toHaveBeenCalledTimes(2));

    expect(engine.getConversationRuntimeStatus("v2-A")).toBe("running");
    expect(engine.getConversationRuntimeStatus("v2-B")).toBe("running");

    // A cancels while B is still streaming.
    aDeferred.resolve({
      type: "cancelled",
      conversationId: "v2-A",
      assistantMessageId: "assistant-A",
      partialContent: "",
      model: "gpt-4",
    });
    await aPromise;

    // THE BUG: previously handleLoopResult(cancelled) called
    // clearActiveTurnState() with no argument and wiped B's state too.
    expect(engine.getConversationRuntimeStatus("v2-A")).toBe("idle");
    expect(engine.getConversationRuntimeStatus("v2-B")).toBe("running");

    // Finish B normally.
    bDeferred.resolve({
      type: "completed",
      conversationId: "v2-B",
      assistantMessageId: "assistant-B",
      fullContent: "B done",
      finishReason: "stop",
      model: "gpt-4",
    });
    await bPromise;
    expect(engine.getConversationRuntimeStatus("v2-B")).toBe("idle");
  });

  it("same-conversation re-send aborts the prior turn but not its successor", async () => {
    const firstDeferred = createDeferred<AIChatQueryLoopResult>();
    const secondDeferred = createDeferred<AIChatQueryLoopResult>();
    const captured: AbortController[] = [];
    let callCount = 0;
    // NOTE: deliberately NOT abort-aware — we control exactly when the stale
    // first turn resolves so we can assert the assistantMessageId guard.
    const fakeRun = vi.fn((input: AIChatQueryLoopInput) => {
      captured.push(input.abortController);
      callCount += 1;
      return callCount === 1 ? firstDeferred.promise : secondDeferred.promise;
    });
    const engine = createEngineWithFakeLoop(fakeRun);

    const firstSubmit = engine.submitMessage({
      request: { message: "A1", conversationId: "v2-A" },
      eventSink: makeEventCollector().sink,
    });
    await vi.waitFor(() => expect(fakeRun).toHaveBeenCalledTimes(1));

    void engine.submitMessage({
      request: { message: "A2", conversationId: "v2-A" },
      eventSink: makeEventCollector().sink,
    });
    await vi.waitFor(() => expect(fakeRun).toHaveBeenCalledTimes(2));

    // The first turn's controller was aborted; the second's was not.
    expect(captured[0].signal.aborted).toBe(true);
    expect(captured[1].signal.aborted).toBe(false);
    // Exactly one active turn for A.
    expect(engine.getConversationRuntimeStatus("v2-A")).toBe("running");

    // The stale first turn now resolves cancelled. It must NOT delete the
    // second turn's entry (assistantMessageId guard in clearActiveTurnState).
    firstDeferred.resolve({
      type: "cancelled",
      conversationId: "v2-A",
      assistantMessageId: "assistant-first",
      partialContent: "",
      model: "gpt-4",
    });
    await firstSubmit; // wait for the stale turn's full post-loop cleanup

    // The second turn is still the active one.
    expect(engine.getConversationRuntimeStatus("v2-A")).toBe("running");

    // Cleanup: resolve the second turn to avoid a dangling promise.
    secondDeferred.resolve({
      type: "completed",
      conversationId: "v2-A",
      assistantMessageId: "assistant-second",
      fullContent: "",
      finishReason: "stop",
      model: "gpt-4",
    });
  });

  it("stopActiveTurn(conversationId) stops one turn and leaves others running", async () => {
    const aDeferred = createDeferred<AIChatQueryLoopResult>();
    const bDeferred = createDeferred<AIChatQueryLoopResult>();
    const fakeRun = vi.fn((input: AIChatQueryLoopInput) =>
      abortableRun(
        input,
        input.conversationId === "v2-A" ? aDeferred : bDeferred
      )
    );
    const engine = createEngineWithFakeLoop(fakeRun);

    void engine.submitMessage({
      request: { message: "A", conversationId: "v2-A" },
      eventSink: makeEventCollector().sink,
    });
    await vi.waitFor(() => expect(fakeRun).toHaveBeenCalledTimes(1));
    void engine.submitMessage({
      request: { message: "B", conversationId: "v2-B" },
      eventSink: makeEventCollector().sink,
    });
    await vi.waitFor(() => expect(fakeRun).toHaveBeenCalledTimes(2));

    engine.stopActiveTurn("v2-A");

    // A's controller is aborted; A resolves cancelled and is cleared. B keeps
    // running untouched.
    await vi.waitFor(() =>
      expect(engine.getConversationRuntimeStatus("v2-A")).toBe("idle")
    );
    expect(engine.getConversationRuntimeStatus("v2-B")).toBe("running");

    // Cleanup: finish B.
    bDeferred.resolve({
      type: "completed",
      conversationId: "v2-B",
      assistantMessageId: "assistant-B",
      fullContent: "",
      finishReason: "stop",
      model: "gpt-4",
    });
  });

  it("stopActiveTurn() with no argument stops every active turn", async () => {
    const aDeferred = createDeferred<AIChatQueryLoopResult>();
    const bDeferred = createDeferred<AIChatQueryLoopResult>();
    const fakeRun = vi.fn((input: AIChatQueryLoopInput) =>
      abortableRun(
        input,
        input.conversationId === "v2-A" ? aDeferred : bDeferred
      )
    );
    const engine = createEngineWithFakeLoop(fakeRun);

    void engine.submitMessage({
      request: { message: "A", conversationId: "v2-A" },
      eventSink: makeEventCollector().sink,
    });
    await vi.waitFor(() => expect(fakeRun).toHaveBeenCalledTimes(1));
    void engine.submitMessage({
      request: { message: "B", conversationId: "v2-B" },
      eventSink: makeEventCollector().sink,
    });
    await vi.waitFor(() => expect(fakeRun).toHaveBeenCalledTimes(2));

    engine.stopActiveTurn();

    // Both controllers abort; both loops resolve cancelled and clear.
    await vi.waitFor(() =>
      expect(engine.getConversationRuntimeStatus("v2-A")).toBe("idle")
    );
    await vi.waitFor(() =>
      expect(engine.getConversationRuntimeStatus("v2-B")).toBe("idle")
    );
  });

  it("permission pause in one conversation does not disturb another", async () => {
    const bDeferred = createDeferred<AIChatQueryLoopResult>();
    const fakeRun = vi.fn((input: AIChatQueryLoopInput) => {
      if (input.conversationId === "v2-A") {
        return Promise.resolve({
          type: "paused_for_permission" as const,
          conversationId: "v2-A",
          assistantMessageId: input.assistantMessageId,
          pending: makePendingPermission("v2-A", input.assistantMessageId),
        });
      }
      return abortableRun(input, bDeferred);
    });
    const engine = createEngineWithFakeLoop(fakeRun);

    await engine.submitMessage({
      request: { message: "A needs tool", conversationId: "v2-A" },
      eventSink: makeEventCollector().sink,
    });
    // A is paused awaiting permission, not streaming.
    expect(engine.getConversationRuntimeStatus("v2-A")).toBe(
      "awaiting_permission"
    );

    void engine.submitMessage({
      request: { message: "B", conversationId: "v2-B" },
      eventSink: makeEventCollector().sink,
    });
    await vi.waitFor(() => expect(fakeRun).toHaveBeenCalledTimes(2));

    // B streams concurrently while A waits.
    expect(engine.getConversationRuntimeStatus("v2-B")).toBe("running");
    expect(engine.getConversationRuntimeStatus("v2-A")).toBe(
      "awaiting_permission"
    );

    bDeferred.resolve({
      type: "completed",
      conversationId: "v2-B",
      assistantMessageId: "assistant-B",
      fullContent: "",
      finishReason: "stop",
      model: "gpt-4",
    });
  });
});
