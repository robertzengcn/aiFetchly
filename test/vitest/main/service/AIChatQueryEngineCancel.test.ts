// test/vitest/main/service/AIChatQueryEngineCancel.test.ts
//
// Unit 7 (GAP-S2 #10/#11, FR-22, AC-24) — stop wiring.
//
// When the completion-policy flag is on and the stopped conversation had an
// enrolled execution, `stopConversation` cancels the execution through the
// coordinator (finalize cancelled/USER_CANCELLED) BEFORE aborting the turn's
// controller. Flag-off (or no bound execution) leaves the existing stop
// behavior byte-identical: no coordinator call.
//
// These tests lock:
//   - flag-on + enrolled turn → coordinator.cancel called with the bound
//     execution id (the coordinator reads the row version itself, mirroring
//     finalizeManual — the engine passes no expectedVersion), then the turn
//     aborts
//   - flag-off → coordinator.cancel never called, abort still happens
//   - flag-on + no enrolled turn → cancel never called (nothing enrolled)
//
// The enrollment seam is exercised through the REAL submitMessage path: the
// coordinator mock's startManual returns a created binding, the loop mock
// never resolves (the turn stays active until stopped), and stopActiveTurn
// runs mid-submission.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";
import type { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type { AIChatQueryEventSink } from "@/service/AIChatQueryEvents";
import { HookRegistry } from "@/service/hooks/HookRegistry";

// vi.mock factories are hoisted above top-level vars, so declare the mock
// fns inside vi.hoisted() to make them visible to the factories.
const {
  flagMock,
  classifyMock,
  startManualMock,
  freezeContractMock,
  cancelMock,
  mentionResolveMock,
} = vi.hoisted(() => ({
  flagMock: vi.fn<() => boolean>(),
  classifyMock: vi.fn(),
  startManualMock: vi.fn(),
  freezeContractMock: vi.fn(),
  cancelMock: vi.fn<
    (
      executionId: string,
      expectedVersion?: number
    ) => Promise<{ ok: true } | { ok: false; reasonCode: string }>
  >(),
  mentionResolveMock: vi.fn(),
}));

vi.mock("@/config/featureFlags", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/config/featureFlags")>();
  return {
    ...actual,
    isAiTaskCompletionPolicyV1Enabled: flagMock,
  };
});

vi.mock("@/service/aiTaskExecution/TaskRequestResolver", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/service/aiTaskExecution/TaskRequestResolver")>();
  return {
    ...actual,
    TaskRequestResolver: vi.fn().mockImplementation(function () {
      return { classify: classifyMock };
    }),
  };
});

// Coordinator mock: startManual (enrollment) + freezeContract + cancel (the
// stop path under test).
vi.mock("@/service/aiTaskExecution/TaskExecutionCoordinator", () => ({
  TaskExecutionCoordinator: vi.fn().mockImplementation(function () {
    return {
      startManual: startManualMock,
      freezeContract: freezeContractMock,
      cancel: cancelMock,
    };
  }),
}));

vi.mock("@/service/aiTaskExecution/TaskEvidenceService", () => ({
  TaskEvidenceService: vi.fn().mockImplementation(function () {
    return { checkCandidate: vi.fn().mockResolvedValue({}) };
  }),
  makeModuleBackedStore: vi.fn().mockReturnValue({
    getExecutionState: vi.fn().mockResolvedValue(null),
    mergeEvidenceCas: vi.fn().mockResolvedValue(false),
  }),
}));

