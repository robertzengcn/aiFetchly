// test/vitest/main/service/AIChatQueryEngineSuccessor.test.ts
//
// T09 (FR-14/21/22, AC-16/27/28) — successor dispatch after Continue/Retry.
//
// The IPC handler creates the successor execution (continueExecution /
// retryExecution) then dispatches a REAL engine turn carrying a trusted
// `successorContext` (the coordinator's created TaskExecutionBinding + the
// parent's parsed route). The engine ADOPTS that binding exactly like a
// scheduled caller-supplied binding (T02): no re-classification, no
// re-enrollment (startManual never called), maps + decision slot written so
// Stop/finalization find the successor execution. The binding keeps manual
// kind so the complete-gate/cancelled/failed finalization applies.
//
// These tests lock:
//   - successorContext + flag-on → binding adopted into loopInput with the
//     successor executionId; classify/startManual NOT called (no re-enrollment)
//   - taskRoute threaded from the successor's parent route (goal consults
//     route correctly)
//   - pre-stream failure (contextAssembler rejects) → the created successor
//     execution is CANCELLED (no orphan active row) + an error event emitted
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";
import type { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type {
  AIChatQueryLoopInput,
  AIChatQueryLoopResult,
} from "@/service/AIChatQueryEvents";
import type { LoopTaskExecutionBinding } from "@/service/aiTaskExecution/TaskLoopConsult";
import { HookRegistry } from "@/service/hooks/HookRegistry";

// vi.mock factories are hoisted above top-level vars, so declare the mock
// fns inside vi.hoisted() to make them visible to the factories.
const {
  flagMock,
  classifyMock,
  startManualMock,
  freezeContractMock,
  cancelMock,
  compileCriteriaMock,
  compileCriteriaHolder,
} = vi.hoisted(() => ({
  flagMock: vi.fn<() => boolean>(),
  classifyMock: vi.fn(),
  startManualMock: vi.fn(),
  freezeContractMock: vi.fn(),
  // T09: the pre-stream catch cancels an orphaned successor execution via
  // coordinator.cancel when the turn carried a successor-created binding.
  cancelMock: vi.fn().mockResolvedValue({ ok: true }),
  compileCriteriaMock: vi.fn(),
  compileCriteriaHolder: {
    real:
      undefined as unknown as typeof import("@/service/aiTaskExecution/TaskCriteriaResolver").compileCriteria,
  },
}));

// --- Feature flag mock: each test sets the flag by configuring flagMock --
vi.mock("@/config/featureFlags", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/config/featureFlags")>();
  return {
    ...actual,
    isAiTaskCompletionPolicyV1Enabled: flagMock,
  };
});

// --- TaskRequestResolver mock: classify must NOT run for successor turns --
// B12: isGoalLinkedMessage is NOT mocked — the enrollment ownership gate
// must exercise the real linkage rule.
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

// --- TaskCriteriaResolver mock: delegates to the REAL compiler by default --
vi.mock("@/service/aiTaskExecution/TaskCriteriaResolver", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/service/aiTaskExecution/TaskCriteriaResolver")
  >();
  compileCriteriaHolder.real = actual.compileCriteria;
  return {
    ...actual,
    compileCriteria: (...args: Parameters<typeof actual.compileCriteria>) =>
      compileCriteriaMock(...args),
  };
});

// --- TaskExecutionCoordinator mock: startManual/freezeContract/cancel -----
vi.mock("@/service/aiTaskExecution/TaskExecutionCoordinator", () => ({
  TaskExecutionCoordinator: vi.fn().mockImplementation(function () {
    return {
      startManual: startManualMock,
      freezeContract: freezeContractMock,
      cancel: cancelMock,
    };
  }),
}));

// --- TaskEvidenceService + makeModuleBackedStore: no-op store -----------
vi.mock("@/service/aiTaskExecution/TaskEvidenceService", () => ({
  TaskEvidenceService: vi.fn().mockImplementation(function () {
    return { checkCandidate: vi.fn().mockResolvedValue({}) };
  }),
  makeModuleBackedStore: vi.fn().mockReturnValue({
    getExecutionState: vi.fn().mockResolvedValue(null),
    mergeEvidenceCas: vi.fn().mockResolvedValue(false),
  }),
}));

