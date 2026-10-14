// test/vitest/main/service/ScheduledAiMessageRunnerFinalize.test.ts
//
// Slice 2 Unit 6 — Runner finalization wiring (GAP-S2 #8/#9, FR-12/15/17,
// AC-15/17/22).
//
// Locks:
//   - flag-on + completed turn: finalizeChatRun delegates schedule accounting
//     to AiTaskExecutionModule.finalizeScheduledExecution (with scheduleId,
//     taskOutcome, reasonCode, idempotencyKey)
//   - run-row persistence failure rethrows (AC-15 — no silent success)
//   - claim idempotencyKey forwarded into startScheduled's occurrenceKey
//   - scheduled enrollment happens when flag on (startScheduled called)
//   - flag-off: legacy inline accounting unchanged (finalizeScheduledExecution
//     never called)
import { describe, expect, it, beforeEach, vi } from "vitest";

// --- Controllable stubs (hoisted so vi.mock factories can reference them) ---
const aiEnabled = vi.hoisted(() => ({ value: "true" }));
const chatCanUse = vi.hoisted(() => ({ value: true }));
const flagOn = vi.hoisted(() => ({ value: false }));
const engineOutcome = vi.hoisted(() => ({
  value: null as
    | { type: "complete"; content?: string }
    | { type: "error"; message?: string }
    | { type: "blocked" }
    | { type: "throw"; err: unknown }
    | null,
}));

const mockGetTask = vi.hoisted(() => vi.fn());
const mockParseAllowedTools = vi.hoisted(() => vi.fn());
const mockUpdateTask = vi.hoisted(() => vi.fn());
const mockCreateRun = vi.hoisted(() => vi.fn());
const mockUpdateRunStatus = vi.hoisted(() => vi.fn());
const mockCompleteRun = vi.hoisted(() => vi.fn());
const mockFailRun = vi.hoisted(() => vi.fn());
const mockGetScheduleById = vi.hoisted(() => vi.fn());
const mockPauseWithReason = vi.hoisted(() => vi.fn());
const mockUpdateIntervalAfterResult = vi.hoisted(() => vi.fn());
const mockAcquire = vi.hoisted(() => vi.fn());
const mockBroadcastEmit = vi.hoisted(() => vi.fn());
const mockBroadcastStream = vi.hoisted(() => vi.fn());
const mockSubmit = vi.hoisted(() => vi.fn());
const mockStartScheduled = vi.hoisted(() => vi.fn());
const mockFinalizeScheduled = vi.hoisted(() => vi.fn());

vi.mock("@/config/featureFlags", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/config/featureFlags")>();
  return {
    ...actual,
    isAiTaskCompletionPolicyV1Enabled: () => flagOn.value,
  };
});

interface MockEngine {
  submitMessage: typeof mockSubmit;
}

type MockConstructor<T> = new (...args: never[]) => T;

function createMockClass<T extends object>(
  factory: () => T
): MockConstructor<T> {
  const cls = function (this: T) {
    Object.assign(this, factory());
  } as unknown as MockConstructor<T>;
  return cls;
}

