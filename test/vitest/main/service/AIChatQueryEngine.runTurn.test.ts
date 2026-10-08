// test/vitest/main/service/AIChatQueryEngine.runTurn.test.ts
//
// P0 baseline for the generator-streaming PRD: pins the segment-outcome
// contract of the engine's queue-dispatch entry point before Stage A reuses
// it for every owner (PRD §10 P0 exit gate — "every segment outcome has a
// test owner"). Stage A Task A1 extends this file with runTurn() coverage.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";
import type { AIChatQueryEngineDeps } from "@/service/AIChatQueryEngine";
import type { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type {
  AIChatQueryEvent,
  AIChatQueryLoopInput,
  AIChatQueryLoopResult,
} from "@/service/AIChatQueryEvents";
import type { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { SkillExecutor } from "@/service/SkillExecutor";
import type { AIChatTurnLifecycleListener } from "@/service/AIChatQueryEvents";

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

const mockGetPlanState = vi.fn().mockResolvedValue(null);
vi.mock("@/modules/AIChatPlanModule", () => ({
  AIChatPlanModule: vi.fn().mockImplementation(function () {
    return {
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

const mockNotifyShow = vi.fn().mockResolvedValue(false);

vi.mock("@/service/DesktopNotifyService", () => ({
  DesktopNotifyService: {
    getInstance: () => ({ show: mockNotifyShow }),
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

describe("AIChatQueryEngine lifecycle notifications + side-effect gating (Stage A2, FR-021/023)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlanState.mockResolvedValue(null);
    mockCreateConversationIfNeeded.mockImplementation((id: string) => id);
  });

  function makeListener(): AIChatTurnLifecycleListener & {
    awaiting: Array<Parameters<AIChatTurnLifecycleListener["onAwaiting"]>[0]>;
    resumed: Array<Parameters<AIChatTurnLifecycleListener["onResumed"]>[0]>;
  } {
    const awaiting: Array<
      Parameters<AIChatTurnLifecycleListener["onAwaiting"]>[0]
    > = [];
    const resumed: Array<
      Parameters<AIChatTurnLifecycleListener["onResumed"]>[0]
    > = [];
    return {
      awaiting,
      resumed,
      onAwaiting: (event) => {
        awaiting.push(event);
      },
      onResumed: (event) => {
        resumed.push(event);
      },
    };
  }

  it("onAwaiting fires exactly once for a permission park, carrying stable identity (FR-021)", async () => {
    const listener = makeListener();
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
          toolCallId: "tool-p-1",
          toolName: "send_email",
          toolArguments: {},
          eventSink: { emit: () => undefined },
          lifecycle: listener,
        },
      })
    );

    const outcome = await engine.runTurn({
      request: { message: "send it", conversationId: "v2-A" },
      eventSink: makeEventCollector().sink,
      lifecycle: listener,
    });

    expect(outcome.type).toBe("paused_for_permission");
    expect(listener.awaiting).toHaveLength(1);
    expect(listener.awaiting[0]).toMatchObject({
      kind: "permission",
      conversationId: "v2-A",
      toolCallId: "tool-p-1",
    });
    expect(listener.resumed).toHaveLength(0);
  });

  it("onAwaiting fires exactly once for a plan-question park with questionId (FR-021)", async () => {
    const listener = makeListener();
    const engine = createEngineWithFakeLoop((input) =>
      Promise.resolve({
        type: "paused_for_plan_question",
        pending: {
          conversationId: input.conversationId,
          assistantMessageId: input.assistantMessageId,
          conversationMessages: [],
          abortController: new AbortController(),
          request: input.request,
          openAITools: [],
          nextRound: 1,
          toolCallId: "tool-q-1",
          questionId: "question-9",
          planId: "plan-1",
          eventSink: { emit: () => undefined },
          lifecycle: listener,
        },
      })
    );

    const outcome = await engine.runTurn({
      request: { message: "plan it", conversationId: "v2-B", mode: "plan" },
      eventSink: makeEventCollector().sink,
      lifecycle: listener,
    });

    expect(outcome.type).toBe("paused_for_plan_question");
    expect(listener.awaiting).toHaveLength(1);
    expect(listener.awaiting[0]).toMatchObject({
      kind: "user_input",
      conversationId: "v2-B",
      questionId: "question-9",
    });
  });

  it("onResumed fires once when a permission resume starts executing (FR-021)", async () => {
    const listener = makeListener();
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
          toolCallId: "tool-p-1",
          toolName: "send_email",
          toolArguments: {},
          eventSink: { emit: () => undefined },
          lifecycle: listener,
        },
      })
    );

    // Park a turn whose pending carries the owner listener.
    const parked = await engine.runTurn({
      request: { message: "needs approval", conversationId: "v2-C" },
      eventSink: makeEventCollector().sink,
      lifecycle: listener,
    });
    expect(parked.type).toBe("paused_for_permission");

    vi.mocked(SkillExecutor.execute).mockResolvedValue({
      tool_call_id: "tool-p-1",
      tool_name: "send_email",
      success: true,
      result: { success: true },
      execution_time_ms: 1,
    });

    const resume = await engine.resumeToolAfterPermission({
      toolId: "tool-p-1",
      conversationId: "v2-C",
    });
    expect(resume.ok).toBe(true);
    expect(listener.resumed).toHaveLength(1);
    expect(listener.resumed[0]).toMatchObject({
      conversationId: "v2-C",
    });
    // Give the fire-and-forget continuation a tick to settle.
    await new Promise((r) => setTimeout(r, 10));
  });

  it("post-terminal side effects fire once on completed and never on a pause (FR-023/AC-18)", async () => {
    const enqueueAutoCompact = vi.fn().mockResolvedValue(true);
    const evaluateDream = vi.fn().mockResolvedValue(undefined);
    const evaluateWorkspaceDream = vi.fn().mockResolvedValue(undefined);
    const onTurnTerminal = vi.fn();
    const buildEngine = (
      fakeRun: (input: AIChatQueryLoopInput) => Promise<AIChatQueryLoopResult>
    ): AIChatQueryEngine =>
      new AIChatQueryEngine({ run: fakeRun } as unknown as AIChatQueryLoop, {
        compactAgent: { enqueueAutoCompact },
        autoDreamService: { evaluateAfterChatTurn: evaluateDream },
        workspaceAutoDreamService: {
          evaluateAfterChatTurn: evaluateWorkspaceDream,
        },
        onTurnTerminal,
      } as unknown as AIChatQueryEngineDeps);

    // Completed: every post-terminal side effect fires exactly once.
    const completedEngine = buildEngine(async (input) => ({
      type: "completed",
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      fullContent: "done",
      finishReason: "stop",
    }));
    const completedOutcome = await completedEngine.runTurn({
      request: { message: "hi", conversationId: "v2-se-1" },
      eventSink: makeEventCollector().sink,
    });
    expect(completedOutcome.type).toBe("completed");
    await vi.waitFor(() => expect(mockNotifyShow).toHaveBeenCalledTimes(1));
    expect(enqueueAutoCompact).toHaveBeenCalledTimes(1);
    expect(evaluateDream).toHaveBeenCalledTimes(1);
    expect(evaluateWorkspaceDream).toHaveBeenCalledTimes(1);
    expect(onTurnTerminal).toHaveBeenCalledTimes(1);
    expect(onTurnTerminal).toHaveBeenCalledWith("v2-se-1", "completed");

    // Paused: NONE of the post-terminal side effects fire, and the engine's
    // terminal callback does not fire (a pause is not a terminal).
    enqueueAutoCompact.mockClear();
    evaluateDream.mockClear();
    evaluateWorkspaceDream.mockClear();
    mockNotifyShow.mockClear();
    onTurnTerminal.mockClear();
    const pausedEngine = buildEngine((input) =>
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
          toolCallId: "tool-se-1",
          toolName: "send_email",
          toolArguments: {},
          eventSink: { emit: () => undefined },
        },
      })
    );
    const pausedOutcome = await pausedEngine.runTurn({
      request: { message: "needs approval", conversationId: "v2-se-2" },
      eventSink: makeEventCollector().sink,
    });
    expect(pausedOutcome.type).toBe("paused_for_permission");
    await new Promise((r) => setTimeout(r, 20));
    expect(enqueueAutoCompact).not.toHaveBeenCalled();
    expect(evaluateDream).not.toHaveBeenCalled();
    expect(evaluateWorkspaceDream).not.toHaveBeenCalled();
    expect(mockNotifyShow).not.toHaveBeenCalled();
    expect(onTurnTerminal).not.toHaveBeenCalled();
  });

  it("ownerNotifiesTerminal suppresses the engine's onTurnTerminal callback (FR-023)", async () => {
    const onTurnTerminal = vi.fn();
    const engine = new AIChatQueryEngine(
      {
        run: async (input: AIChatQueryLoopInput) =>
          ({
            type: "completed",
            conversationId: input.conversationId,
            assistantMessageId: input.assistantMessageId,
            fullContent: "x",
            finishReason: "stop",
          }) as AIChatQueryLoopResult,
      } as unknown as AIChatQueryLoop,
      { onTurnTerminal }
    );

    await engine.runTurn({
      request: { message: "hi", conversationId: "v2-se-3" },
      eventSink: makeEventCollector().sink,
      ownerNotifiesTerminal: true,
    });

    expect(onTurnTerminal).not.toHaveBeenCalled();
  });
});