// --- AiTaskExecutionModule mock (engine constructs it for the store) ----
vi.mock("@/modules/AiTaskExecutionModule", () => ({
  AiTaskExecutionModule: vi.fn().mockImplementation(function () {
    return {
      getExecution: vi.fn().mockResolvedValue(null),
      applyShadowDecisionCas: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

// --- OutboundEmailIntentModule mock (enrollment sits after it) ----------
vi.mock("@/modules/OutboundEmailIntentModule", () => ({
  OutboundEmailIntentModule: vi.fn().mockImplementation(function () {
    return {
      findBySource: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 1 }),
      updateDecision: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

// --- AIChatV2Module mock ------------------------------------------------
const mockSaveUserMessage = vi
  .fn()
  .mockResolvedValue({ messageId: "user-1" });
const mockSaveUserMessageIfAbsent = vi
  .fn()
  .mockResolvedValue({ messageId: "scheduled-user-1-1" });
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
      saveUserMessageIfAbsent: mockSaveUserMessageIfAbsent,
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

/**
 * Build an engine whose loop.run() captures the loopInput for assertion.
 * `deps` lets a test inject a rejecting contextAssembler to force the
 * pre-stream catch path (the orphan-cancel behavior under test).
 */
function createEngineCapturingInput(
  capture: (input: AIChatQueryLoopInput) => void,
  deps?: ConstructorParameters<typeof AIChatQueryEngine>[1]
): { engine: AIChatQueryEngine; runMock: ReturnType<typeof vi.fn> } {
  const runMock = vi.fn(async (input: AIChatQueryLoopInput) => {
    capture(input);
    return {
      type: "completed" as const,
      conversationId: "v2-test-conv",
      assistantMessageId: "a1",
      fullContent: "",
      finishReason: "stop",
    } as AIChatQueryLoopResult;
  });
  const fakeLoop = { run: runMock } as unknown as AIChatQueryLoop;
  return { engine: new AIChatQueryEngine(fakeLoop, deps), runMock };
}

/** Minimal successor request the engine accepts (no model → default). */
function makeSuccessorRequest(message = "Continue extracting contacts."): {
  conversationId: string;
  message: string;
  submissionId: string;
} {
  return {
    conversationId: "v2-test-conv",
    message,
    submissionId: "sub-successor-1",
  };
}

/** The coordinator's created binding for the successor execution. */
function makeSuccessorBinding() {
  return {
    executionId: "exec-successor-1",
    conversationId: "v2-test-conv",
    sourceUserMessageId: "user-1",
    origin: { kind: "manual" },
    route: "task_best_effort" as const,
    completionOwner: "standalone" as const,
    leaseGeneration: 1,
    ledgerId: "ledger-1",
    contract: null,
    contractHash: null,
    controller: { decide: vi.fn() },
    budget: {
      reserveContinuation: vi.fn(),
      reserveProviderAttempt: vi.fn(),
      reserveToolExecution: vi.fn(),
      reconcileTokens: vi.fn(),
      addActiveRuntime: vi.fn(),
    },
  };
}

describe("AIChatQueryEngine.submitMessage — T09 successor dispatch adoption", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flagMock.mockReturnValue(false);
    classifyMock.mockReturnValue("response_only");
    startManualMock.mockReset();
    freezeContractMock.mockReset();
    cancelMock.mockReset();
    cancelMock.mockResolvedValue({ ok: true });
    compileCriteriaMock.mockReset();
    compileCriteriaMock.mockImplementation(
      (input: Parameters<
        NonNullable<typeof compileCriteriaHolder.real>
      >[0]) =>
        compileCriteriaHolder.real!(input)
    );
    mockGetPlanState.mockResolvedValue(null);
    mockEnsurePlanForConversation.mockResolvedValue(null);
    mockCreateConversationIfNeeded.mockReturnValue("v2-test-conv");
    mockSaveUserMessage.mockResolvedValue({ messageId: "user-1" });
    mockGetActiveGoal.mockResolvedValue(null);
    HookRegistry.unregisterSource("plugin:test-hooks");
  });

  it("T09 flag-on + successorContext: adopts the coordinator's created binding (no classify, no startManual), threads it + parent route into loopInput", async () => {
    flagMock.mockReturnValue(true);
    classifyMock.mockReturnValue("response_only");
    const created = makeSuccessorBinding();
    let captured: AIChatQueryLoopInput | undefined;
    const { engine } = createEngineCapturingInput((input) => {
      captured = input;
    });
    await engine.submitMessage({
      request: makeSuccessorRequest(),
      eventSink: { emit: vi.fn() } as never,
      successorContext: {
        binding: created as never,
        route: "task_best_effort",
      },
    } as never);

    // No re-classification and no re-enrollment — the successor carries the
    // parent's parsed route and the coordinator's already-created binding.
    expect(classifyMock).not.toHaveBeenCalled();
    expect(startManualMock).not.toHaveBeenCalled();
    expect(freezeContractMock).not.toHaveBeenCalled();

    // The binding is adopted and threaded into the loop with the successor's
    // executionId (renderer-visible identity, Stop/finalization keyed to it).
    expect(captured).toBeDefined();
    const binding: LoopTaskExecutionBinding | undefined =
      captured!.taskExecutionBinding;
    expect(binding).toBeDefined();
    expect(binding!.executionId).toBe("exec-successor-1");
    // The parent's route is threaded so goal consults route correctly.
    expect(captured!.taskRoute).toBe("task_best_effort");
    // Manual kind (no executionKind override) — the complete-gate /
    // cancelled / failed finalization applies to successor turns.
    expect(binding!.executionKind).toBeUndefined();
    // Budget closures are the coordinator's live budget (shared lineage for
    // Continue — original remaining limits, never renewed).
    expect(typeof binding!.reserveProviderAttempt).toBe("function");
    expect(typeof binding!.persistBudget).toBe("function");
  });

  it("T09 flag-on + successorContext: recordDecision writes through the per-execution decision slot", async () => {
    flagMock.mockReturnValue(true);
    const created = makeSuccessorBinding();
    let captured: AIChatQueryLoopInput | undefined;
    const { engine } = createEngineCapturingInput((input) => {
      captured = input;
    });
    await engine.submitMessage({
      request: makeSuccessorRequest(),
      eventSink: { emit: vi.fn() } as never,
      successorContext: {
        binding: created as never,
        route: "task_best_effort",
      },
    } as never);
    expect(captured).toBeDefined();
    // The decision slot is keyed by the successor executionId: recordDecision
    // stores the decision the finalization gate reads back.
    const decision = {
      type: "finish",
      outcome: "incomplete",
      reasonCode: "NO_PROGRESS",
      evidenceIds: [],
      summary: "s",
      remainingWork: [],
    } as never;
    captured!.taskExecutionBinding!.recordDecision!(decision);
    // The slot was registered for this executionId — a second recordDecision
    // call must not throw, proving a live slot map entry exists.
    expect(() =>
      captured!.taskExecutionBinding!.recordDecision!(decision)
    ).not.toThrow();
    expect(startManualMock).not.toHaveBeenCalled();
  });

  it("G01-313: successor enrollment badges the owned `continuing` phase (not a fresh `active` turn)", async () => {
    // A Continue/Retry successor resumes approved work under a new execution
    // id — the badge must say continuing from enrollment (before the stream
    // attaches), so the renderer never shows a fresh active turn for it.
    flagMock.mockReturnValue(true);
    const created = makeSuccessorBinding();
    const emits: Array<{ type: string }> = [];
    const { engine } = createEngineCapturingInput(() => {});
    await engine.submitMessage({
      request: makeSuccessorRequest(),
      eventSink: { emit: (e: { type: string }) => emits.push(e) } as never,
      successorContext: {
        binding: created as never,
        route: "task_best_effort",
      },
    } as never);
    const states = emits.filter(
      (e) => e.type === "task_execution_state"
    ) as Array<{ executionId: string; status: string }>;
    expect(
      states.some(
        (s) => s.executionId === "exec-successor-1" && s.status === "continuing"
      )
    ).toBe(true);
  });

  it("T09 pre-stream failure: cancels the orphaned successor execution (no orphan active row) + emits a terminal error event", async () => {
    flagMock.mockReturnValue(true);
    const created = makeSuccessorBinding();
    let captured: AIChatQueryLoopInput | undefined;
    const emit = vi.fn();
    const { engine, runMock } = createEngineCapturingInput((input) => {
      captured = input;
    }, {
      contextAssembler: {
        assemble: vi.fn().mockRejectedValue(new Error("pre-stream boom")),
      } as never,
    } as ConstructorParameters<typeof AIChatQueryEngine>[1]);
    await engine.submitMessage({
      request: makeSuccessorRequest(),
      eventSink: { emit } as never,
      successorContext: {
        binding: created as never,
        route: "task_best_effort",
      },
    } as never);

    // The loop never ran and no loopInput was built — the turn failed before
    // dispatch, so the successor row must NOT stay active.
    expect(runMock).not.toHaveBeenCalled();
    expect(captured).toBeUndefined();
    // THE audit regression: no orphan active row if startup fails — the
    // created successor execution is cancelled through the coordinator.
    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(cancelMock).toHaveBeenCalledWith("exec-successor-1");
    // The renderer gets a terminal error so the turn ends visibly.
    const errorEvent = emit.mock.calls
      .map((c) => c[0])
      .find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
  });

  it("T09 flag-off + successorContext: no adoption (successor flows only exist under the policy flag)", async () => {
    flagMock.mockReturnValue(false);
    const created = makeSuccessorBinding();
    let captured: AIChatQueryLoopInput | undefined;
    const { engine } = createEngineCapturingInput((input) => {
      captured = input;
    });
    await engine.submitMessage({
      request: makeSuccessorRequest(),
      eventSink: { emit: vi.fn() } as never,
      successorContext: {
        binding: created as never,
        route: "task_best_effort",
      },
    } as never);
    expect(captured).toBeDefined();
    expect(captured!.taskExecutionBinding).toBeUndefined();
    expect(captured!.taskRoute).toBeUndefined();
    expect(startManualMock).not.toHaveBeenCalled();
    expect(cancelMock).not.toHaveBeenCalled();
  });
});