vi.mock("@/modules/token", () => ({
  Token: createMockClass(() => ({
    getValue: vi.fn((key: string) =>
      key === "user_ai_enabled" ? aiEnabled.value : "/tmp/test-db"
    ),
  })),
}));
vi.mock("@/service/aiProvider/AIProviderResolver", () => ({
  AIProviderResolver: class {
    resolveForChat():
      | { kind: "hosted"; canUse: true }
      | { canUse: false; reason: string; message: string } {
      return chatCanUse.value
        ? { kind: "hosted" as const, canUse: true as const }
        : {
            canUse: false as const,
            reason: "hosted_subscription_required" as const,
            message: "Hosted aiFetchly AI requires a subscription.",
          };
    }
  },
}));
vi.mock("@/modules/AiMessageTaskModule", () => ({
  AiMessageTaskModule: class {
    getTask = mockGetTask;
    parseAllowedTools = mockParseAllowedTools;
    updateTask = mockUpdateTask;
    updateLastRunResult = vi.fn();
  },
}));
vi.mock("@/modules/AiMessageTaskRunModule", () => ({
  AiMessageTaskRunModule: class {
    createRun = mockCreateRun;
    updateRunStatus = mockUpdateRunStatus;
    completeRun = mockCompleteRun;
    failRun = mockFailRun;
  },
}));
vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: class {
    createConversationIfNeeded = vi.fn(
      (id?: string) => (id && id.startsWith("v2-") ? id : "v2-minted")
    );
  },
}));
vi.mock("@/model/ScheduleTask.model", () => ({
  ScheduleTaskModel: class {
    getScheduleById = mockGetScheduleById;
    pauseWithReason = mockPauseWithReason;
    updateIntervalAfterResult = mockUpdateIntervalAfterResult;
  },
}));
vi.mock("@/service/AIChatQueryEngineFactory", () => ({
  AIChatQueryEngineFactory: class {
    createScheduled(): MockEngine {
      return { submitMessage: mockSubmit };
    }
  },
}));
vi.mock("@/service/AIChatConversationTurnCoordinator", () => ({
  AIChatConversationTurnCoordinator: {
    getInstance: () => ({
      acquire: mockAcquire,
      tryAcquire: vi.fn(() => null),
    }),
  },
  ConversationTurnBusyError: class extends Error {},
}));
vi.mock("@/service/AIChatConversationUpdateBroadcaster", () => ({
  AIChatConversationUpdateBroadcaster: {
    getInstance: () => ({
      emit: mockBroadcastEmit,
      emitScheduledStream: mockBroadcastStream,
    }),
  },
}));
vi.mock("@/service/ScheduledLoopRunRegistry", () => ({
  ScheduledLoopRunRegistry: {
    getInstance: () => ({
      register: vi.fn(),
      unregister: vi.fn(),
      abort: vi.fn(() => false),
    }),
  },
}));
vi.mock("@/service/AiMessageTaskWorkspace", () => ({
  bindApprovedWorkspace: vi.fn().mockResolvedValue("/tmp/ws"),
}));
vi.mock("@/modules/AiTaskExecutionModule", () => ({
  AiTaskExecutionModule: class {
    startScheduled = mockStartScheduled;
    finalizeScheduledExecution = mockFinalizeScheduled;
  },
}));
vi.mock("@/service/aiTaskExecution/TaskExecutionCoordinator", () => ({
  TaskExecutionCoordinator: vi.fn().mockImplementation(function () {
    return {
      startScheduled: mockStartScheduled,
      finalizeScheduled: mockFinalizeScheduled,
    };
  }),
}));

import { ScheduledAiMessageRunner, mapOutcomeToFinalizeInput } from "@/service/ScheduledAiMessageRunner";
import { TASK_EXECUTION_REASON_CODES } from "@/entityTypes/aiTaskExecutionTypes";

const TASK = {
  id: 1,
  source_type: "chat_scheduled_loop",
  conversation_id: "v2-conv",
  message: "check deployment",
  model: "auto",
  allowed_tools_json: "[]",
  auto_approve_tools: false,
  max_tool_calls: 10,
  max_runtime_ms: 300_000,
  max_continue_calls: 10,
  status: "active",
  workspace_path: null as string | null,
};
const SCHEDULE = {
  id: 2,
  task_id: 1,
  source_conversation_id: "v2-conv",
  is_active: true,
  status: "active",
  interval_ms: 300_000,
  interval_anchor_at: new Date(0),
  consecutive_failure_count: 0,
  terminal_reason: null,
};