describe("AIChatQueryEngine claim/resumeClaimed (Stage A3b, FR-010/024)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlanState.mockResolvedValue(null);
    mockCreateConversationIfNeeded.mockImplementation((id: string) => id);
  });

  async function parkPermission(
    engine: AIChatQueryEngine,
    listener?: AIChatTurnLifecycleListener
  ): Promise<void> {
    const outcome = await engine.runTurn({
      request: { message: "needs approval", conversationId: "v2-R" },
      eventSink: makeEventCollector().sink,
      ...(listener ? { lifecycle: listener } : {}),
    });
    expect(outcome.type).toBe("paused_for_permission");
  }

  function parkedLoop(listener?: AIChatTurnLifecycleListener) {
    return (input: AIChatQueryLoopInput) => {
      // Continuation rounds (startRound > 0 — the resumed segment) complete.
      if (input.startRound > 0) {
        return Promise.resolve({
          type: "completed" as const,
          conversationId: input.conversationId,
          assistantMessageId: input.assistantMessageId,
          fullContent: "resumed done",
          finishReason: "stop",
        } as AIChatQueryLoopResult);
      }
      return Promise.resolve({
        type: "paused_for_permission" as const,
        pending: {
          conversationId: input.conversationId,
          assistantMessageId: input.assistantMessageId,
          conversationMessages: [],
          abortController: new AbortController(),
          request: input.request,
          openAITools: [],
          nextRound: 1,
          toolCallId: "tool-r-1",
          toolName: "send_email",
          toolArguments: {},
          eventSink: { emit: () => undefined },
          ...(listener ? { lifecycle: listener } : {}),
        },
      });
    };
  }

  it("claims are idempotent: duplicate and stale claims never re-execute", async () => {
    const engine = createEngineWithFakeLoop(parkedLoop());
    await parkPermission(engine);

    const first = engine.claimPendingPermission("v2-R", "tool-r-1");
    expect(first.status).toBe("claimed");
    const duplicate = engine.claimPendingPermission("v2-R", "tool-r-1");
    expect(duplicate.status).toBe("already_claimed");
    const stale = engine.claimPendingPermission("v2-R", "tool-other");
    expect(stale.status).toBe("not_found");

    expect(engine.cancelClaimed("v2-R")).toBe(true);
    expect(engine.cancelClaimed("v2-R")).toBe(false);
  });

  it("resumeClaimed returns the continuation outcome and fires onResumed once", async () => {
    const listener = makeLifecycleListener();
    const engine = createEngineWithFakeLoop(parkedLoop(listener));
    await parkPermission(engine, listener);

    const claim = engine.claimPendingPermission("v2-R", "tool-r-1");
    if (claim.status !== "claimed") throw new Error("claim failed");

    vi.mocked(SkillExecutor.execute).mockResolvedValue({
      tool_call_id: "tool-r-1",
      tool_name: "send_email",
      success: true,
      result: { success: true },
      execution_time_ms: 1,
    });

    const outcome = await engine.resumeClaimed(claim, {
      lifecycle: listener,
    });
    expect(outcome).toMatchObject({ type: "completed", conversationId: "v2-R" });
    expect(listener.resumed).toHaveLength(1);
    expect(SkillExecutor.execute).toHaveBeenCalledTimes(1);
    expect(engine.getConversationRuntimeStatus("v2-R")).toBe("idle");
  });

  it("resumeClaimed parks again when the tool still requires permission", async () => {
    const engine = createEngineWithFakeLoop(parkedLoop());
    await parkPermission(engine);
    const claim = engine.claimPendingPermission("v2-R", "tool-r-1");
    if (claim.status !== "claimed") throw new Error("claim failed");

    vi.mocked(SkillExecutor.execute).mockResolvedValue({
      tool_call_id: "tool-r-1",
      tool_name: "send_email",
      success: false,
      result: { success: false, needsPermissionPrompt: true },
      execution_time_ms: 1,
    } as unknown as Awaited<ReturnType<typeof SkillExecutor.execute>>);

    const outcome = await engine.resumeClaimed(claim);
    expect(outcome.type).toBe("paused_for_permission");
    expect(engine.getConversationRuntimeStatus("v2-R")).toBe(
      "awaiting_permission"
    );
  });
});

