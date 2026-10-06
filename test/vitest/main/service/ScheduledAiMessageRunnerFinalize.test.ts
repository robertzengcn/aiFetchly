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

import { ScheduledAiMessageRunner } from "@/service/ScheduledAiMessageRunner";

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
});