vi.mock("@/modules/AiTaskExecutionModule", () => ({
  AiTaskExecutionModule: vi.fn().mockImplementation(function () {
    return {
      getExecution: vi.fn().mockResolvedValue(null),
      applyShadowDecisionCas: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock("@/modules/OutboundEmailIntentModule", () => ({
  OutboundEmailIntentModule: vi.fn().mockImplementation(function () {
    return {
      findBySource: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 1 }),
      updateDecision: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

// --- AtMentionResolutionService mock (G01-312): prep stalls here on
// demand so Stop can land mid-preparation. Default is a behavior-preserving
// passthrough (existing tests never assert mention content).
vi.mock("@/service/aiChatAtMentions/AtMentionResolutionService", () => ({
  AtMentionResolutionService: vi.fn().mockImplementation(function () {
    return { resolveMessage: mentionResolveMock };
  }),
}));
const mockSaveUserMessage = vi
  .fn()
  .mockResolvedValue({ messageId: "user-1" });
const mockGetConversationMessages = vi.fn().mockResolvedValue([]);
const mockGetRecentMessages = vi.fn().mockResolvedValue([]);
const mockSaveAssistantMessage = vi.fn().mockResolvedValue({});
const mockSaveToolCallMessage = vi.fn().mockResolvedValue({});
const mockSaveToolResultMessage = vi.fn().mockResolvedValue({});
const mockCreateConversationIfNeeded = vi.fn().mockReturnValue("v2-test-conv");
const mockGetDefaultSystemPrompt = vi.fn().mockReturnValue("You are helpful.");

vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(function () {
    return {
      saveUserMessage: mockSaveUserMessage,
      getConversationMessages: mockGetConversationMessages,
      getRecentMessages: mockGetRecentMessages,
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
    return { saveUploadedFiles: vi.fn().mockResolvedValue(undefined) };
  }),
}));

const mockGetPlanState = vi.fn().mockResolvedValue(null);
const mockEnsurePlanForConversation = vi.fn().mockResolvedValue(null);
vi.mock("@/modules/AIChatPlanModule", () => ({
  AIChatPlanModule: vi.fn().mockImplementation(function () {
    return {
      getPlanState: mockGetPlanState,
      ensurePlanForConversation: mockEnsurePlanForConversation,
    };
  }),
}));

const mockGetActiveGoal = vi.fn().mockResolvedValue(null);
vi.mock("@/modules/AIChatGoalModule", () => ({
  AIChatGoalModule: vi.fn().mockImplementation(function () {
    return { getActiveGoal: mockGetActiveGoal };
  }),
}));

vi.mock("@/modules/AIChatSessionMemoryModule", () => ({
  AIChatSessionMemoryModule: vi.fn().mockImplementation(function () {
    return { getByConversation: vi.fn().mockResolvedValue(null) };
  }),
}));
vi.mock("@/modules/AIChatCompactModule", () => ({
  AIChatCompactModule: vi.fn().mockImplementation(function () {
    return { getActiveSummary: vi.fn().mockResolvedValue(null) };
  }),
}));
vi.mock("@/modules/AIChatArchiveModule", () => ({
  AIChatArchiveModule: vi.fn().mockImplementation(function () {
    return {};
  }),
}));
vi.mock("@/modules/AIChatCompactionModule", () => ({
  AIChatCompactionModule: vi.fn().mockImplementation(function () {
    return {};
  }),
}));
vi.mock("@/modules/AgentDefinitionModule", () => ({
  AgentDefinitionModule: vi.fn().mockImplementation(function () {
    return { listActiveForRuntime: vi.fn().mockResolvedValue([]) };
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
    return { getValue: vi.fn().mockReturnValue("true") };
  }),
}));
vi.mock("@/config/usersetting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/usersetting")>();
  return { ...actual };
});

const EXEC_ID = "exec-stop-1";

/**
 * Enroll the turn: flag on + task route + startManual resolves created with a
 * binding carrying the execution id. The loop consult closure is never
 * invoked here (the loop mock never reaches a consult site — it never
 * resolves at all).
 */
function enrollCreated(): void {
  flagMock.mockReturnValue(true);
  classifyMock.mockReturnValue("task_best_effort");
  startManualMock.mockResolvedValue({
    status: "created",
    binding: {
      executionId: EXEC_ID,
      controller: { decide: vi.fn() },
      budget: { reserveContinuation: vi.fn().mockReturnValue("reserved") },
      route: "task_best_effort",
      contract: null,
      contractHash: null,
    },
  });
}

function makeSink(): { sink: AIChatQueryEventSink; emits: Array<{ type: string }> } {
  const emits: Array<{ type: string }> = [];
  return {
    sink: {
      emit: vi.fn((e: { type: string }) => emits.push(e)),
    } as unknown as AIChatQueryEventSink,
    emits,
  };
}

function makeEngine(): {
  engine: AIChatQueryEngine;
  loopRunSpy: ReturnType<typeof vi.fn>;
} {
  const loopRunSpy = vi.fn();
  const fakeLoop = {
    run: loopRunSpy.mockImplementation(
      (input: {
        conversationId: string;
        assistantMessageId: string;
        abortController: AbortController;
      }) =>
        new Promise<{ type: "cancelled"; conversationId: string; assistantMessageId: string; partialContent: string }>(
          (resolve) => {
            // Mirror the real loop: the turn stays running until the abort
            // signal fires, then resolves `cancelled` so the engine's
            // handleLoopResult runs and submitMessage settles.
            input.abortController.signal.addEventListener("abort", () => {
              resolve({
                type: "cancelled",
                conversationId: input.conversationId,
                assistantMessageId: input.assistantMessageId,
                partialContent: "",
              });
            });
          }
        )
    ),
  } as unknown as AIChatQueryLoop;
  return { engine: new AIChatQueryEngine(fakeLoop), loopRunSpy };
}

describe("AIChatQueryEngine.stopActiveTurn — completion policy cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flagMock.mockReturnValue(false);
    classifyMock.mockReturnValue("response_only");
    startManualMock.mockReset();
    freezeContractMock.mockReset();
    cancelMock.mockResolvedValue({ ok: true });
    mockGetPlanState.mockResolvedValue(null);
    mockEnsurePlanForConversation.mockResolvedValue(null);
    mockCreateConversationIfNeeded.mockReturnValue("v2-test-conv");
    // G01-312: mention resolution defaults to a passthrough (no stall).
    mentionResolveMock.mockImplementation(
      async (_conversationId: string, message: string) => ({
        originalMessage: message,
        modelMessage: message,
        metadata: [],
        warnings: [],
        hasResolvedMentions: false,
      })
    );
    HookRegistry.unregisterSource("plugin:test-hooks");
  });

  it("flag-off: aborts the turn without calling coordinator.cancel", async () => {
    flagMock.mockReturnValue(false);
    const { engine, loopRunSpy } = makeEngine();
    const { sink, emits } = makeSink();
    // Flag-off: enrollment is skipped entirely, so no binding exists and
    // stop must be a no-op safe with no coordinator call.
    const submission = engine
      .submitMessage({
        request: {
          conversationId: "v2-test-conv",
          message: "Extract contacts.",
          model: "gpt-4o",
        },
        eventSink: sink,
      } as never)
      .catch(() => undefined);
    // Wait until the loop actually started — activeTurns.set happened before
    // loop.run, so stopping now is guaranteed to find + abort the turn.
    await vi.waitFor(() => {
      expect(loopRunSpy).toHaveBeenCalled();
    });
    engine.stopActiveTurn("v2-test-conv");
    await submission;
    expect(cancelMock).not.toHaveBeenCalled();
    // The turn was still stopped normally: a cancelled event was emitted.
    expect(emits.some((e) => e.type === "cancelled")).toBe(true);
  });

  it("flag-on + enrolled turn: cancels the bound execution through the coordinator", async () => {
    enrollCreated();
    const { engine, loopRunSpy } = makeEngine();
    const { sink } = makeSink();
    // The loop runs until the abort fires; stop it mid-submission — the turn
    // IS active (activeTurns entry set before the loop runs) and enrollment
    // has completed (enrollment runs before activeTurns.set).
    const submission = engine
      .submitMessage({
        request: {
          conversationId: "v2-test-conv",
          message: "Extract contacts.",
          model: "gpt-4o",
        },
        eventSink: sink,
      } as never)
      .catch(() => undefined);
    // Wait until the loop actually started — enrollment + the binding map
    // write both happened before activeTurns.set/loop.run.
    await vi.waitFor(() => {
      expect(loopRunSpy).toHaveBeenCalled();
    });
    engine.stopActiveTurn("v2-test-conv");
    await submission;
    // The engine passes no expectedVersion — the coordinator reads the row
    // version itself (mirroring finalizeManual; the binding carries
    // leaseGeneration, not the version token).
    expect(cancelMock).toHaveBeenCalledWith(EXEC_ID);
    // Exactly one cancel: the binding is consumed at stop, so the loop's
    // cancelled resolution never double-finalizes.
    expect(cancelMock).toHaveBeenCalledTimes(1);
  });

  it("flag-on + no enrolled turn: cancel never called", async () => {
    flagMock.mockReturnValue(true);
    const { engine } = makeEngine();
    // Never-enrolled conversation: no activeTurns entry, no binding.
    engine.stopActiveTurn("conv-never-enrolled");
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it("G01-312a: Stop during pre-enrollment prep exits before any loop dispatch", async () => {
    // Stall the mention-resolution stage (pre-enrollment slow prep), stop
    // mid-stall, then release: the turn must exit controlled (cancelled
    // emitted, loop never ran) instead of streaming on despite the Stop.
    // Nothing enrolled yet, so no coordinator cancel is owed.
    enrollCreated();
    let release!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      release = resolve as (value: unknown) => void;
    });
    mentionResolveMock.mockReturnValue(gate);
    const { engine, loopRunSpy } = makeEngine();
    const { sink, emits } = makeSink();
    const submission = engine
      .submitMessage({
        request: {
          conversationId: "v2-test-conv",
          message: "Extract contacts.",
          model: "gpt-4o",
        },
        eventSink: sink,
      } as never)
      .catch(() => undefined);
    await vi.waitFor(() => {
      expect(mentionResolveMock).toHaveBeenCalled();
    });
    engine.stopActiveTurn("v2-test-conv");
    release({
      originalMessage: "Extract contacts.",
      modelMessage: "Extract contacts.",
      metadata: [],
      warnings: [],
      hasResolvedMentions: false,
    });
    await flushPromisesSafe();
    // Fast red on unfixed code: the loop runs (Stop was a no-op).
    expect(loopRunSpy).not.toHaveBeenCalled();
    await submission;
    expect(emits.some((e) => e.type === "cancelled")).toBe(true);
    expect(cancelMock).not.toHaveBeenCalled();

    // No wedging: a fresh submit after the aborted prep streams normally.
    mentionResolveMock.mockImplementation(
      async (_conversationId: string, message: string) => ({
        originalMessage: message,
        modelMessage: message,
        metadata: [],
        warnings: [],
        hasResolvedMentions: false,
      })
    );
    const { sink: sink2 } = makeSink();
    engine
      .submitMessage({
        request: {
          conversationId: "v2-test-conv",
          message: "Extract contacts again.",
          model: "gpt-4o",
        },
        eventSink: sink2,
      } as never)
      .catch(() => undefined);
    await vi.waitFor(() => {
      expect(loopRunSpy).toHaveBeenCalled();
    });
  });

  it("G01-312b: Stop after enrollment but before streaming cancels the just-enrolled row", async () => {
    // Stall transcript assembly (post-enrollment): the row exists when Stop
    // lands, so the abort exit must cancel it (no orphan active row) and
    // the loop must never run.
    enrollCreated();
    const { engine, loopRunSpy } = makeEngine();
    const assembler = (
      engine as unknown as {
        contextAssembler: { assemble: (...args: never[]) => Promise<unknown> };
      }
    ).contextAssembler;
    let release!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      release = resolve as (value: unknown) => void;
    });
    const assembleSpy = vi
      .spyOn(assembler, "assemble")
      .mockReturnValue(gate as Promise<unknown>);
    const { sink, emits } = makeSink();
    try {
      const submission = engine
        .submitMessage({
          request: {
            conversationId: "v2-test-conv",
            message: "Extract contacts.",
            model: "gpt-4o",
          },
          eventSink: sink,
        } as never)
        .catch(() => undefined);
      await vi.waitFor(() => {
        expect(assembleSpy).toHaveBeenCalled();
      });
      engine.stopActiveTurn("v2-test-conv");
      release({ messages: [] });
      await flushPromisesSafe();
      // Fast red on unfixed code: the loop runs despite the Stop.
      expect(loopRunSpy).not.toHaveBeenCalled();
      await submission;
      expect(cancelMock).toHaveBeenCalledWith(EXEC_ID);
      expect(emits.some((e) => e.type === "cancelled")).toBe(true);
    } finally {
      assembleSpy.mockRestore();
    }
  });
});

async function flushPromisesSafe(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}