function makeLifecycleListener(): AIChatTurnLifecycleListener & {
  awaiting: unknown[];
  resumed: Array<{ conversationId: string }>;
} {
  const awaiting: unknown[] = [];
  const resumed: Array<{ conversationId: string }> = [];
  return {
    awaiting,
    resumed,
    onAwaiting: (event) => {
      awaiting.push(event);
    },
    onResumed: (event) => {
      resumed.push(event);
    },
  };
}

describe("TODO-05: finalization serialization + side effects exactly once", () => {
  it("Stop hook fires exactly once across stopConversation + cancelled resolution", async () => {
    const { HookDispatcher } = await import("@/service/hooks/HookDispatcher");
    const stopCalls: Array<{ conversationId: string | undefined; reason: string }> = [];
    const origDispatch = HookDispatcher.executeHooks.bind(HookDispatcher);
    (HookDispatcher as unknown as { executeHooks: typeof HookDispatcher.executeHooks }).executeHooks =
      (async (input: { eventName: string; input: { conversationId?: string; reason?: string } }) => {
        if (input.eventName === "Stop") {
          stopCalls.push({
            conversationId: input.input.conversationId,
            reason: input.input.reason ?? "",
          });
        }
        return origDispatch(input as never);
      }) as typeof HookDispatcher.executeHooks;

    const abortable = (input: AIChatQueryLoopInput): Promise<AIChatQueryLoopResult> =>
      new Promise((resolve) => {
        input.abortController.signal.addEventListener("abort", () =>
          resolve({
            type: "cancelled",
            conversationId: input.conversationId,
            assistantMessageId: input.assistantMessageId,
            partialContent: "",
          })
        );
      });
    const engine = createEngineWithFakeLoop(abortable);
    const collector = makeEventCollector();
    const run = engine.runTurn({
      request: { message: "long", conversationId: "v2-TO5" },
      eventSink: collector.sink,
    });
    await vi.waitFor(() =>
      expect(engine.getConversationRuntimeStatus("v2-TO5")).toBe("running")
    );
    engine.stopActiveTurn("v2-TO5");
    await run;
    const stopHooks = stopCalls.filter((c) => c.conversationId === "v2-TO5");
    expect(stopHooks).toHaveLength(1);
    expect(stopHooks[0].reason).toBe("user_stopped");
    (HookDispatcher as unknown as { executeHooks: typeof HookDispatcher.executeHooks }).executeHooks = origDispatch;
  });

  it("onSegmentDurable fires after the assistant save and before the completion notification", async () => {
    const order: string[] = [];
    mockSaveAssistantMessage.mockImplementation(async () => {
      order.push("assistant-save");
      return {};
    });
    mockNotifyShow.mockImplementation(async () => {
      order.push("desktop-notify");
      return false;
    });
    const engine = createEngineWithFakeLoop(async (input) => ({
      type: "completed",
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      fullContent: "done",
      finishReason: "stop",
    }));
    await engine.runTurn({
      request: { message: "hi", conversationId: "v2-TO5b" },
      eventSink: makeEventCollector().sink,
      onSegmentDurable: async () => {
        order.push("durable-gate");
      },
    });
    expect(order.indexOf("assistant-save")).toBeLessThan(order.indexOf("durable-gate"));
    expect(order.indexOf("durable-gate")).toBeLessThan(order.indexOf("desktop-notify"));
  });

  it("compat onTurnTerminal fires after the assistant save (never before)", async () => {
    const order: string[] = [];
    mockSaveAssistantMessage.mockImplementation(async () => {
      order.push("assistant-save");
      return {};
    });
    const engine = new AIChatQueryEngine(
      {
        run: async (input: AIChatQueryLoopInput): Promise<AIChatQueryLoopResult> => ({
          type: "completed",
          conversationId: input.conversationId,
          assistantMessageId: input.assistantMessageId,
          fullContent: "x",
          finishReason: "stop",
        }),
      } as unknown as AIChatQueryLoop,
      {
        onTurnTerminal: () => {
          order.push("on-turn-terminal");
        },
      } as never
    );
    await engine.runTurn({
      request: { message: "hi", conversationId: "v2-TO5c" },
      eventSink: makeEventCollector().sink,
    });
    expect(order.indexOf("assistant-save")).toBeLessThan(order.indexOf("on-turn-terminal"));
  });
});

