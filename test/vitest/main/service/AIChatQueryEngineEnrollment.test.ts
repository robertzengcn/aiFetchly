// test/vitest/main/service/AIChatQueryEngineEnrollment.test.ts
//
// Slice 2 Unit 4 — Engine enrollment seam (GAP-S2 #6, FR-01/02/03/04/19,
// AC-01/02/03/26).
//
// When the completion-policy flag is on, AIChatQueryEngine.submitMessage
// resolves the request route, freezes a contract for verified tasks, calls
// coordinator.startManual, and threads the resulting LoopTaskExecutionBinding
// into loopInput.taskExecutionBinding (and through the three resume paths —
// covered structurally by the pending-turn field asserts in
// AIChatQueryEvents.test.ts). When the flag is off, the binding stays
// undefined and the loop input is byte-identical to legacy behavior.
//
// These tests lock:
//   - flag-on + task route → binding on loopInput with the created executionId
//   - flag-off → binding undefined on loopInput
//   - transport retry (reused) → no fresh binding, loopInput.taskExecutionBinding undefined
//   - submission conflict → no fresh binding, loopInput.taskExecutionBinding undefined
//   - response_only route → no enrollment (binding undefined)
//   - enrollment failure (startManual throws) → fail-closed, binding undefined
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
} = vi.hoisted(() => ({
  flagMock: vi.fn<() => boolean>(),
  classifyMock: vi.fn(),
  startManualMock: vi.fn(),
  freezeContractMock: vi.fn(),
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

// --- TaskRequestResolver mock: classify returns a configurable route ----
vi.mock("@/service/aiTaskExecution/TaskRequestResolver", () => ({
  TaskRequestResolver: vi.fn().mockImplementation(function () {
    return { classify: classifyMock };
  }),
}));

// --- TaskExecutionCoordinator mock: startManual + freezeContract --------
vi.mock("@/service/aiTaskExecution/TaskExecutionCoordinator", () => ({
  TaskExecutionCoordinator: vi.fn().mockImplementation(function () {
    return {
      startManual: startManualMock,
      freezeContract: freezeContractMock,
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

/**
 * Build an engine whose loop.run() captures the loopInput for assertion.
 * Returns the loop.run mock alongside the engine so T10 tests can assert
 * the dispatch was skipped (loop.run never called) on reuse/conflict.
 */
function createEngineCapturingInput(
  capture: (input: AIChatQueryLoopInput) => void
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
  return { engine: new AIChatQueryEngine(fakeLoop), runMock };
}

/** Minimal request the engine accepts for a non-plan interactive turn. */
function makeRequest(message = "Extract contacts from the uploaded CSV."): {
  conversationId?: string;
  message: string;
  submissionId?: string;
  model: string;
} {
  return { conversationId: "v2-test-conv", message, model: "gpt-4o" };
}

describe("AIChatQueryEngine.submitMessage — completion policy enrollment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flagMock.mockReturnValue(false);
    classifyMock.mockReturnValue("response_only");
    startManualMock.mockReset();
    freezeContractMock.mockReset();
    mockGetPlanState.mockResolvedValue(null);
    mockEnsurePlanForConversation.mockResolvedValue(null);
    mockCreateConversationIfNeeded.mockReturnValue("v2-test-conv");
    HookRegistry.unregisterSource("plugin:test-hooks");
  });

  it("flag-off: leaves taskExecutionBinding undefined on loopInput", async () => {
    flagMock.mockReturnValue(false);
    let captured: AIChatQueryLoopInput | undefined;
    const { engine } = createEngineCapturingInput((input) => {
      captured = input;
    });
    await engine.submitMessage({
      request: makeRequest(),
      eventSink: { emit: vi.fn() } as never,
    } as never);
    expect(captured).toBeDefined();
    expect(captured!.taskExecutionBinding).toBeUndefined();
    expect(startManualMock).not.toHaveBeenCalled();
  });

  it("flag-on + task_best_effort route: threads binding into loopInput", async () => {
    flagMock.mockReturnValue(true);
    classifyMock.mockReturnValue("task_best_effort");
    startManualMock.mockResolvedValue({
      status: "created",
      binding: {
        executionId: "exec-9",
        controller: { decide: vi.fn() },
        budget: {
          reserveContinuation: vi.fn(),
          reserveProviderAttempt: vi.fn(),
          reserveToolExecution: vi.fn(),
          reconcileTokens: vi.fn(),
          addActiveRuntime: vi.fn(),
        },
        route: "task_best_effort",
        contract: null,
        contractHash: null,
        ledgerId: "ledger-9",
        leaseGeneration: 0,
      } as never,
    });
    let captured: AIChatQueryLoopInput | undefined;
    const { engine } = createEngineCapturingInput((input) => {
      captured = input;
    });
    await engine.submitMessage({
      request: makeRequest(),
      eventSink: { emit: vi.fn() } as never,
    } as never);
    expect(startManualMock).toHaveBeenCalledTimes(1);
    expect(captured).toBeDefined();
    const binding: LoopTaskExecutionBinding | undefined =
      captured!.taskExecutionBinding;
    expect(binding).toBeDefined();
    expect(binding!.executionId).toBe("exec-9");
    // T05: the durable budget closures are wired by the engine enrollment
    // seam. They capture `execModule` (a real AiTaskExecutionModule) +
    // `created.ledgerId`/`leaseGeneration`/`executionId`, so they're
    // callable (not undefined) when the binding is accepted.
    expect(binding!.ledgerId).toBe("ledger-9");
    expect(binding!.leaseGeneration).toBe(0);
    expect(typeof binding!.persistBudget).toBe("function");
    expect(typeof binding!.reserveProviderAttempt).toBe("function");
    expect(typeof binding!.reserveToolExecution).toBe("function");
    expect(typeof binding!.reconcileTokens).toBe("function");
    expect(typeof binding!.addActiveRuntime).toBe("function");
  });

  it("flag-on + response_only route: does not enroll (binding undefined)", async () => {
    flagMock.mockReturnValue(true);
    classifyMock.mockReturnValue("response_only");
    let captured: AIChatQueryLoopInput | undefined;
    const { engine } = createEngineCapturingInput((input) => {
      captured = input;
    });
    await engine.submitMessage({
      request: makeRequest("What does ROI mean?"),
      eventSink: { emit: vi.fn() } as never,
    } as never);
    expect(startManualMock).not.toHaveBeenCalled();
    expect(captured!.taskExecutionBinding).toBeUndefined();
  });

  it("T10 flag-on + transport retry (reused): no dispatch, terminal complete event emitted (FR-17/21, AC-26)", async () => {
    flagMock.mockReturnValue(true);
    classifyMock.mockReturnValue("task_best_effort");
    startManualMock.mockResolvedValue({
      status: "reused",
      existing: {
        executionId: "exec-old",
        finalized: false,
        taskOutcome: null,
      },
    });
    let captured: AIChatQueryLoopInput | undefined;
    const { engine, runMock } = createEngineCapturingInput((input) => {
      captured = input;
    });
    const emit = vi.fn();
    await engine.submitMessage({
      request: makeRequest(),
      eventSink: { emit } as never,
    } as never);
    expect(startManualMock).toHaveBeenCalledTimes(1);
    // T10: the loop never ran — no provider call, no renewed budget, no
    // repeated effect. The DB-level dedup alone never stopped the maker; the
    // dispatch gate does.
    expect(runMock).not.toHaveBeenCalled();
    expect(captured).toBeUndefined();
    // The engine emits a terminal `complete` event so the renderer ends the
    // turn instead of running new work. The prior turn's assistant message
    // is already in history; a transport retry re-fetches it.
    const completeEvent = emit.mock.calls
      .map((c) => c[0])
      .find((e) => e.type === "complete");
    expect(completeEvent).toBeDefined();
  });

  it("T10 flag-on + submission conflict: no dispatch, SUBMISSION_CONFLICT error before work (FR-17/21, AC-26)", async () => {
    flagMock.mockReturnValue(true);
    classifyMock.mockReturnValue("task_best_effort");
    startManualMock.mockResolvedValue({
      status: "conflict",
      reasonCode: "SUBMISSION_CONFLICT",
      existing: {
        executionId: "exec-conflict",
        finalized: false,
        taskOutcome: null,
      },
    });
    let captured: AIChatQueryLoopInput | undefined;
    const { engine, runMock } = createEngineCapturingInput((input) => {
      captured = input;
    });
    const emit = vi.fn();
    await engine.submitMessage({
      request: makeRequest(),
      eventSink: { emit } as never,
    } as never);
    // T10: the loop never ran — different requestHash on the same
    // submissionId surfaces SUBMISSION_CONFLICT before any work.
    expect(runMock).not.toHaveBeenCalled();
    expect(captured).toBeUndefined();
    const errorEvent = emit.mock.calls
      .map((c) => c[0])
      .find(
        (e) => e.type === "error" && String(e.errorMessage).includes("SUBMISSION_CONFLICT")
      );
    expect(errorEvent).toBeDefined();
  });

  it("flag-on + startManual throws: fail-closed (binding undefined, turn proceeds)", async () => {
    flagMock.mockReturnValue(true);
    classifyMock.mockReturnValue("task_best_effort");
    startManualMock.mockRejectedValue(new Error("db connection lost"));
    let captured: AIChatQueryLoopInput | undefined;
    const { engine } = createEngineCapturingInput((input) => {
      captured = input;
    });
    await engine.submitMessage({
      request: makeRequest(),
      eventSink: { emit: vi.fn() } as never,
    } as never);
    expect(startManualMock).toHaveBeenCalledTimes(1);
    // Fail-closed: the turn still ran (loop.run was called) with no binding.
    expect(captured).toBeDefined();
    expect(captured!.taskExecutionBinding).toBeUndefined();
  });

  it("flag-on + task_verified route: freezes a verified contract before startManual", async () => {
    flagMock.mockReturnValue(true);
    classifyMock.mockReturnValue("task_verified");
    const fakeContract = {
      schemaVersion: 1 as const,
      contractId: "contract-x",
      contractHash: "hash-x",
      objective: "Extract contacts",
      sourceUserMessageId: "user-1",
      approvedSourceMessageIds: ["user-1"],
      mode: "verified" as const,
      criteria: [],
    };
    freezeContractMock.mockReturnValue(fakeContract);
    startManualMock.mockResolvedValue({
      status: "created",
      binding: {
        executionId: "exec-v",
        controller: { decide: vi.fn() },
        budget: { reserveContinuation: vi.fn() },
        route: "task_verified",
        contract: fakeContract,
        contractHash: "hash-x",
      },
    });
    let captured: AIChatQueryLoopInput | undefined;
    const { engine } = createEngineCapturingInput((input) => {
      captured = input;
    });
    await engine.submitMessage({
      request: makeRequest(),
      eventSink: { emit: vi.fn() } as never,
    } as never);
    expect(freezeContractMock).toHaveBeenCalledTimes(1);
    expect(freezeContractMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "verified" })
    );
    expect(startManualMock).toHaveBeenCalledTimes(1);
    expect(startManualMock).toHaveBeenCalledWith(
      expect.objectContaining({ contract: fakeContract })
    );
    expect(captured!.taskExecutionBinding).toBeDefined();
    expect(captured!.taskExecutionBinding!.executionId).toBe("exec-v");
  });
});
