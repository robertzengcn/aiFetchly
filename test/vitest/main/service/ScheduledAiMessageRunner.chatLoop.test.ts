import { describe, expect, it, beforeEach, vi } from "vitest";

// --- Controllable stubs (hoisted so vi.mock factories can reference them) ---
const aiEnabled = vi.hoisted(() => ({ value: "true" }));
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

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn((key: string) =>
      key === "user_ai_enabled" ? aiEnabled.value : "/tmp/test-db"
    ),
  })),
}));
vi.mock("@/modules/AiMessageTaskModule", () => ({
  AiMessageTaskModule: vi.fn().mockImplementation(() => ({
    getTask: mockGetTask,
    parseAllowedTools: mockParseAllowedTools,
    updateLastRunResult: vi.fn(),
  })),
}));
vi.mock("@/modules/AiMessageTaskRunModule", () => ({
  AiMessageTaskRunModule: vi.fn().mockImplementation(() => ({
    updateRunStatus: mockUpdateRunStatus,
    completeRun: mockCompleteRun,
    failRun: mockFailRun,
  })),
}));
vi.mock("@/model/ScheduleTask.model", () => ({
  ScheduleTaskModel: vi.fn().mockImplementation(() => ({
    getScheduleById: mockGetScheduleById,
    pauseWithReason: mockPauseWithReason,
    updateIntervalAfterResult: mockUpdateIntervalAfterResult,
  })),
}));
vi.mock("@/service/AIChatQueryEngineFactory", () => ({
  AIChatQueryEngineFactory: vi.fn().mockImplementation(() => ({
    createScheduled: () => ({ submitMessage: mockSubmit }),
  })),
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
  engineOutcome.value = null;
  mockParseAllowedTools.mockReturnValue([]);
  mockGetTask.mockResolvedValue(TASK);
  mockGetScheduleById.mockResolvedValue(SCHEDULE);
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
});

const call = (overrides: Partial<{ occurrence: number; runId: number }> = {}) =>
  new ScheduledAiMessageRunner().runChatScheduledLoop({
    taskId: 1,
    scheduleId: 2,
    runId: overrides.runId ?? 9,
    occurrence: overrides.occurrence ?? 1,
    catchUp: false,
    scheduledFor: new Date(),
  });

describe("ScheduledAiMessageRunner.runChatScheduledLoop", () => {
  it("finalizes as failed when AI is disabled at execution time", async () => {
    aiEnabled.value = "false";
    const r = await call();
    expect(r.status).toBe("failed");
    expect(r.errorMessage).toBe("AI_DISABLED");
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("rejects a task that is not chat_scheduled_loop", async () => {
    mockGetTask.mockResolvedValue({ ...TASK, source_type: "schedule_ui" });
    const r = await call();
    expect(r.status).toBe("failed");
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("pauses the schedule on a conversation-id mismatch (FR-4)", async () => {
    mockGetTask.mockResolvedValue({ ...TASK, conversation_id: "v2-other" });
    const r = await call();
    expect(r.status).toBe("failed");
    expect(mockPauseWithReason).toHaveBeenCalledWith(
      2,
      "CONVERSATION_MISMATCH"
    );
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("defers to waiting_for_conversation when the lease cannot be acquired", async () => {
    mockAcquire.mockRejectedValue(new Error("CONVERSATION_BUSY"));
    const r = await call();
    expect(r.status).toBe("blocked_by_policy");
    expect(mockUpdateRunStatus).toHaveBeenCalledWith(
      9,
      "waiting_for_conversation",
      expect.objectContaining({ error_code: "CONVERSATION_BUSY" })
    );
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("maps a completed engine outcome to run status completed + broadcasts", async () => {
    engineOutcome.value = { type: "complete", content: "all good" };
    const r = await call();
    expect(r.status).toBe("completed");
    expect(mockCompleteRun).toHaveBeenCalledWith(9, expect.anything());
    expect(mockUpdateRunStatus).toHaveBeenCalledWith(
      9,
      "completed",
      expect.objectContaining({ delivery_state: "persisted" })
    );
    expect(mockBroadcastEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "scheduled_turn_completed",
        assistantMessageId: "scheduled-assistant-2-1",
      })
    );
    expect(mockUpdateIntervalAfterResult).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  it("maps a blocked outcome to blocked_by_policy + pauses the schedule", async () => {
    engineOutcome.value = { type: "blocked" };
    const r = await call();
    expect(r.status).toBe("blocked_by_policy");
    expect(mockPauseWithReason).toHaveBeenCalledWith(2, "BLOCKED_BY_POLICY");
    expect(mockUpdateRunStatus).toHaveBeenCalledWith(
      9,
      "blocked_by_policy",
      expect.anything()
    );
  });

  it("maps a failed outcome and increments schedule failure counters", async () => {
    engineOutcome.value = { type: "error", message: "remote 500" };
    const r = await call();
    expect(r.status).toBe("failed");
    expect(mockFailRun).toHaveBeenCalled();
    expect(mockUpdateIntervalAfterResult).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });

  it("marks the schedule terminal after the repeated-failure threshold", async () => {
    mockGetScheduleById.mockResolvedValue({
      ...SCHEDULE,
      consecutive_failure_count: 99,
    });
    engineOutcome.value = { type: "error" };
    await call();
    expect(mockUpdateIntervalAfterResult).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        terminalStatus: "failed",
        terminalReason: "REPEATED_RUN_FAILURE",
      })
    );
  });
});
