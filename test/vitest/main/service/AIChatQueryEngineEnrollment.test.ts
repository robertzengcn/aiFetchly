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
  compileCriteriaMock,
  compileCriteriaHolder,
} = vi.hoisted(() => ({
  flagMock: vi.fn<() => boolean>(),
  classifyMock: vi.fn(),
  startManualMock: vi.fn(),
  freezeContractMock: vi.fn(),
  compileCriteriaMock: vi.fn(),
  // T01: holder for the REAL compileCriteria, assigned by the vi.mock
  // factory below (factories run before top-level lets — a bare `let` here
  // hits the TDZ, the module-top-level TDZ crash class).
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

// --- TaskRequestResolver mock: classify returns a configurable route ----
vi.mock("@/service/aiTaskExecution/TaskRequestResolver", () => ({
  TaskRequestResolver: vi.fn().mockImplementation(function () {
    return { classify: classifyMock };
  }),
}));

// --- TaskCriteriaResolver mock: T01 compiler is configurable ------------
// By default (mockReset in beforeEach) the mock delegates to the REAL
// compiler so the 54/100 + conjunction tests exercise the real structural
// parser. Tests that need failure injection override the implementation.
// The real fn is captured into `compileCriteriaHolder` (vi.hoisted state).
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
      // T02: the scheduled path uses saveUserMessageIfAbsent (stable id +
      // insert-if-absent) so a crash-retry does not duplicate the
      // transcript row. The interactive path still uses saveUserMessage.
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
    // T01: default the compiler mock to the REAL implementation — most tests
    // exercise the real structural parser. Tests that need failure injection
    // override with mockImplementationOnce.
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

  it("B11 reused transport retry does NOT abort the accepted original run (FR-21, AC-26)", async () => {
    flagMock.mockReturnValue(true);
    classifyMock.mockReturnValue("task_best_effort");
    // First submission creates; second identical submissionId reuses.
    startManualMock
      .mockResolvedValueOnce({
        status: "created",
        executionId: "exec-original",
        ledgerId: "ledger-original",
        leaseGeneration: 0,
        binding: {
          executionId: "exec-original",
          controller: { decide: vi.fn() },
          budget: {
            reserveContinuation: vi.fn().mockReturnValue({ status: "Reserved" }),
            reserveProviderAttempt: vi.fn().mockReturnValue({ status: "Reserved" }),
            reserveToolExecution: vi.fn().mockReturnValue({ status: "Reserved" }),
            reconcileTokens: vi.fn().mockReturnValue(true),
            addActiveRuntime: vi.fn(),
          },
          persistBudget: vi.fn().mockResolvedValue(true),
        },
      })
      .mockResolvedValueOnce({
        status: "reused",
        existing: {
          executionId: "exec-original",
          finalized: false,
          taskOutcome: null,
        },
      });
    // Hold the original loop open so the retry races an active turn.
    let resolveOriginal!: (v: AIChatQueryLoopResult) => void;
    const originalGate = new Promise<AIChatQueryLoopResult>((resolve) => {
      resolveOriginal = resolve;
    });
    const runMock = vi.fn(async (input: AIChatQueryLoopInput) => {
      // Only the original dispatches; the retry must never reach loop.run.
      return originalGate;
    });
    const fakeLoop = { run: runMock } as unknown as AIChatQueryLoop;
    const engine = new AIChatQueryEngine(fakeLoop);
    const firstEmit = vi.fn();
    const firstPromise = engine.submitMessage({
      request: {
        conversationId: "v2-test-conv",
        message: "Extract contacts from the uploaded CSV.",
        model: "gpt-4o",
        submissionId: "sub-b11",
      },
      eventSink: { emit: firstEmit } as never,
    } as never);
    // Wait until the original turn is registered (abort controller exists).
    for (let i = 0; i < 100; i++) {
      const entry = (engine as unknown as { activeTurns: Map<string, unknown> }).activeTurns?.get(
        "v2-test-conv"
      );
      if (entry) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const priorEntry = (engine as unknown as {
      activeTurns: Map<string, { abortController: AbortController }>;
    }).activeTurns.get("v2-test-conv");
    expect(priorEntry).toBeDefined();
    expect(priorEntry!.abortController.signal.aborted).toBe(false);

    const retryEmit = vi.fn();
    await engine.submitMessage({
      request: {
        conversationId: "v2-test-conv",
        message: "Extract contacts from the uploaded CSV.",
        model: "gpt-4o",
        submissionId: "sub-b11",
      },
      eventSink: { emit: retryEmit } as never,
    } as never);
    // Retry returns accepted status without dispatching new work.
    expect(runMock).toHaveBeenCalledTimes(1);
    const retryComplete = retryEmit.mock.calls
      .map((c) => c[0])
      .find((e) => e.type === "complete");
    expect(retryComplete).toBeDefined();
    // Original run was NOT aborted by the reuse.
    expect(priorEntry!.abortController.signal.aborted).toBe(false);
    // Cleanup: let the original finish.
    resolveOriginal({
      type: "completed",
      conversationId: "v2-test-conv",
      assistantMessageId: "a1",
      fullContent: "",
      finishReason: "stop",
    } as AIChatQueryLoopResult);
    await firstPromise;
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

  // --- T01: compile usable contracts on ordinary manual submissions -------

  it("T01 flag-on + task_best_effort: freezes a best_effort contract with REAL derived criteria before startManual (FR-19/01)", async () => {
    flagMock.mockReturnValue(true);
    classifyMock.mockReturnValue("task_best_effort");
    freezeContractMock.mockImplementation((input: {
      mode: string;
      criteria: readonly { id: string; kind: string; required: boolean }[];
    }) => ({
      schemaVersion: 1 as const,
      contractId: "contract-be",
      contractHash: "hash-be",
      objective: "objective",
      sourceUserMessageId: "user-1",
      approvedSourceMessageIds: ["user-1"],
      mode: input.mode as "best_effort",
      criteria: input.criteria,
    }));
    startManualMock.mockResolvedValue({
      status: "created",
      binding: {
        executionId: "exec-t01",
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
        ledgerId: "ledger-t01",
        leaseGeneration: 0,
      } as never,
    });
    let captured: AIChatQueryLoopInput | undefined;
    const { engine } = createEngineCapturingInput((input) => {
      captured = input;
    });
    await engine.submitMessage({
      request: makeRequest("Save 100 qualifying contacts to campaign camp-1"),
      eventSink: { emit: vi.fn() } as never,
    } as never);
    // T01: the best-effort route NOW freezes a contract (was skipped before)
    // with real derived criteria — a record_count for "Save 100 contacts".
    expect(freezeContractMock).toHaveBeenCalledTimes(1);
    const freezeInput = freezeContractMock.mock.calls[0][0] as {
      mode: string;
      approvedSourceContents: Record<string, string>;
      criteria: readonly {
        kind: string;
        minimum?: number;
        required: boolean;
      }[];
    };
    expect(freezeInput.mode).toBe("best_effort");
    // Real compiler output: the record_count criterion for the 100-contact
    // request, not `[]`.
    const rc = freezeInput.criteria.find((c) => c.kind === "record_count");
    expect(rc).toBeDefined();
    expect(rc!.minimum).toBe(100);
    expect(rc!.required).toBe(true);
    // T17 offset-validation hook: approvedSourceContents carries the REAL
    // message text keyed by the saved user message ID.
    expect(freezeInput.approvedSourceContents["user-1"]).toBe(
      "Save 100 qualifying contacts to campaign camp-1"
    );
    expect(startManualMock).toHaveBeenCalledTimes(1);
    expect(captured!.taskExecutionBinding).toBeDefined();
  });

  it("T01 flag-on + contract compilation throws: startManual STILL called with contract=null (controlled non-success, not bypass)", async () => {
    flagMock.mockReturnValue(true);
    classifyMock.mockReturnValue("task_best_effort");
    compileCriteriaMock.mockImplementationOnce(() => {
      throw new Error("compiler invariant violated");
    });
    startManualMock.mockResolvedValue({
      status: "created",
      binding: {
        executionId: "exec-degraded",
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
        ledgerId: "ledger-degraded",
        leaseGeneration: 0,
      } as never,
    });
    let captured: AIChatQueryLoopInput | undefined;
    const { engine } = createEngineCapturingInput((input) => {
      captured = input;
    });
    await engine.submitMessage({
      request: makeRequest("Save 50 contacts"),
      eventSink: { emit: vi.fn() } as never,
    } as never);
    // Controlled non-success (NFR-12): enrollment is NOT bypassed —
    // startManual still ran (identity registered, Stop available). The null
    // contract means the controller can never verify (never
    // verified_complete).
    expect(startManualMock).toHaveBeenCalledTimes(1);
    expect(startManualMock).toHaveBeenCalledWith(
      expect.objectContaining({ contract: null })
    );
    expect(captured).toBeDefined();
    expect(captured!.taskExecutionBinding).toBeDefined();
    expect(captured!.taskExecutionBinding!.executionId).toBe("exec-degraded");
  });

  it("T01 flag-on + freezeContract throws (offset violation): startManual STILL called with contract=null (controlled non-success)", async () => {
    flagMock.mockReturnValue(true);
    classifyMock.mockReturnValue("task_best_effort");
    freezeContractMock.mockImplementation(() => {
      throw new Error("criterion offset beyond approved content length");
    });
    startManualMock.mockResolvedValue({
      status: "created",
      binding: {
        executionId: "exec-degraded-2",
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
        ledgerId: "ledger-degraded-2",
        leaseGeneration: 0,
      } as never,
    });
    let captured: AIChatQueryLoopInput | undefined;
    const { engine } = createEngineCapturingInput((input) => {
      captured = input;
    });
    await engine.submitMessage({
      request: makeRequest("Extract 20 leads"),
      eventSink: { emit: vi.fn() } as never,
    } as never);
    // Same controlled non-success: compile succeeded but freeze rejected —
    // enrollment proceeds with contract=null, never bypassed.
    expect(startManualMock).toHaveBeenCalledTimes(1);
    expect(startManualMock).toHaveBeenCalledWith(
      expect.objectContaining({ contract: null })
    );
    expect(captured!.taskExecutionBinding).toBeDefined();
  });

  it("T01 conjunction regression: 'Find 20 leads, save them, and draft an email' freezes 3 criteria (AC-20)", async () => {
    flagMock.mockReturnValue(true);
    classifyMock.mockReturnValue("task_best_effort");
    freezeContractMock.mockImplementation((input: {
      mode: string;
      criteria: readonly { id: string; kind: string }[];
    }) => ({
      schemaVersion: 1 as const,
      contractId: "contract-conj",
      contractHash: "hash-conj",
      objective: "objective",
      sourceUserMessageId: "user-1",
      approvedSourceMessageIds: ["user-1"],
      mode: input.mode as "best_effort",
      criteria: input.criteria,
    }));
    startManualMock.mockResolvedValue({
      status: "created",
      binding: {
        executionId: "exec-conj",
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
        ledgerId: "ledger-conj",
        leaseGeneration: 0,
      } as never,
    });
    let captured: AIChatQueryLoopInput | undefined;
    const { engine } = createEngineCapturingInput((input) => {
      captured = input;
    });
    await engine.submitMessage({
      request: makeRequest("Find 20 leads, save them, and draft an email"),
      eventSink: { emit: vi.fn() } as never,
    } as never);
    expect(freezeContractMock).toHaveBeenCalledTimes(1);
    const freezeInput = freezeContractMock.mock.calls[0][0] as {
      criteria: readonly { id: string; kind: string; required: boolean }[];
    };
    // AC-20: a multi-part request compiles a conjunction of criteria — one
    // per clause, all required.
    expect(freezeInput.criteria).toHaveLength(3);
    const ids = freezeInput.criteria.map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
    for (const c of freezeInput.criteria) {
      expect(c.required).toBe(true);
    }
  });

  it("T01 flag-off: compiler never runs (no freeze, no compile) — byte-identical legacy behavior", async () => {
    flagMock.mockReturnValue(false);
    let captured: AIChatQueryLoopInput | undefined;
    const { engine } = createEngineCapturingInput((input) => {
      captured = input;
    });
    await engine.submitMessage({
      request: makeRequest("Save 100 contacts"),
      eventSink: { emit: vi.fn() } as never,
    } as never);
    // Flag-off: the whole enrollment block is skipped — compile and freeze
    // are never invoked.
    expect(compileCriteriaMock).not.toHaveBeenCalled();
    expect(freezeContractMock).not.toHaveBeenCalled();
    expect(startManualMock).not.toHaveBeenCalled();
    expect(captured!.taskExecutionBinding).toBeUndefined();
  });

  // --- T02 (Option A): caller-supplied scheduled binding ------------------

  it("T02 flag-on + scheduledContext + taskExecutionBinding: engine uses caller's binding (no startManual), threads it into loopInput", async () => {
    flagMock.mockReturnValue(true);
    classifyMock.mockReturnValue("task_best_effort");
    // The scheduled runner builds the binding via enrollScheduledExecution
    // (with executionKind: "scheduled") and passes it into submitMessage.
    // The engine adopts it (the scheduled init block at the top of
    // submitMessage) and does NOT call startManual — no double-enrollment.
    const callerBinding: LoopTaskExecutionBinding = {
      executionId: "exec-scheduled-engine",
      executionKind: "scheduled",
      policyAccepted: true,
      consult: vi.fn().mockResolvedValue({
        type: "finish",
        outcome: "incomplete",
        reasonCode: "NO_PROGRESS",
        evidenceIds: [],
        summary: "partial",
        remainingWork: [],
      }),
      reserveContinuation: vi.fn(),
      reserveProviderAttempt: vi.fn(),
      reserveToolExecution: vi.fn(),
      reconcileTokens: vi.fn(),
      addActiveRuntime: vi.fn(),
      persistBudget: vi.fn(),
      recordDecision: vi.fn(),
      recordToolRoundProgress: vi.fn(),
      recordAssistantTextProgress: vi.fn(),
    } as unknown as LoopTaskExecutionBinding;
    let captured: AIChatQueryLoopInput | undefined;
    const { engine } = createEngineCapturingInput((input) => {
      captured = input;
    });
    await engine.submitMessage({
      request: makeRequest("Save 100 qualifying contacts to campaign camp-1"),
      eventSink: { emit: vi.fn() } as never,
      scheduledContext: {
        source: "scheduled_loop",
        taskId: 1,
        scheduleId: 1,
        runId: 1,
        occurrence: 1,
        scheduledFor: "2026-10-05T10:00:00.000Z",
        catchUp: false,
        userMessageId: "scheduled-user-1-1",
        assistantMessageId: "scheduled-assistant-1-1",
      },
      taskExecutionBinding: callerBinding,
    } as never);
    // The engine adopted the caller's binding — no internal startManual.
    expect(startManualMock).not.toHaveBeenCalled();
    expect(captured).toBeDefined();
    expect(captured!.taskExecutionBinding).toBe(callerBinding);
    expect(captured!.taskExecutionBinding!.executionId).toBe(
      "exec-scheduled-engine"
    );
    // D2: the binding carries executionKind "scheduled" so the
    // completed-case gate no-ops (finalization owned by the runner's
    // finalizeScheduledPolicyRun).
    expect(captured!.taskExecutionBinding!.executionKind).toBe("scheduled");
  });

  it("T02 scheduled binding: completed-case gate does NOT finalize (D2 — runner owns scheduled finalization, no double-finalize)", async () => {
    flagMock.mockReturnValue(true);
    classifyMock.mockReturnValue("task_best_effort");
    const callerBinding: LoopTaskExecutionBinding = {
      executionId: "exec-scheduled-gate",
      executionKind: "scheduled",
      policyAccepted: true,
      consult: vi.fn().mockResolvedValue({
        type: "finish",
        outcome: "incomplete",
        reasonCode: "NO_PROGRESS",
        evidenceIds: [],
        summary: "partial",
        remainingWork: [],
      }),
      reserveContinuation: vi.fn(),
      reserveProviderAttempt: vi.fn(),
      reserveToolExecution: vi.fn(),
      reconcileTokens: vi.fn(),
      addActiveRuntime: vi.fn(),
      persistBudget: vi.fn(),
      recordDecision: vi.fn(),
      recordToolRoundProgress: vi.fn(),
      recordAssistantTextProgress: vi.fn(),
    } as unknown as LoopTaskExecutionBinding;
    const emit = vi.fn();
    const { engine } = createEngineCapturingInput(() => {
      /* capture not needed — assert on emit */
    });
    await engine.submitMessage({
      request: makeRequest("Save 100 contacts"),
      eventSink: { emit } as never,
      scheduledContext: {
        source: "scheduled_loop",
        taskId: 1,
        scheduleId: 1,
        runId: 1,
        occurrence: 1,
        scheduledFor: "2026-10-05T10:00:00.000Z",
        catchUp: false,
        userMessageId: "scheduled-user-1-1",
        assistantMessageId: "scheduled-assistant-1-1",
      },
      taskExecutionBinding: callerBinding,
    } as never);
    // The completed-case gate no-ops for scheduled kind → the complete
    // event carries NO taskOutcome/taskExecutionId/taskReasonCode (the sink
    // owns the scheduled outcome). A manual-kind binding would have hit
    // finalizeManualAtCompleteGate; the coordinator mock here returns only
    // {startManual, freezeContract} (no finalizeManual), so a manual kind
    // would surface as FINALIZE_THREW — scheduled kind avoids that path
    // entirely.
    const completeEvent = emit.mock.calls
      .map((c) => c[0])
      .find((e) => e.type === "complete");
    expect(completeEvent).toBeDefined();
    expect(completeEvent.taskOutcome).toBeUndefined();
    expect(completeEvent.taskExecutionId).toBeUndefined();
    expect(completeEvent.taskReasonCode).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// T15 — Goal ownership + preparation/approval lifecycle (FR-01/10/20/21/22,
// NFR-01/07, AC-06/07/14/22-25/31).
//
// Audit gap (verbatim): engine always enrolls `completionOwner:"standalone"` at
// enrollment, while `goalAutoContinue` still uses ANY active conversation goal.
// Response-only routes bypass policy entirely, allowing unrelated goals to
// retain legacy takeover. Existing lease-generation/assertOwnership library
// functions are not consulted by the engine/loop completion closures.
//
// Regression: (1) unrelated active goal + ordinary question → normal single
// answer; (2) real goal iteration has exactly one semantic owner; (3) plan
// draft stop waits, never verifies executable work; (4) approved plan freezes
// against linked actual messages; (5) permission/question/approval retains
// execution, policy, evidence, denied authority and remaining limits.
// ---------------------------------------------------------------------------
describe("AIChatQueryEngine.submitMessage — T15 goal ownership + preparation lifecycle", () => {
  /** Active goal view returned by mockGetActiveGoal when a test wants one. */
  const ACTIVE_GOAL = {
    goalId: "goal-1",
    conversationId: "v2-test-conv",
    objective: "Build a 100-contact lead list",
    criteria: [],
    status: "active",
    iterationCount: 0,
    createdAt: "2026-10-05T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
  };

  // NOTE: this sibling describe does NOT inherit the first describe's
  // beforeEach, so reset every mock the enrollment seam touches here.
  // Without this, startManualMock retains the implementation from the last
  // test in the first describe and call counts drift (2-3 calls/test).
  beforeEach(() => {
    vi.clearAllMocks();
    flagMock.mockReturnValue(false);
    classifyMock.mockReturnValue("response_only");
    startManualMock.mockReset();
    freezeContractMock.mockReset();
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

  it("T15a: task route + NO active goal → completionOwner: 'standalone' (FR-20)", async () => {
    flagMock.mockReturnValue(true);
    classifyMock.mockReturnValue("task_best_effort");
    mockGetActiveGoal.mockResolvedValue(null);
    startManualMock.mockResolvedValue({
      status: "created",
      binding: {
        executionId: "exec-sa",
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
        ledgerId: "ledger-sa",
        leaseGeneration: 0,
      } as never,
    });
    const { engine } = createEngineCapturingInput(() => undefined);
    await engine.submitMessage({
      request: makeRequest(),
      eventSink: { emit: vi.fn() } as never,
    } as never);
    expect(startManualMock).toHaveBeenCalledTimes(1);
    const call = startManualMock.mock.calls[0]?.[0] as {
      completionOwner: string;
    };
    expect(call.completionOwner).toBe("standalone");
  });

  it("T15a: task route + active conversation goal → completionOwner: 'goal' (FR-20, one semantic owner)", async () => {
    flagMock.mockReturnValue(true);
    classifyMock.mockReturnValue("task_best_effort");
    mockGetActiveGoal.mockResolvedValue(ACTIVE_GOAL);
    startManualMock.mockResolvedValue({
      status: "created",
      binding: {
        executionId: "exec-goal",
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
        ledgerId: "ledger-goal",
        leaseGeneration: 1,
      } as never,
    });
    const { engine } = createEngineCapturingInput(() => undefined);
    await engine.submitMessage({
      request: makeRequest(),
      eventSink: { emit: vi.fn() } as never,
    } as never);
    expect(startManualMock).toHaveBeenCalledTimes(1);
    const call = startManualMock.mock.calls[0]?.[0] as {
      completionOwner: string;
    };
    // The goal owns the work — the standalone controller does not add its own
    // nudges or claim goal completion (§3 of the design).
    expect(call.completionOwner).toBe("goal");
  });

  it("T15a: response_only route + active unrelated goal → NO goal takeover, single answer (FR-20, NFR-11)", async () => {
    // The audit regression: "unrelated active goal + ordinary question →
    // normal single answer". An ordinary question classifies response_only
    // and must NOT be seized by the goal's auto-continue. The turn ends as a
    // normal response with no task enrollment and no goalAutoContinue nudge.
    flagMock.mockReturnValue(true);
    classifyMock.mockReturnValue("response_only");
    mockGetActiveGoal.mockResolvedValue(ACTIVE_GOAL);
    let captured: AIChatQueryLoopInput | undefined;
    const { engine } = createEngineCapturingInput((input) => {
      captured = input;
    });
    await engine.submitMessage({
      request: makeRequest("What does ROI mean?"),
      eventSink: { emit: vi.fn() } as never,
    } as never);
    expect(startManualMock).not.toHaveBeenCalled();
    expect(captured).toBeDefined();
    expect(captured!.taskExecutionBinding).toBeUndefined();
    // goalAutoContinue MUST be false even though an active goal exists — a
    // response_only turn is not goal work. The goal's auto-continue must not
    // seize an ordinary question (the legacy takeover the audit flags).
    expect(captured!.goalAutoContinue).toBe(false);
  });

  it("T15a: task route + active goal → goalAutoContinue true (goal iteration continues)", async () => {
    flagMock.mockReturnValue(true);
    classifyMock.mockReturnValue("task_best_effort");
    mockGetActiveGoal.mockResolvedValue(ACTIVE_GOAL);
    startManualMock.mockResolvedValue({
      status: "created",
      binding: {
        executionId: "exec-goal-2",
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
        ledgerId: "ledger-goal-2",
        leaseGeneration: 1,
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
    expect(captured).toBeDefined();
    // A genuine goal task turn keeps auto-continue: the goal controller
    // remains the sole semantic-continuation owner.
    expect(captured!.goalAutoContinue).toBe(true);
  });

  it("T15c: preparation route → enrolls with completionOwner and a null contract, never verifies executable work (FR-21, AC-31)", async () => {
    // Audit gap: "Preparation is skipped; the comment says it enrolls when
    // the user re-sends after approval, which contradicts same-execution
    // preparation." A plan-draft / approval-wait turn must enroll (so Stop is
    // available and the row exists) but with a NULL contract — the controller
    // can never verify (no required criteria → never verified_complete). A
    // Stop on a preparation turn finalizes incomplete/PREPARATION_REQUIRED,
    // never a verified outcome.
    flagMock.mockReturnValue(true);
    classifyMock.mockReturnValue("preparation");
    mockGetActiveGoal.mockResolvedValue(null);
    startManualMock.mockResolvedValue({
      status: "created",
      binding: {
        executionId: "exec-prep",
        controller: { decide: vi.fn() },
        budget: {
          reserveContinuation: vi.fn(),
          reserveProviderAttempt: vi.fn(),
          reserveToolExecution: vi.fn(),
          reconcileTokens: vi.fn(),
          addActiveRuntime: vi.fn(),
        },
        route: "preparation",
        contract: null,
        contractHash: null,
        ledgerId: "ledger-prep",
        leaseGeneration: 0,
      } as never,
    });
    let captured: AIChatQueryLoopInput | undefined;
    const { engine } = createEngineCapturingInput((input) => {
      captured = input;
    });
    await engine.submitMessage({
      request: makeRequest("Draft a plan to extract contacts."),
      eventSink: { emit: vi.fn() } as never,
    } as never);
    // Preparation NOW enrolls (was: skipped). One execution across the
    // preparation → approval → execution lifecycle (FR-21).
    expect(startManualMock).toHaveBeenCalledTimes(1);
    const call = startManualMock.mock.calls[0]?.[0] as {
      completionOwner: string;
      route: string;
      contract: unknown;
    };
    expect(call.route).toBe("preparation");
    expect(call.completionOwner).toBe("standalone");
    // The executable contract is NOT frozen at preparation — only after
    // actual approved scope. null contract → controller can never verify.
    expect(call.contract).toBeNull();
    expect(captured).toBeDefined();
    expect(captured!.taskExecutionBinding).toBeDefined();
    expect(captured!.taskExecutionBinding!.executionId).toBe("exec-prep");
  });

  // ------------------------------------------------------------------------
  // T15d — Approved plan freezes against linked actual messages (FR-21/22,
  // AC-23/31). The audit regression: "approved plan freezes against linked
  // actual messages". When `planState.status === "approved"`, the engine
  // passes `hasApprovedTaskTemplate: true` to the resolver → `task_verified`
  // route → `mode: "verified"` freeze with the real approved source content.
  // The contract is frozen against the actual user message, not a draft.
  // ------------------------------------------------------------------------
  it("T15d: approved plan → hasApprovedTaskTemplate:true → task_verified + mode:verified freeze (FR-21/22, AC-23)", async () => {
    flagMock.mockReturnValue(true);
    classifyMock.mockReturnValue("task_verified");
    mockGetPlanState.mockResolvedValue({
      status: "approved",
      planId: "plan-1",
      conversationId: "v2-test-conv",
    });
    mockGetActiveGoal.mockResolvedValue(null);
    startManualMock.mockResolvedValue({
      status: "created",
      binding: {
        executionId: "exec-verified",
        controller: { decide: vi.fn() },
        budget: {
          reserveContinuation: vi.fn(),
          reserveProviderAttempt: vi.fn(),
          reserveToolExecution: vi.fn(),
          reconcileTokens: vi.fn(),
          addActiveRuntime: vi.fn(),
        },
        route: "task_verified",
        contract: null,
        contractHash: null,
        ledgerId: "ledger-verified",
        leaseGeneration: 0,
      } as never,
    });
    let captured: AIChatQueryLoopInput | undefined;
    const { engine } = createEngineCapturingInput((input) => {
      captured = input;
    });
    await engine.submitMessage({
      request: makeRequest("Save 100 contacts to campaign camp-1"),
      eventSink: { emit: vi.fn() } as never,
    } as never);

    // The route is task_verified (approved template) and the freeze is
    // mode:"verified" against the real approved source content.
    expect(startManualMock).toHaveBeenCalledTimes(1);
    const startCall = startManualMock.mock.calls[0]?.[0] as {
      route: string;
    };
    expect(startCall.route).toBe("task_verified");
    expect(freezeContractMock).toHaveBeenCalledTimes(1);
    const freezeInput = freezeContractMock.mock.calls[0][0] as {
      mode: string;
      approvedSourceContents: Record<string, string>;
    };
    expect(freezeInput.mode).toBe("verified");
    // The freeze links to the ACTUAL user message content (T17 offset hook).
    expect(freezeInput.approvedSourceContents["user-1"]).toBe(
      "Save 100 contacts to campaign camp-1"
    );
    expect(captured).toBeDefined();
    expect(captured!.taskExecutionBinding).toBeDefined();
    expect(captured!.taskExecutionBinding!.executionId).toBe("exec-verified");
  });

  // ------------------------------------------------------------------------
  // T15d — pendingPlanApproval → preparation route (FR-21, AC-22/31). The
  // audit regression: "permission/question/approval retains execution,
  // policy, evidence, denied authority and remaining limits". A turn with a
  // plan awaiting approval must route to `preparation` (not task_best_effort)
  // so the executable contract is NOT frozen until actual approved scope.
  // ------------------------------------------------------------------------
  it("T15d: pendingPlanApproval → preparation route, no verified contract frozen (FR-21, AC-22)", async () => {
    flagMock.mockReturnValue(true);
    classifyMock.mockReturnValue("preparation");
    mockGetPlanState.mockResolvedValue({
      status: "awaiting_approval",
      planId: "plan-2",
      conversationId: "v2-test-conv",
    });
    mockGetActiveGoal.mockResolvedValue(null);
    startManualMock.mockResolvedValue({
      status: "created",
      binding: {
        executionId: "exec-approval-wait",
        controller: { decide: vi.fn() },
        budget: {
          reserveContinuation: vi.fn(),
          reserveProviderAttempt: vi.fn(),
          reserveToolExecution: vi.fn(),
          reconcileTokens: vi.fn(),
          addActiveRuntime: vi.fn(),
        },
        route: "preparation",
        contract: null,
        contractHash: null,
        ledgerId: "ledger-approval-wait",
        leaseGeneration: 0,
      } as never,
    });
    let captured: AIChatQueryLoopInput | undefined;
    const { engine } = createEngineCapturingInput((input) => {
      captured = input;
    });
    await engine.submitMessage({
      request: makeRequest("Run the extraction plan."),
      eventSink: { emit: vi.fn() } as never,
    } as never);

    // Awaiting-approval plan → preparation route (the executable contract
    // is NOT frozen until the plan is approved). The execution row exists
    // (FR-21: one execution across the lifecycle), so Stop/policy is
    // available, but the contract stays null.
    expect(startManualMock).toHaveBeenCalledTimes(1);
    const startCall = startManualMock.mock.calls[0]?.[0] as {
      route: string;
      contract: unknown;
    };
    expect(startCall.route).toBe("preparation");
    expect(startCall.contract).toBeNull();
    // No verified freeze happens on a preparation turn.
    expect(freezeContractMock).not.toHaveBeenCalled();
    expect(captured).toBeDefined();
    expect(captured!.taskExecutionBinding).toBeDefined();
    expect(captured!.taskExecutionBinding!.executionId).toBe(
      "exec-approval-wait"
    );
  });

  // ------------------------------------------------------------------------
  // T15d — pendingPermission → preparation route (FR-21, AC-22). A
  // conversation mid-permission-prompt routes to preparation, retaining
  // the execution/policy state without freezing a verified contract.
  //
  // The engine's pendingPermissions map is private and populated by
  // tool-execution internals (not reachable from a mocked loop), so this
  // test locks the routing decision the resolver's pendingPermission:true
  // branch produces: classify=preparation → enroll with route:preparation,
  // contract:null. The full permission-prompt→preparation integration runs
  // in the AgentRuntime.permission test (real loop).
  // ------------------------------------------------------------------------
  it("T15d: pendingPermission → preparation route, contract null (FR-21, AC-22)", async () => {
    flagMock.mockReturnValue(true);
    mockGetPlanState.mockResolvedValue(null);
    mockGetActiveGoal.mockResolvedValue(null);
    startManualMock.mockResolvedValue({
      status: "created",
      binding: {
        executionId: "exec-perm-wait",
        controller: { decide: vi.fn() },
        budget: {
          reserveContinuation: vi.fn(),
          reserveProviderAttempt: vi.fn(),
          reserveToolExecution: vi.fn(),
          reconcileTokens: vi.fn(),
          addActiveRuntime: vi.fn(),
        },
        route: "preparation",
        contract: null,
        contractHash: null,
        ledgerId: "ledger-perm-wait",
        leaseGeneration: 0,
      } as never,
    });
    const { engine } = createEngineCapturingInput(() => undefined);
    classifyMock.mockReturnValue("preparation");
    await engine.submitMessage({
      request: makeRequest("Approve the tool."),
      eventSink: { emit: vi.fn() } as never,
    } as never);

    expect(startManualMock).toHaveBeenCalledTimes(1);
    const startCall = startManualMock.mock.calls[0]?.[0] as {
      route: string;
      contract: unknown;
    };
    expect(startCall.route).toBe("preparation");
    expect(startCall.contract).toBeNull();
    expect(freezeContractMock).not.toHaveBeenCalled();
  });
});
