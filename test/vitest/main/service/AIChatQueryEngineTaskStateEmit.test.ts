// test/vitest/main/service/AIChatQueryEngineTaskStateEmit.test.ts
//
// T13 (PRD FR-13/14/22/24, NFR-10/11, AC-16/24/25/27/32) — the engine emits
// `task_execution_state` lifecycle events through the caller's event sink so
// the renderer can badge an enrolled turn and dedup repeated terminal
// delivery. These tests lock the emitter contract:
//
//   - active: emitted once at manual enrollment (after the binding is fully
//     constructed), and once at successor enrollment, with the new
//     executionId. The renderer shows the badge immediately, no waiting for
//     the first consult.
//   - terminal: emitted once at the complete / cancelled / failed gate, AFTER
//     the durable lifecycle event (`complete`/`cancelled`/`error`) and AFTER
//     `finalizeManual` committed the row's outcome. Carries
//     outcome + reasonCode. Only enrolled turns emit (taskExecutionId set);
//     response_only answers never enroll and never get a terminal event.
//   - NFR-10: exactly one terminal `task_execution_state` event per
//     execution — the renderer dedups by executionId, and the engine must not
//     double-emit at a single gate.
//
// The mock setup mirrors AIChatQueryEngineFinalize.test.ts. The T12
// `taskOutcome` carry on the `complete`/`cancelled`/`error` events is locked
// by the finalize suite; this suite locks the SEPARATE
// `task_execution_state` sink events that the renderer's chunk branch
// consumes (Piece C: dedup by executionId, drop terminal replay).
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
// B12: isGoalLinkedMessage is NOT mocked — the enrollment ownership gate
// must exercise the real linkage rule (mocking it would make ownership
// assertions vacuous and fail-closed masking would hide linkage).
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

