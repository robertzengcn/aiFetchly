// test/vitest/main/service/AIChatQueryEngineFinalize.test.ts
//
// Slice 2 Unit 5 — Engine acceptance + atomic finalization (GAP-S2 #5/#9,
// FR-10/15, AC-11/15).
//
// The engine's handleLoopResult completed-case is the HARD finalization gate:
// when the completion-policy flag is on and the turn was enrolled (a
// taskDecisionSlot exists for the executionId), the engine consults the
// controller as a fallback when the loop recorded no decision (natural
// response_end — no consult site hit), finalizes via
// coordinator.finalizeManual, and only THEN emits `complete`. Flag-off emits
// `complete` without any finalization (byte-identical legacy behavior).
//
// These tests lock:
//   - flag-off → complete emitted, finalizeManual never called
//   - flag-on + loop-recorded finish decision → finalizeManual called BEFORE
//     the complete emit, with the decision's outcome/reasonCode/evidenceIds
//   - flag-on + no recorded decision → fallback consult runs, finalizeManual
//     called before complete with the consult's fields
//   - continue decision post-exit (defensive) → finalized as incomplete
//   - finalizeManual ALREADY_FINALIZED → complete still emitted (no-op
//     tolerance; the UI must not hang)
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";
import type { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type {
  AIChatQueryEventSink,
  AIChatQueryLoopInput,
  AIChatQueryLoopResult,
} from "@/service/AIChatQueryEvents";
import type { TaskCompletionDecision } from "@/entityTypes/aiTaskExecutionTypes";
import type {
  FinalizeInput,
  FinalizeResult,
} from "@/model/AiTaskExecution.model";
import { HookRegistry } from "@/service/hooks/HookRegistry";

// vi.mock factories are hoisted above top-level vars, so declare the mock
// fns inside vi.hoisted() to make them visible to the factories.
const {
  flagMock,
  classifyMock,
  startManualMock,
  freezeContractMock,
  finalizeManualMock,
} = vi.hoisted(() => ({
  flagMock: vi.fn<() => boolean>(),
  classifyMock: vi.fn(),
  startManualMock: vi.fn(),
  freezeContractMock: vi.fn(),
  finalizeManualMock: vi.fn<
    (input: Omit<FinalizeInput, "expectedVersion">) => Promise<FinalizeResult>
  >(),
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

// --- TaskExecutionCoordinator mock: startManual + finalizeManual --------
vi.mock("@/service/aiTaskExecution/TaskExecutionCoordinator", () => ({
  TaskExecutionCoordinator: vi.fn().mockImplementation(function () {
    return {
      startManual: startManualMock,
      freezeContract: freezeContractMock,
      finalizeManual: finalizeManualMock,
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

const EXEC_ID = "exec-finalize-1";

/** Controller decide mock used by startManualMock's created branch. */
type DecideFn = (
  candidate: unknown
) => Promise<TaskCompletionDecision>;

/** Binding returned by startManualMock's created branch. */
function makeCreatedBinding(overrides?: {
  decide?: DecideFn;
}): {
  executionId: string;
  controller: { decide: DecideFn };
  budget: { reserveContinuation: () => string };
  route: "task_best_effort";
  contract: null;
  contractHash: null;
} {
  return {
    executionId: EXEC_ID,
    controller: { decide: overrides?.decide ?? vi.fn() },
    budget: { reserveContinuation: vi.fn().mockReturnValue("reserved") },
    route: "task_best_effort",
    contract: null,
    contractHash: null,
  };
}

interface EmitRecord {
  type: string;
  [key: string]: unknown;
}

/**
 * Build an engine whose loop.run() resolves with the given result, with the
 * capturing event sink ALSO passed into submitMessage (the engine emits
 * terminal events on the caller's sink, not an internal one). The loop mock
 * can optionally invoke the binding's recordDecision closure (simulating a
 * Unit-4 consult that recorded a decision before the loop returned).
 */
function createEngineReturning(
  result: AIChatQueryLoopResult,
  onLoopInput?: (input: AIChatQueryLoopInput) => void
): {
  engine: AIChatQueryEngine;
  emits: EmitRecord[];
  eventSink: AIChatQueryEventSink;
  emitSpy: ReturnType<typeof vi.fn>;
} {
  const emits: EmitRecord[] = [];
  const emitSpy = vi.fn((event: { type: string }) => {
    emits.push(event as EmitRecord);
  });
  const eventSink = { emit: emitSpy } as unknown as AIChatQueryEventSink;
  const fakeLoop = {
    run: vi.fn(async (input: AIChatQueryLoopInput) => {
      onLoopInput?.(input);
      return result;
    }),
  } as unknown as AIChatQueryLoop;
  return {
    engine: new AIChatQueryEngine(fakeLoop),
    emits,
    eventSink,
    emitSpy,
  };
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

/** Completed loop result with real content (the natural response_end case). */
function makeCompletedResult(fullContent = "Extracted 12 contacts."): {
  type: "completed";
  conversationId: string;
  assistantMessageId: string;
  fullContent: string;
  finishReason: string;
} {
  return {
    type: "completed",
    conversationId: "v2-test-conv",
    assistantMessageId: "a1",
    fullContent,
    finishReason: "stop",
  };
}

/** Enroll the turn: flag on + task route + startManual resolves created. */
function enrollCreated(decide?: DecideFn): void {
  flagMock.mockReturnValue(true);
  classifyMock.mockReturnValue("task_best_effort");
  startManualMock.mockResolvedValue({
    status: "created",
    binding: makeCreatedBinding({ decide }),
  });
}

describe("AIChatQueryEngine.handleLoopResult — completion policy finalize gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flagMock.mockReturnValue(false);
    classifyMock.mockReturnValue("response_only");
    startManualMock.mockReset();
    freezeContractMock.mockReset();
    finalizeManualMock.mockReset();
    finalizeManualMock.mockResolvedValue({ ok: true });
    mockGetPlanState.mockResolvedValue(null);
    mockEnsurePlanForConversation.mockResolvedValue(null);
    mockCreateConversationIfNeeded.mockReturnValue("v2-test-conv");
    HookRegistry.unregisterSource("plugin:test-hooks");
  });

  it("flag-off: emits complete without calling finalizeManual", async () => {
    flagMock.mockReturnValue(false);
    const { engine, emits, eventSink } = createEngineReturning(
      makeCompletedResult()
    );
    await engine.submitMessage({
      request: makeRequest(),
      eventSink,
    } as never);
    expect(finalizeManualMock).not.toHaveBeenCalled();
    const complete = emits.find((e) => e.type === "complete");
    expect(complete).toBeDefined();
    expect(complete!.fullContent).toBe("Extracted 12 contacts.");
  });

  it("flag-on + loop-recorded finish decision: finalizeManual called before complete emit", async () => {
    const finishDecision: TaskCompletionDecision = {
      type: "finish",
      outcome: "incomplete",
      reasonCode: "NO_PROGRESS",
      evidenceIds: ["ev-1", "ev-2"],
      summary: "Extracted 12 contacts.",
      remainingWork: ["verify_email_column"],
    };
    enrollCreated();
    // Simulate Unit 4: the loop consulted at a terminal-stop site and the
    // binding's recordDecision closure persisted the decision BEFORE the
    // loop returned.
    const { engine, emits, eventSink, emitSpy } = createEngineReturning(
      makeCompletedResult(),
      (input) => {
        input.taskExecutionBinding?.recordDecision?.(finishDecision);
      }
    );
    await engine.submitMessage({
      request: makeRequest(),
      eventSink,
    } as never);

    // The gate must finalize with the recorded decision's fields.
    expect(finalizeManualMock).toHaveBeenCalledTimes(1);
    const call = finalizeManualMock.mock.calls[0][0];
    expect(call).toMatchObject({
      executionId: EXEC_ID,
      outcome: "incomplete",
      reasonCode: "NO_PROGRESS",
      evidenceIds: ["ev-1", "ev-2"],
      remainingWork: ["verify_email_column"],
    });
    // Finalization must precede the complete emit (the gate ordering).
    const completeEvent = emits.find((e) => e.type === "complete");
    expect(completeEvent).toBeDefined();
    const completeEmitIdx = emitSpy.mock.calls.findIndex(
      (args: unknown[]) => (args[0] as { type: string }).type === "complete"
    );
    expect(finalizeManualMock.mock.invocationCallOrder[0]).toBeLessThan(
      emitSpy.mock.invocationCallOrder[completeEmitIdx]
    );
  });

  it("flag-on + no recorded decision: fallback consult runs and finalizes before complete", async () => {
    const consultDecide = vi.fn<DecideFn>().mockResolvedValue({
      type: "finish",
      outcome: "verified_complete",
      reasonCode: "CRITERIA_SATISFIED",
      evidenceIds: ["ev-9"],
      summary: "Extracted 12 contacts.",
      remainingWork: [],
    });
    enrollCreated(consultDecide);
    const { engine, emits, eventSink, emitSpy } = createEngineReturning(
      makeCompletedResult("Extracted 12 contacts.")
    );
    await engine.submitMessage({
      request: makeRequest(),
      eventSink,
    } as never);
    // The loop recorded no decision (natural response_end — no consult site
    // hit). The gate must fall back to a consult.
    expect(consultDecide).toHaveBeenCalledTimes(1);
    const candidate = consultDecide.mock.calls[0][0] as {
      content: string;
      provenance: string;
      streamTerminalSeen: boolean;
      boundary: string;
    };
    expect(candidate.content).toBe("Extracted 12 contacts.");
    expect(candidate.provenance).toBe("provider");
    expect(candidate.streamTerminalSeen).toBe(true);
    expect(candidate.boundary).toBe("response_end");
    // Finalized with the consult's fields.
    expect(finalizeManualMock).toHaveBeenCalledTimes(1);
    expect(finalizeManualMock.mock.calls[0][0]).toMatchObject({
      executionId: EXEC_ID,
      outcome: "verified_complete",
      reasonCode: "CRITERIA_SATISFIED",
      evidenceIds: ["ev-9"],
    });
    // Finalization must precede the complete emit.
    const completeEvent = emits.find((e) => e.type === "complete");
    expect(completeEvent).toBeDefined();
    const completeEmitIdx = emitSpy.mock.calls.findIndex(
      (args: unknown[]) => (args[0] as { type: string }).type === "complete"
    );
    expect(finalizeManualMock.mock.invocationCallOrder[0]).toBeLessThan(
      emitSpy.mock.invocationCallOrder[completeEmitIdx]
    );
  });

  it("flag-on + continue decision post-exit (defensive): finalized as incomplete", async () => {
    const consultDecide = vi.fn<DecideFn>().mockResolvedValue({
      type: "continue",
      continuationId: "cont:x",
      prompt: "continue",
      unmetCriterionIds: ["c1"],
    });
    enrollCreated(consultDecide);
    const { engine, emits, eventSink } = createEngineReturning(
      makeCompletedResult()
    );
    await engine.submitMessage({
      request: makeRequest(),
      eventSink,
    } as never);
    expect(finalizeManualMock).toHaveBeenCalledTimes(1);
    expect(finalizeManualMock.mock.calls[0][0]).toMatchObject({
      executionId: EXEC_ID,
      outcome: "incomplete",
    });
    const completeEvent = emits.find((e) => e.type === "complete");
    expect(completeEvent).toBeDefined();
  });

  it("flag-on + finalizeManual ALREADY_FINALIZED: complete still emitted (no-op tolerance)", async () => {
    const consultDecide = vi.fn<DecideFn>().mockResolvedValue({
      type: "finish",
      outcome: "incomplete",
      reasonCode: "NO_PROGRESS",
      evidenceIds: [],
      summary: "done",
      remainingWork: [],
    });
    enrollCreated(consultDecide);
    finalizeManualMock.mockResolvedValue({
      ok: false,
      alreadyFinalized: true,
      reasonCode: "ALREADY_FINALIZED",
    });
    const { engine, emits, eventSink } = createEngineReturning(
      makeCompletedResult()
    );
    await engine.submitMessage({
      request: makeRequest(),
      eventSink,
    } as never);
    expect(finalizeManualMock).toHaveBeenCalledTimes(1);
    const completeEvent = emits.find((e) => e.type === "complete");
    expect(completeEvent).toBeDefined();
  });

  // T16 — Freeze accepted policy across flag rollback (NFR-12, AC-12/32).
  // The flag value is FROZEN at enrollment: a turn enrolled while the flag
  // was on stays accepted for finalization even if the flag is turned off
  // midstream. The runtime flag controls only NEW enrollment; accepted
  // in-flight handling never falls back to the legacy blind-complete path.
  it("T16: flag-off midstream (after flag-on enrollment) still finalizes via the policy gate", async () => {
    const finishDecision: TaskCompletionDecision = {
      type: "finish",
      outcome: "incomplete",
      reasonCode: "NO_PROGRESS",
      evidenceIds: [],
      summary: "partial",
      remainingWork: ["verify_email_column"],
    };
    enrollCreated();
    const { engine, emits, eventSink } = createEngineReturning(
      makeCompletedResult(),
      (input) => {
        input.taskExecutionBinding?.recordDecision?.(finishDecision);
        // Flip the live flag OFF midstream — the turn was already enrolled
        // (policyAccepted frozen true on the binding). The gate must still
        // finalize; it must NOT fall back to the legacy blind complete→
        // success path.
        flagMock.mockReturnValue(false);
      }
    );
    await engine.submitMessage({
      request: makeRequest(),
      eventSink,
    } as never);
    expect(finalizeManualMock).toHaveBeenCalledTimes(1);
    expect(finalizeManualMock.mock.calls[0][0]).toMatchObject({
      executionId: EXEC_ID,
      outcome: "incomplete",
    });
    const completeEvent = emits.find((e) => e.type === "complete");
    expect(completeEvent).toBeDefined();
  });

  it("T16: flag-off midstream + no loop-recorded decision → fallback consult still runs (frozen accepted)", async () => {
    const consultDecide = vi.fn<DecideFn>().mockResolvedValue({
      type: "finish",
      outcome: "incomplete",
      reasonCode: "RESPONSE_ENDED",
      evidenceIds: [],
      summary: "ended",
      remainingWork: [],
    });
    enrollCreated(consultDecide);
    const { engine, emits, eventSink } = createEngineReturning(
      makeCompletedResult(),
      () => {
        // No recordDecision call — the loop ended naturally. Flip the flag
        // off midstream. The gate's fallback consult must still run because
        // the binding carries policyAccepted=true from enrollment.
        flagMock.mockReturnValue(false);
      }
    );
    await engine.submitMessage({
      request: makeRequest(),
      eventSink,
    } as never);
    expect(consultDecide).toHaveBeenCalledTimes(1);
    expect(finalizeManualMock).toHaveBeenCalledTimes(1);
    expect(finalizeManualMock.mock.calls[0][0]).toMatchObject({
      executionId: EXEC_ID,
      outcome: "incomplete",
    });
    const completeEvent = emits.find((e) => e.type === "complete");
    expect(completeEvent).toBeDefined();
  });

  // ------ T12 — durable finalization as terminal-delivery gate ------
  // (FR-05/10/12/14/24, NFR-10/11, AC-15/24/25/30/32)
  // The completed-case gate above locks the happy path. The cases below
  // lock the FAILURE / CANCEL / THROW paths: an enrolled execution whose
  // loop ends failed/cancelled (or throws) must still leave an honest
  // durable record BEFORE the terminal emit, and the terminal event must
  // carry the outcome + executionId + reasonCode so the renderer badges
  // honestly and dedups repeated delivery.
  //
  // Per audit T12: "assistant/execution/ledger save failure produces no
  // success publication; loop failure finalizes failed/interrupted;
  // Stop/replacement write failures are recoverable; late success cannot
  // overwrite cancellation/new task; repeated delivery has stable
  // identity and consumer dedup."

  /** Cancelled loop result — the loop resolved `cancelled` (window close,
   * controller abort) rather than the user hitting Stop. The enrolled
   * execution still needs a `cancelled`/`USER_CANCELLED` row. */
  function makeCancelledResult(
    partialContent = "partial work"
  ): {
    type: "cancelled";
    conversationId: string;
    assistantMessageId: string;
    partialContent: string;
  } {
    return {
      type: "cancelled",
      conversationId: "v2-test-conv",
      assistantMessageId: "a1",
      partialContent,
    };
  }

  /** Failed loop result — the loop resolved `failed` (model error). The
   * enrolled execution needs a `failed`/`MODEL_FAILURE` row. */
  function makeFailedResult(
    partialContent = "partial before failure"
  ): {
    type: "failed";
    conversationId: string;
    assistantMessageId: string;
    error: unknown;
    partialContent: string;
  } {
    return {
      type: "failed",
      conversationId: "v2-test-conv",
      assistantMessageId: "a1",
      error: new Error("model returned 500"),
      partialContent,
    };
  }

  it("T12: failed loop finalizes failed/MODEL_FAILURE before error emit (FR-10/12/14, AC-15/24/25)", async () => {
    enrollCreated();
    const { engine, emits, eventSink, emitSpy } = createEngineReturning(
      makeFailedResult()
    );
    await engine.submitMessage({
      request: makeRequest(),
      eventSink,
    } as never);
    // The failed gate must finalize failed/MODEL_FAILURE on the bound exec.
    expect(finalizeManualMock).toHaveBeenCalledTimes(1);
    expect(finalizeManualMock.mock.calls[0][0]).toMatchObject({
      executionId: EXEC_ID,
      outcome: "failed",
      reasonCode: "MODEL_FAILURE",
    });
    // Finalization must precede the error emit (the gate ordering).
    const errorEvent = emits.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    const errorEmitIdx = emitSpy.mock.calls.findIndex(
      (args: unknown[]) => (args[0] as { type: string }).type === "error"
    );
    expect(finalizeManualMock.mock.invocationCallOrder[0]).toBeLessThan(
      emitSpy.mock.invocationCallOrder[errorEmitIdx]
    );
    // The error event carries the outcome + executionId + reasonCode so the
    // renderer badges honestly and dedups repeated delivery (FR-14/24).
    expect(errorEvent).toMatchObject({
      taskOutcome: "failed",
      taskExecutionId: EXEC_ID,
      taskReasonCode: "MODEL_FAILURE",
    });
  });

  it("T12: cancelled loop finalizes cancelled/USER_CANCELLED before cancelled emit (FR-10/12/14, AC-24/25)", async () => {
    enrollCreated();
    const { engine, emits, eventSink, emitSpy } = createEngineReturning(
      makeCancelledResult()
    );
    await engine.submitMessage({
      request: makeRequest(),
      eventSink,
    } as never);
    expect(finalizeManualMock).toHaveBeenCalledTimes(1);
    expect(finalizeManualMock.mock.calls[0][0]).toMatchObject({
      executionId: EXEC_ID,
      outcome: "cancelled",
      reasonCode: "USER_CANCELLED",
    });
    const cancelledEvent = emits.find((e) => e.type === "cancelled");
    expect(cancelledEvent).toBeDefined();
    const cancelledEmitIdx = emitSpy.mock.calls.findIndex(
      (args: unknown[]) => (args[0] as { type: string }).type === "cancelled"
    );
    expect(finalizeManualMock.mock.invocationCallOrder[0]).toBeLessThan(
      emitSpy.mock.invocationCallOrder[cancelledEmitIdx]
    );
    expect(cancelledEvent).toMatchObject({
      taskOutcome: "cancelled",
      taskExecutionId: EXEC_ID,
      taskReasonCode: "USER_CANCELLED",
    });
  });

  it("T12: loop throws → handleFailure finalizes failed/MODEL_FAILURE before error emit (FR-10/12/14, AC-15/24/25)", async () => {
    enrollCreated();
    // Loop throws — handleFailure is the catch path, not handleLoopResult.
    const thrown = new Error("stream exploded");
    const fakeLoop = {
      run: vi.fn(async () => {
        throw thrown;
      }),
    } as unknown as AIChatQueryLoop;
    const emits: EmitRecord[] = [];
    const emitSpy = vi.fn((event: { type: string }) => {
      emits.push(event as EmitRecord);
    });
    const eventSink = { emit: emitSpy } as unknown as AIChatQueryEventSink;
    const engine = new AIChatQueryEngine(fakeLoop);
    await engine.submitMessage({
      request: makeRequest(),
      eventSink,
    } as never);
    // The catch path must still finalize failed/MODEL_FAILURE so the row
    // does not stay `running` after a throw (AC-24/25 restart repair).
    expect(finalizeManualMock).toHaveBeenCalledTimes(1);
    expect(finalizeManualMock.mock.calls[0][0]).toMatchObject({
      executionId: EXEC_ID,
      outcome: "failed",
      reasonCode: "MODEL_FAILURE",
    });
    const errorEvent = emits.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    const errorEmitIdx = emitSpy.mock.calls.findIndex(
      (args: unknown[]) => (args[0] as { type: string }).type === "error"
    );
    expect(finalizeManualMock.mock.invocationCallOrder[0]).toBeLessThan(
      emitSpy.mock.invocationCallOrder[errorEmitIdx]
    );
    expect(errorEvent).toMatchObject({
      taskOutcome: "failed",
      taskExecutionId: EXEC_ID,
      taskReasonCode: "MODEL_FAILURE",
    });
  });

  it("T12: complete event carries taskOutcome for verified_complete (FR-14/24, AC-30/32)", async () => {
    const consultDecide = vi.fn<DecideFn>().mockResolvedValue({
      type: "finish",
      outcome: "verified_complete",
      reasonCode: "CRITERIA_SATISFIED",
      evidenceIds: ["ev-1"],
      summary: "verified",
      remainingWork: [],
    });
    enrollCreated(consultDecide);
    const { engine, emits, eventSink } = createEngineReturning(
      makeCompletedResult("Extracted 12 contacts.")
    );
    await engine.submitMessage({
      request: makeRequest(),
      eventSink,
    } as never);
    const completeEvent = emits.find((e) => e.type === "complete");
    expect(completeEvent).toBeDefined();
    // verified_complete outcome carried into terminal delivery.
    expect(completeEvent).toMatchObject({
      taskOutcome: "verified_complete",
      taskExecutionId: EXEC_ID,
      taskReasonCode: "CRITERIA_SATISFIED",
    });
  });

  it("T12: complete event carries taskOutcome for incomplete (FR-14/24, AC-30/32)", async () => {
    const consultDecide = vi.fn<DecideFn>().mockResolvedValue({
      type: "finish",
      outcome: "incomplete",
      reasonCode: "CONTINUATION_LIMIT",
      evidenceIds: [],
      summary: "ran out of budget",
      remainingWork: ["verify_email_column"],
    });
    enrollCreated(consultDecide);
    const { engine, emits, eventSink } = createEngineReturning(
      makeCompletedResult("partial extraction")
    );
    await engine.submitMessage({
      request: makeRequest(),
      eventSink,
    } as never);
    const completeEvent = emits.find((e) => e.type === "complete");
    expect(completeEvent).toBeDefined();
    expect(completeEvent).toMatchObject({
      taskOutcome: "incomplete",
      taskExecutionId: EXEC_ID,
      taskReasonCode: "CONTINUATION_LIMIT",
    });
  });

  it("T12: ALREADY_FINALIZED on failed path is no-op tolerance (Stop already cancelled)", async () => {
    enrollCreated();
    // Stop already cancelled the row; the failed gate hits ALREADY_FINALIZED
    // and must treat it as success (no double-finalize, no error hang).
    finalizeManualMock.mockResolvedValue({
      ok: false,
      alreadyFinalized: true,
      reasonCode: "ALREADY_FINALIZED",
    });
    const { engine, emits, eventSink } = createEngineReturning(
      makeFailedResult()
    );
    await engine.submitMessage({
      request: makeRequest(),
      eventSink,
    } as never);
    expect(finalizeManualMock).toHaveBeenCalledTimes(1);
    // The error event still emits — the loop failed — but with the
    // ALREADY_FINALIZED reasonCode carried (no FINALIZE_THREW).
    const errorEvent = emits.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent).toMatchObject({
      taskOutcome: "failed",
      taskExecutionId: EXEC_ID,
    });
  });

  it("T12: recorded finish decision honored on failed path (consult site decided finish before throw)", async () => {
    // The loop consulted at a terminal-stop site and recorded a finish
    // decision, then the loop subsequently failed. The failed gate must
    // honor the recorded finish outcome, not overwrite it with
    // failed/MODEL_FAILURE (FR-10/14 — the controller's decision wins).
    const recordedFinish: TaskCompletionDecision = {
      type: "finish",
      outcome: "incomplete",
      reasonCode: "NO_PROGRESS",
      evidenceIds: ["ev-1"],
      summary: "no progress detected",
      remainingWork: ["retry_extraction"],
    };
    enrollCreated();
    const { engine, emits, eventSink } = createEngineReturning(
      makeFailedResult(),
      (input) => {
        input.taskExecutionBinding?.recordDecision?.(recordedFinish);
      }
    );
    await engine.submitMessage({
      request: makeRequest(),
      eventSink,
    } as never);
    expect(finalizeManualMock).toHaveBeenCalledTimes(1);
    // The recorded finish outcome/reason wins over the failed/MODEL_FAILURE
    // default.
    expect(finalizeManualMock.mock.calls[0][0]).toMatchObject({
      executionId: EXEC_ID,
      outcome: "incomplete",
      reasonCode: "NO_PROGRESS",
      remainingWork: ["retry_extraction"],
    });
    const errorEvent = emits.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent).toMatchObject({
      taskOutcome: "incomplete",
      taskReasonCode: "NO_PROGRESS",
    });
  });

  it("T12: finalize throws on failed path → error event still emits with FINALIZE_THREW reason (recoverable)", async () => {
    enrollCreated();
    finalizeManualMock.mockRejectedValue(new Error("db connection lost"));
    const { engine, emits, eventSink } = createEngineReturning(
      makeFailedResult()
    );
    await engine.submitMessage({
      request: makeRequest(),
      eventSink,
    } as never);
    expect(finalizeManualMock).toHaveBeenCalledTimes(1);
    // The throw is caught inside the helper; the error event still emits
    // with FINALIZE_THREW so the renderer knows the row is suspect and
    // restart-time repair is required (AC-24/25).
    const errorEvent = emits.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent).toMatchObject({
      taskOutcome: "failed",
      taskExecutionId: EXEC_ID,
      taskReasonCode: "FINALIZE_THREW",
    });
  });
});