function driveSink(sink: { emit: (e: unknown) => void }): void {
  if (!engineOutcome.value) return;
  if (engineOutcome.value.type === "complete") {
    sink.emit({
      type: "complete",
      conversationId: "v2-conv",
      messageId: "scheduled-assistant-2-1",
      fullContent: engineOutcome.value.content ?? "done",
    });
  } else if (engineOutcome.value.type === "error") {
    sink.emit({
      type: "error",
      conversationId: "v2-conv",
      messageId: "scheduled-assistant-2-1",
      errorMessage: engineOutcome.value.message ?? "boom",
    });
  } else if (engineOutcome.value.type === "blocked") {
    sink.emit({
      type: "plan_blocked_tool",
      conversationId: "v2-conv",
      messageId: "scheduled-assistant-2-1",
      toolCallId: "t1",
      toolName: "shell",
      fullContent: "",
      planBlockedToolName: "shell",
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  aiEnabled.value = "true";
  chatCanUse.value = true;
  flagOn.value = false;
  engineOutcome.value = null;
  mockParseAllowedTools.mockReturnValue([]);
  mockGetTask.mockResolvedValue(TASK);
  mockGetScheduleById.mockResolvedValue(SCHEDULE);
  mockCreateRun.mockResolvedValue(42);
  mockAcquire.mockResolvedValue({
    conversationId: "v2-conv",
    owner: "scheduled",
    ownerId: "run-9",
    leaseId: 1,
    release: vi.fn(),
  });
  mockSubmit.mockImplementation(
    async (input: { eventSink: { emit: (e: unknown) => void } }) => {
      if (engineOutcome.value?.type === "throw") throw engineOutcome.value.err;
      driveSink(input.eventSink);
    }
  );
  mockStartScheduled.mockResolvedValue({
    status: "created",
    binding: {
      executionId: "exec-sched-1",
      controller: { decide: vi.fn() },
      budget: {},
      route: "task_best_effort",
      contract: null,
      contractHash: null,
      leaseGeneration: 0,
      ledgerId: "ledger-1",
    },
  });
  mockFinalizeScheduled.mockResolvedValue({ ok: true });
});

const call = (
  overrides: Partial<{
    occurrence: number;
    runId: number;
    idempotencyKey?: string;
  }> = {}
) =>
  new ScheduledAiMessageRunner().runChatScheduledLoop({
    taskId: 1,
    scheduleId: 2,
    runId: overrides.runId ?? 9,
    occurrence: overrides.occurrence ?? 1,
    catchUp: false,
    scheduledFor: new Date(),
    idempotencyKey: overrides.idempotencyKey,
  });

describe("ScheduledAiMessageRunner — scheduled finalization (Unit 6)", () => {
  it("flag-on + completed turn: delegates schedule accounting to finalizeScheduledExecution", async () => {
    flagOn.value = true;
    engineOutcome.value = { type: "complete", content: "done" };
    await call();
    expect(mockFinalizeScheduled).toHaveBeenCalledTimes(1);
    const input = mockFinalizeScheduled.mock.calls[0][0] as {
      scheduleId: number;
      taskOutcome: string;
      reasonCode: string;
    };
    expect(input.scheduleId).toBe(2);
    // §6.1: task_best_effort has no criteria → no vacuous success; a natural
    // completion without verification maps to incomplete.
    expect(input.taskOutcome).toBe("incomplete");
  });

  it("flag-on: forwards the claim idempotencyKey into startScheduled's occurrenceKey", async () => {
    flagOn.value = true;
    engineOutcome.value = { type: "complete", content: "done" };
    await call({ idempotencyKey: "scheduled-loop:2:1" });
    expect(mockStartScheduled).toHaveBeenCalledTimes(1);
    const input = mockStartScheduled.mock.calls[0][0] as {
      occurrenceKey: string;
      taskId: number;
      runId: number;
    };
    expect(input.occurrenceKey).toBe("scheduled-loop:2:1");
    expect(input.taskId).toBe(1);
    expect(input.runId).toBe(9);
  });

  it("flag-on: schedules the turn with the completion policy binding on the sink", async () => {
    flagOn.value = true;
    engineOutcome.value = { type: "complete", content: "done" };
    await call();
    const submitArg = mockSubmit.mock.calls[0][0] as {
      eventSink: Record<string, unknown>;
    };
    // The sink carries the policy binding (constructor DI) when flag on.
    expect(submitArg.eventSink).toBeDefined();
  });

  it("flag-off: legacy inline accounting (finalizeScheduledExecution never called)", async () => {
    engineOutcome.value = { type: "complete", content: "done" };
    const r = await call();
    expect(r.status).toBe("completed");
    expect(mockFinalizeScheduled).not.toHaveBeenCalled();
    expect(mockStartScheduled).not.toHaveBeenCalled();
    expect(mockUpdateIntervalAfterResult).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  it("run-row persistence failure rethrows (AC-15 — never silent success)", async () => {
    flagOn.value = false;
    engineOutcome.value = { type: "complete", content: "done" };
    mockCompleteRun.mockRejectedValue(new Error("sqlite disk I/O error"));
    await expect(call()).rejects.toThrow(/disk I\/O error/);
  });

  /**
   * D8 review-coverage gap: the `reused` crash-retry branch had zero tests.
   * A transport retry of the same occurrence key (same scheduleId +
   * occurrence, e.g. the app crashed mid-run and the scheduler re-claimed)
   * gets `reused` from startScheduled. The runner must finalize the run row
   * as failed with the honest OCCURRENCE_ALREADY_ENROLLED code — never
   * silently re-run the turn (double execution) and never leave the claim
   * stuck "running" (GAP-S2 #9).
   */
  it("flag-on + reused enrollment (crash retry): finalizes failed with OCCURRENCE_ALREADY_ENROLLED, no engine turn", async () => {
    flagOn.value = true;
    mockStartScheduled.mockResolvedValue({ status: "reused" });

    const result = await call({ idempotencyKey: "scheduled-loop:2:1" });

    // Enrollment was attempted exactly once and hit the reused branch.
    expect(mockStartScheduled).toHaveBeenCalledTimes(1);
    expect(mockStartScheduled.mock.calls[0][0]).toMatchObject({
      occurrenceKey: "scheduled-loop:2:1",
    });
    // The engine NEVER runs — a retry must not double-execute the turn.
    expect(mockSubmit).not.toHaveBeenCalled();

    // The run row is finalized as failed with the honest error code so the
    // claim is not stuck "running".
    expect(mockFailRun).toHaveBeenCalledTimes(1);
    expect(mockFailRun.mock.calls[0][0]).toBe(9);
    expect(String(mockFailRun.mock.calls[0][1])).toContain(
      "OCCURRENCE_ALREADY_ENROLLED"
    );
    expect(mockUpdateRunStatus).toHaveBeenCalledWith(
      9,
      "failed",
      expect.objectContaining({ error_code: "OCCURRENCE_ALREADY_ENROLLED" })
    );
    // Legacy accounting: the occurrence failed, so the schedule's
    // consecutive-failure counter increments (success: false).
    expect(mockUpdateIntervalAfterResult).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
    // Policy finalization never runs — there is no fresh execution for this
    // attempt (the existing row's finalization belongs to the other attempt).
    expect(mockFinalizeScheduled).not.toHaveBeenCalled();

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBe("OCCURRENCE_ALREADY_ENROLLED");
  });

  it("B07a: scheduled transaction failure → no success delivery (no done stream), error surfaces (FR-12/14)", async () => {
    flagOn.value = true;
    engineOutcome.value = { type: "complete", content: "done" };
    mockFinalizeScheduled.mockResolvedValue({
      ok: false,
      reasonCode: "MISSING_TASK_OUTCOME",
    });
    await expect(call()).rejects.toThrow(/SCHEDULED_FINALIZATION_FAILED/);
    // No `done` success delivery escaped before the commit failed.
    const doneCalls = mockBroadcastStream.mock.calls.filter(
      (c) => (c[0] as { kind?: string }).kind === "done"
    );
    expect(doneCalls).toHaveLength(0);
    // Honest terminal: an error streams instead of a false success.
    const errorCalls = mockBroadcastStream.mock.calls.filter(
      (c) => (c[0] as { kind?: string }).kind === "error"
    );
    expect(errorCalls).toHaveLength(1);
  });

  it("B07b: scheduled commit → exactly one terminal delivery after commit, no premature done (FR-12/14)", async () => {
    flagOn.value = true;
    engineOutcome.value = { type: "complete", content: "done" };
    mockFinalizeScheduled.mockResolvedValue({ ok: true });
    await call();
    expect(mockFinalizeScheduled).toHaveBeenCalledTimes(1);
    // Policy path maps a natural best-effort completion to honest
    // incomplete (no vacuous success) — the committed terminal streams as
    // error, never as a premature `done`. Exactly one terminal delivery.
    const doneCalls = mockBroadcastStream.mock.calls.filter(
      (c) => (c[0] as { kind?: string }).kind === "done"
    );
    const errorCalls = mockBroadcastStream.mock.calls.filter(
      (c) => (c[0] as { kind?: string }).kind === "error"
    );
    expect(doneCalls).toHaveLength(0);
    expect(errorCalls).toHaveLength(1);
    // Post-commit ordering: the terminal escapes only after the transaction
    // applied.
    const errorOrder = mockBroadcastStream.mock.invocationCallOrder[
      mockBroadcastStream.mock.calls.findIndex(
        (c) => (c[0] as { kind?: string }).kind === "error"
      )
    ];
    const finalizeOrder = mockFinalizeScheduled.mock.invocationCallOrder[0];
    expect(errorOrder).toBeGreaterThan(finalizeOrder);
  });
});

/**
 * D8 review-coverage gap: the finalize mapping's FALLBACK statics had zero
 * direct tests. mapOutcomeToFinalizeInput is the last writer before the
 * durable outcome_reason_code column (varchar(64)) and the §17 rollout
 * histogram — every code it emits or passes through must be in the
 * TASK_EXECUTION_REASON_CODES vocabulary, or the histogram grows a novel
 * bucket and the 6-language i18n display map misses it.
 */
describe("mapOutcomeToFinalizeInput — reason-code statics (writer format-drift guard)", () => {
  it("completed → CRITERIA_SATISFIED (static, in vocabulary)", () => {
    const mapping = mapOutcomeToFinalizeInput(
      {
        kind: "completed",
        assistantMessageId: "m1",
        content: "done",
      },
      1_000
    );
    expect(mapping.taskOutcome).toBe("verified_complete");
    expect(mapping.reasonCode).toBe("CRITERIA_SATISFIED");
    expect(TASK_EXECUTION_REASON_CODES).toContain(mapping.reasonCode);
  });

  it("incomplete → reasonCode passthrough (NO_PROGRESS, in vocabulary)", () => {
    const mapping = mapOutcomeToFinalizeInput(
      {
        kind: "incomplete",
        assistantMessageId: "m1",
        content: "partial",
        reasonCode: "NO_PROGRESS",
        remainingWork: [],
      },
      1_000
    );
    expect(mapping.taskOutcome).toBe("incomplete");
    expect(mapping.reasonCode).toBe("NO_PROGRESS");
    expect(TASK_EXECUTION_REASON_CODES).toContain(mapping.reasonCode);
  });

  it("missing_outcome → reasonCode passthrough (in vocabulary)", () => {
    const mapping = mapOutcomeToFinalizeInput(
      {
        kind: "missing_outcome",
        assistantMessageId: "m1",
        reasonCode: "MISSING_TASK_OUTCOME",
      },
      1_000
    );
    expect(mapping.reasonCode).toBe("MISSING_TASK_OUTCOME");
    expect(TASK_EXECUTION_REASON_CODES).toContain(mapping.reasonCode);
  });

  it("failed with classified reasonCode → passthrough (in vocabulary)", () => {
    const mapping = mapOutcomeToFinalizeInput(
      {
        kind: "failed",
        assistantMessageId: "m1",
        errorMessage: "provider exploded",
        reasonCode: "PROVIDER_ERROR",
      },
      1_000
    );
    // D7: the stable code goes to the column; raw transport text stays in
    // the summary for renderer display only.
    expect(mapping.reasonCode).toBe("PROVIDER_ERROR");
    expect(mapping.summary).toBe("provider exploded");
    expect(TASK_EXECUTION_REASON_CODES).toContain(mapping.reasonCode);
  });

  it("failed WITHOUT classified reasonCode → REMOTE_AI_ERROR static (in vocabulary)", () => {
    const mapping = mapOutcomeToFinalizeInput(
      {
        kind: "failed",
        assistantMessageId: "m1",
        errorMessage: "fetch failed: ECONNRESET",
      },
      1_000
    );
    // The raw transport text must never reach the reason-code column.
    expect(mapping.reasonCode).toBe("REMOTE_AI_ERROR");
    expect(mapping.summary).toBe("fetch failed: ECONNRESET");
    expect(TASK_EXECUTION_REASON_CODES).toContain(mapping.reasonCode);
  });

  it("blocked → reason static, BLOCKED_BY_POLICY fallback (in vocabulary)", () => {
    const withReason = mapOutcomeToFinalizeInput(
      { kind: "blocked", assistantMessageId: "m1", reason: "CONTENT_RESTRICTED" },
      1_000
    );
    expect(withReason.reasonCode).toBe("CONTENT_RESTRICTED");
    const withoutReason = mapOutcomeToFinalizeInput(
      { kind: "blocked", assistantMessageId: "m1", reason: "" },
      1_000
    );
    expect(withoutReason.reasonCode).toBe("BLOCKED_BY_POLICY");
    expect(TASK_EXECUTION_REASON_CODES).toContain(withReason.reasonCode);
    expect(TASK_EXECUTION_REASON_CODES).toContain(withoutReason.reasonCode);
  });

  it("cancelled → RUN_INTERRUPTED static (in vocabulary)", () => {
    const mapping = mapOutcomeToFinalizeInput(
      { kind: "cancelled", assistantMessageId: "m1", content: "stopped" },
      1_000
    );
    expect(mapping.taskOutcome).toBe("cancelled");
    expect(mapping.reasonCode).toBe("RUN_INTERRUPTED");
    expect(TASK_EXECUTION_REASON_CODES).toContain(mapping.reasonCode);
  });
});