// --- TaskExecutionCoordinator mock: startManual + finalizeManual --------
vi.mock("@/service/aiTaskExecution/TaskExecutionCoordinator", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/service/aiTaskExecution/TaskExecutionCoordinator")>();
  return {
    ...actual,
    TaskExecutionCoordinator: vi.fn().mockImplementation(function () {
      return {
        startManual: startManualMock,
        freezeContract: freezeContractMock,
        finalizeManual: finalizeManualMock,
      };
    }),
  };
});

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
const mockGetLedgerById = vi.fn().mockResolvedValue(null);
const mockGetExecutionForModule = vi.fn().mockResolvedValue(null);
vi.mock("@/modules/AiTaskExecutionModule", () => ({
  AiTaskExecutionModule: vi.fn().mockImplementation(function () {
    return {
      getExecution: mockGetExecutionForModule,
      getLedgerById: mockGetLedgerById,
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
// R9 T04: key-aware Token mock — a blanket "true" also fed USERSDBPATH,
// making every worker open the same cwd-relative `./true/` scraper.db;
// concurrent full-suite workers then hit `database is locked` during
// between-round DB bookkeeping and the turn fails. Empty dbpath takes the
// per-worker isolated TMPDIR fallback (test/vitest/_setup/isolatedTmpDir.ts).
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(function () {
    return { getValue: vi.fn(
        (key: string) => (key === "user_dbpath" ? "" : "true")
      ) };
  }),
}));
vi.mock("@/config/usersetting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/usersetting")>();
  return { ...actual };
});

const EXEC_ID = "exec-state-1";

/** Controller decide mock used by startManualMock's created branch. */
type DecideFn = (
  candidate: unknown
) => Promise<TaskCompletionDecision>;

/** Binding returned by startManualMock's created branch. */
function makeCreatedBinding(overrides?: {
  decide?: DecideFn;
  ledgerId?: string;
  leaseGeneration?: number;
}): {
  executionId: string;
  controller: { decide: DecideFn };
  budget: { reserveContinuation: () => string };
  route: "task_best_effort";
  contract: null;
  contractHash: null;
  ledgerId?: string;
  leaseGeneration?: number;
} {
  const binding: {
    executionId: string;
    controller: { decide: DecideFn };
    budget: { reserveContinuation: () => string };
    route: "task_best_effort";
    contract: null;
    contractHash: null;
    ledgerId?: string;
    leaseGeneration?: number;
  } = {
    executionId: EXEC_ID,
    controller: { decide: overrides?.decide ?? vi.fn() },
    budget: { reserveContinuation: vi.fn().mockReturnValue("reserved") },
    route: "task_best_effort",
    contract: null,
    contractHash: null,
  };
  if (overrides?.ledgerId !== undefined) {
    binding.ledgerId = overrides.ledgerId;
  }
  if (overrides?.leaseGeneration !== undefined) {
    binding.leaseGeneration = overrides.leaseGeneration;
  }
  return binding;
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

/** Cancelled loop result. */
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

/** Failed loop result. */
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

/** Enroll the turn: flag on + task route + startManual resolves created. */
function enrollCreated(decide?: DecideFn): void {
  flagMock.mockReturnValue(true);
  classifyMock.mockReturnValue("task_best_effort");
  startManualMock.mockResolvedValue({
    status: "created",
    binding: makeCreatedBinding({ decide }),
  });
}

/** Collect every `task_execution_state` event the sink received. */
function taskStateEvents(emits: EmitRecord[]): EmitRecord[] {
  return emits.filter((e) => e.type === "task_execution_state");
}

describe("AIChatQueryEngine — task_execution_state lifecycle emitters (T13)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flagMock.mockReturnValue(false);
    classifyMock.mockReturnValue("response_only");
    startManualMock.mockReset();
    freezeContractMock.mockReset();
    finalizeManualMock.mockReset();
    finalizeManualMock.mockResolvedValue({ ok: true });
    mockGetLedgerById.mockReset();
    mockGetLedgerById.mockResolvedValue(null);
    mockGetExecutionForModule.mockReset();
    mockGetExecutionForModule.mockResolvedValue(null);
    mockGetPlanState.mockResolvedValue(null);
    mockEnsurePlanForConversation.mockResolvedValue(null);
    mockCreateConversationIfNeeded.mockReturnValue("v2-test-conv");
    HookRegistry.unregisterSource("plugin:test-hooks");
  });

  it("active: flag-on + task route emits one `task_execution_state` active at enrollment (FR-13, AC-16)", async () => {
    enrollCreated();
    const { engine, emits, eventSink } = createEngineReturning(
      makeCompletedResult()
    );
    await engine.submitMessage({
      request: makeRequest(),
      eventSink,
    } as never);

    const states = taskStateEvents(emits);
    // Exactly one active state at enrollment (no terminal yet under this
    // assertion's narrow scope — the terminal gate is a separate test).
    const active = states.filter((s) => s.status === "active");
    expect(active.length).toBe(1);
    expect(active[0]).toMatchObject({
      type: "task_execution_state",
      conversationId: "v2-test-conv",
      executionId: EXEC_ID,
      status: "active",
    });
  });

  it("response_only: never emits any task_execution_state event (no enrollment, no badge)", async () => {
    flagMock.mockReturnValue(true);
    classifyMock.mockReturnValue("response_only");
    const { engine, emits, eventSink } = createEngineReturning(
      makeCompletedResult()
    );
    await engine.submitMessage({
      request: makeRequest(),
      eventSink,
    } as never);
    expect(taskStateEvents(emits)).toHaveLength(0);
  });

  it("flag-off: no active enrollment emit and no terminal emit (byte-identical legacy)", async () => {
    flagMock.mockReturnValue(false);
    classifyMock.mockReturnValue("task_best_effort");
    const { engine, emits, eventSink } = createEngineReturning(
      makeCompletedResult()
    );
    await engine.submitMessage({
      request: makeRequest(),
      eventSink,
    } as never);
    expect(taskStateEvents(emits)).toHaveLength(0);
  });

  it("terminal: complete gate emits terminal BEFORE the complete event with outcome + reasonCode (FR-14/24, NFR-10; B08)", async () => {
    const consultDecide = vi.fn<DecideFn>().mockResolvedValue({
      type: "finish",
      outcome: "verified_complete",
      reasonCode: "CRITERIA_SATISFIED",
      evidenceIds: ["ev-1"],
      summary: "verified",
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

    const terminal = taskStateEvents(emits).filter(
      (s) => s.status === "terminal"
    );
    expect(terminal.length).toBe(1);
    expect(terminal[0]).toMatchObject({
      type: "task_execution_state",
      conversationId: "v2-test-conv",
      executionId: EXEC_ID,
      status: "terminal",
      outcome: "verified_complete",
      reasonCode: "CRITERIA_SATISFIED",
    });

    // B08: the terminal task_execution_state event must come BEFORE the
    // stream-terminal `complete` emit. The renderer's complete handler
    // synchronously detaches both stream listeners, so a terminal state
    // emitted after `complete` is dropped and the badge sticks until
    // reload. Gate ordering: finalize → terminal state → complete.
    const completeEmitIdx = emitSpy.mock.calls.findIndex(
      (args: unknown[]) => (args[0] as { type: string }).type === "complete"
    );
    const terminalEmitIdx = emitSpy.mock.calls.findIndex(
      (args: unknown[]) =>
        (args[0] as { type: string }).type === "task_execution_state" &&
        (args[0] as { status: string }).status === "terminal"
    );
    expect(completeEmitIdx).toBeGreaterThanOrEqual(0);
    expect(terminalEmitIdx).toBeGreaterThanOrEqual(0);
    expect(terminalEmitIdx).toBeLessThan(completeEmitIdx);
  });

  it("terminal: cancelled gate emits terminal with cancelled outcome BEFORE the cancelled event (B08)", async () => {
    enrollCreated();
    const { engine, emits, eventSink, emitSpy } = createEngineReturning(
      makeCancelledResult()
    );
    await engine.submitMessage({
      request: makeRequest(),
      eventSink,
    } as never);

    const terminal = taskStateEvents(emits).filter(
      (s) => s.status === "terminal"
    );
    expect(terminal.length).toBe(1);
    expect(terminal[0]).toMatchObject({
      type: "task_execution_state",
      executionId: EXEC_ID,
      status: "terminal",
      outcome: "cancelled",
      reasonCode: "USER_CANCELLED",
    });

    const cancelledEmitIdx = emitSpy.mock.calls.findIndex(
      (args: unknown[]) => (args[0] as { type: string }).type === "cancelled"
    );
    const terminalEmitIdx = emitSpy.mock.calls.findIndex(
      (args: unknown[]) =>
        (args[0] as { type: string }).type === "task_execution_state" &&
        (args[0] as { status: string }).status === "terminal"
    );
    expect(cancelledEmitIdx).toBeGreaterThanOrEqual(0);
    expect(terminalEmitIdx).toBeLessThan(cancelledEmitIdx);
  });

  it("terminal: failed gate emits terminal with failed outcome BEFORE the error event (B08)", async () => {
    enrollCreated();
    const { engine, emits, eventSink, emitSpy } = createEngineReturning(
      makeFailedResult()
    );
    await engine.submitMessage({
      request: makeRequest(),
      eventSink,
    } as never);

    const terminal = taskStateEvents(emits).filter(
      (s) => s.status === "terminal"
    );
    expect(terminal.length).toBe(1);
    expect(terminal[0]).toMatchObject({
      type: "task_execution_state",
      executionId: EXEC_ID,
      status: "terminal",
      outcome: "failed",
      reasonCode: "MODEL_FAILURE",
    });

    const errorEmitIdx = emitSpy.mock.calls.findIndex(
      (args: unknown[]) => (args[0] as { type: string }).type === "error"
    );
    const terminalEmitIdx = emitSpy.mock.calls.findIndex(
      (args: unknown[]) =>
        (args[0] as { type: string }).type === "task_execution_state" &&
        (args[0] as { status: string }).status === "terminal"
    );
    expect(errorEmitIdx).toBeGreaterThanOrEqual(0);
    expect(terminalEmitIdx).toBeLessThan(errorEmitIdx);
  });

  it("NFR-10: exactly one terminal task_execution_state event per execution (no double-emit at the gate)", async () => {
    // A loop-recorded decision AND finalizeManual succeeding should still
    // produce exactly ONE terminal event (not one per finalize call).
    const finishDecision: TaskCompletionDecision = {
      type: "finish",
      outcome: "incomplete",
      reasonCode: "NO_PROGRESS",
      evidenceIds: ["ev-1"],
      summary: "Extracted 12 contacts.",
      remainingWork: ["verify_email_column"],
    };
    enrollCreated();
    const { engine, emits, eventSink } = createEngineReturning(
      makeCompletedResult(),
      (input) => {
        input.taskExecutionBinding?.recordDecision?.(finishDecision);
      }
    );
    await engine.submitMessage({
      request: makeRequest(),
      eventSink,
    } as never);
    const terminal = taskStateEvents(emits).filter(
      (s) => s.status === "terminal"
    );
    expect(terminal).toHaveLength(1);
  });

  it("active + terminal both fire for one enrolled completed turn (the full lifecycle)", async () => {    const consultDecide = vi.fn<DecideFn>().mockResolvedValue({
      type: "finish",
      outcome: "verified_complete",
      reasonCode: "CRITERIA_SATISFIED",
      evidenceIds: ["ev-1"],
      summary: "verified",
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

    const states = taskStateEvents(emits);
    // Three events: active at enrollment, verifying at the fallback consult
    // (G01-313 — the mocked loop records no decision, so the gate consults),
    // terminal at the gate.
    expect(states).toHaveLength(3);
    expect(states[0].status).toBe("active");
    expect(states[1].status).toBe("verifying");
    expect(states[2].status).toBe("terminal");
    // The active event must precede the terminal event in emit order.
    const activeIdx = emitSpy.mock.calls.findIndex(
      (args: unknown[]) =>
        (args[0] as { type: string }).type === "task_execution_state" &&
        (args[0] as { status: string }).status === "active"
    );
    const terminalIdx = emitSpy.mock.calls.findIndex(
      (args: unknown[]) =>
        (args[0] as { type: string }).type === "task_execution_state" &&
        (args[0] as { status: string }).status === "terminal"
    );
    expect(activeIdx).toBeGreaterThanOrEqual(0);
    expect(terminalIdx).toBeGreaterThanOrEqual(0);
    expect(activeIdx).toBeLessThan(terminalIdx);
  });

  it("G02b: terminal task_execution_state carries the stable final_event_identity (design §6.3, NFR-10)", async () => {
    // The durable delivery identity (execution-result:<id>, stamped by
    // finalization in the same transaction as the outcome) travels on the
    // terminal event so IPC/notifications/consumers dedup on it — a
    // notification retry reuses, never mints.
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

    const terminal = taskStateEvents(emits).filter(
      (s) => s.status === "terminal"
    );
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({
      executionId: EXEC_ID,
      status: "terminal",
      outcome: "verified_complete",
      finalEventIdentity: `execution-result:${EXEC_ID}`,
    });
  });
});