describe("R03: durable finalization + Stop arbitration", () => {
  it("a rejecting durable gate blocks post-terminal side effects (no notification)", async () => {
    mockSaveAssistantMessage.mockResolvedValue({});
    mockNotifyShow.mockClear();
    const engine = createEngineWithFakeLoop(async (input) => ({
      type: "completed",
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      fullContent: "x",
      finishReason: "stop",
    }));
    let gateError: unknown = null;
    const outcome = await engine.runTurn({
      request: { message: "hi", conversationId: "v2-R03a" },
      eventSink: makeEventCollector().sink,
      onSegmentDurable: async () => {
        gateError = new Error("run-row write failed");
        throw gateError;
      },
    });
    expect(outcome.type).toBe("failed"); // the gate rejection is a safe failure
    await new Promise((r) => setTimeout(r, 30));
    expect(mockNotifyShow).not.toHaveBeenCalled(); // side effect blocked
  });

  it("a resolving gate lets post-terminal side effects run (control)", async () => {
    mockSaveAssistantMessage.mockResolvedValue({});
    mockNotifyShow.mockClear();
    const engine = createEngineWithFakeLoop(async (input) => ({
      type: "completed",
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      fullContent: "x",
      finishReason: "stop",
    }));
    await engine.runTurn({
      request: { message: "hi", conversationId: "v2-R03b" },
      eventSink: makeEventCollector().sink,
      onSegmentDurable: async () => undefined,
    });
    await vi.waitFor(() => expect(mockNotifyShow).toHaveBeenCalledTimes(1));
  });
});

