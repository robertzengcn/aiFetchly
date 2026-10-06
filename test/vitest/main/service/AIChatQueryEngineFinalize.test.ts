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
});