describe("R06: stopping a paused question emits the compatibility terminal", () => {
  it("the pending sink receives exactly one cancelled event on Stop", async () => {
    const listener = makeLifecycleListener();
    const engine = createEngineWithFakeLoop((input) =>
      Promise.resolve({
        type: "paused_for_plan_question",
        pending: {
          conversationId: input.conversationId,
          assistantMessageId: input.assistantMessageId,
          conversationMessages: [],
          abortController: new AbortController(),
          request: input.request,
          openAITools: [],
          nextRound: 1,
          toolCallId: "tool-q6",
          questionId: "q6",
          planId: "p6",
          eventSink: { emit: () => undefined },
          lifecycle: listener,
        },
      })
    );
    const compatEvents: AIChatQueryEvent[] = [];
    const compatSink = { emit: (e: AIChatQueryEvent) => { compatEvents.push(e); } };
    const outcome = await engine.runTurn({
      request: { message: "plan", conversationId: "v2-R06", mode: "plan" },
      eventSink: makeEventCollector().sink,
    });
    expect(outcome.type).toBe("paused_for_plan_question");
    // The engine side-mapped the ORIGINAL submission sink; simulate that by
    // registering the compat sink as the pending destination.
    (engine as unknown as {
      pendingSinks: Map<string, { emit: (e: AIChatQueryEvent) => void }>;
    }).pendingSinks.set("v2-R06", compatSink);

    engine.stopActiveTurn("v2-R06");
    const cancelled = compatEvents.filter((e) => e.type === "cancelled");
    expect(cancelled).toHaveLength(1);
    expect(engine.getConversationRuntimeStatus("v2-R06")).toBe("idle");
  });
});
