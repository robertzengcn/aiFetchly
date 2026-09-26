import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  SCHEDULED_LOOP_PERMISSION_BACKSTOP_MS,
  SCHEDULED_LOOP_RESUME_TIMEOUT_MS,
} from "@/config/aiChatScheduledLoopConfig";

// --- Controllable stubs (hoisted so vi.mock factories can reference them) ---
const aiEnabled = vi.hoisted(() => ({ value: "true" }));
const chatCanUse = vi.hoisted(() => ({ value: true }));
const sinkOutcome = vi.hoisted(() => ({
  value: null as "pause" | "complete" | null,
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
const mockShowNotification = vi.hoisted(() => vi.fn());
const mockRegisterEngine = vi.hoisted(() => vi.fn());
const mockUnregisterEngine = vi.hoisted(() => vi.fn());
const mockSetPending = vi.hoisted(() => vi.fn());
const mockClearPending = vi.hoisted(() => vi.fn());
const mockResume = vi.hoisted(() =>
  vi.fn(async (input: { toolId: string; conversationId: string }) => {
    void input;
    return { ok: true };
  })
);
const mockDeny = vi.hoisted(() =>
  vi.fn(async (input: { toolId: string; conversationId: string }) => {
    void input;
    return { ok: true };
  })
);
const mockSubmit = vi.hoisted(() => vi.fn());
/** Drives the sink from the test; set by each test before the run starts. */
const terminalEvent = vi.hoisted(() => ({
  value: null as
    | null
    | { type: "complete"; content?: string }
    | { type: "error"; message?: string },
}));
const mockCreateConversationIfNeeded = vi.hoisted(() =>
  vi.fn((id?: string) => (id && id.startsWith("v2-") ? id : "v2-minted"))
);
const mockStopActiveTurn = vi.hoisted(() => vi.fn());

interface MockEngine {
  submitMessage: typeof mockSubmit;
  resumeToolAfterPermission: typeof mockResume;
  denyToolPermission: typeof mockDeny;
  stopActiveTurn: typeof mockStopActiveTurn;
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
    createConversationIfNeeded = mockCreateConversationIfNeeded;
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
      return {
        submitMessage: mockSubmit,
        resumeToolAfterPermission: mockResume,
        denyToolPermission: mockDeny,
        stopActiveTurn: mockStopActiveTurn,
      };
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
vi.mock("@/service/ScheduledLoopEngineRegistry", () => ({
  ScheduledLoopEngineRegistry: {
    getInstance: () => ({
      register: mockRegisterEngine,
      unregister: mockUnregisterEngine,
      setPendingPermission: mockSetPending,
      clearPendingPermission: mockClearPending,
      hasPendingPermission: vi.fn(() => false),
      getByConversation: vi.fn(() => undefined),
    }),
  },
}));
vi.mock("@/modules/lib/function", () => ({
  showNotification: mockShowNotification,
}));
vi.mock("@/service/AiMessageTaskWorkspace", () => ({
  bindApprovedWorkspace: vi.fn(async () => "/tmp/ws"),
}));

import { ScheduledAiMessageRunner } from "@/service/ScheduledAiMessageRunner";

const TASK = {
  id: 1,
  source_type: "chat_scheduled_loop",
  conversation_id: "v2-conv",
  message: "write a file",
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
  if (sinkOutcome.value === "pause") {
    sink.emit({
      type: "tool_result",
      conversationId: "v2-conv",
      messageId: "scheduled-assistant-2-1",
      toolCallId: "t1",
      toolName: "file_write",
      fullContent: JSON.stringify({
        error: "Permission required",
        needsPermissionPrompt: true,
      }),
      toolResult: {
        error: "Permission required",
        needsPermissionPrompt: true,
        success: false,
        executionTimeMs: 0,
      },
    });
  } else if (sinkOutcome.value === "complete") {
    sink.emit({
      type: "complete",
      conversationId: "v2-conv",
      messageId: "scheduled-assistant-2-1",
      fullContent: "done",
    });
  }
}

/** Captured so a test can simulate the resumed loop emitting a terminal event. */
let capturedSink: { emit: (e: unknown) => void } | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  aiEnabled.value = "true";
  chatCanUse.value = true;
  sinkOutcome.value = null;
  terminalEvent.value = null;
  mockParseAllowedTools.mockReturnValue([]);
  mockGetTask.mockResolvedValue(TASK);
  mockGetScheduleById.mockResolvedValue(SCHEDULE);
  mockCreateRun.mockResolvedValue(42);
  mockCreateConversationIfNeeded.mockImplementation((id?: string) =>
    id && id.startsWith("v2-") ? id : "v2-minted"
  );
  mockAcquire.mockResolvedValue({
    conversationId: "v2-conv",
    owner: "scheduled",
    ownerId: "run-9",
    leaseId: 1,
    release: vi.fn(),
  });
  mockSubmit.mockImplementation(
    async (input: { eventSink: { emit: (e: unknown) => void } }) => {
      capturedSink = input.eventSink;
      driveSink(input.eventSink);
    }
  );
  // Mirrors production: grant/deny launches a resumed `void loop.run` that
  // emits the terminal outcome to the SAME sink. The runner is awaiting
  // `sink.waitForTerminalOutcome()`, so emitting here unblocks it.
  mockResume.mockImplementation(async () => {
    emitTerminal(capturedSink);
    return { ok: true };
  });
  mockDeny.mockImplementation(async () => {
    emitTerminal(capturedSink);
    return { ok: true };
  });
  mockStopActiveTurn.mockReset();
  // Production stopActiveTurn aborts the turn and emits `cancelled`. The
  // resume-timeout path calls sink.failOutstanding FIRST (which resolves the
  // parked promise), so stopActiveTurn's own emit is an idempotent no-op on
  // the sink. The mock records the call; it does not need to emit.
  mockStopActiveTurn.mockImplementation(() => {});
});

function emitTerminal(sink: { emit: (e: unknown) => void } | null): void {
  if (!sink || !terminalEvent.value) return;
  // Mirror production: the resumed turn emits a `tool_result` carrying
  // `replacesPermissionPromptForToolId` (the resume signal the runner uses to
  // re-arm the bounded resume timeout) BEFORE the terminal event lands.
  sink.emit({
    type: "tool_result",
    conversationId: "v2-conv",
    messageId: "scheduled-assistant-2-1",
    toolCallId: "t1",
    toolName: "file_write",
    fullContent: "resumed",
    toolResult: { success: true, executionTimeMs: 0 },
    replacesPermissionPromptForToolId: "t1",
  });
  if (terminalEvent.value.type === "complete") {
    sink.emit({
      type: "complete",
      conversationId: "v2-conv",
      messageId: "scheduled-assistant-2-1",
      fullContent: terminalEvent.value.content ?? "resumed ok",
    });
  } else if (terminalEvent.value.type === "error") {
    sink.emit({
      type: "error",
      conversationId: "v2-conv",
      messageId: "scheduled-assistant-2-1",
      errorMessage: terminalEvent.value.message ?? "resumed failed",
    });
  }
}

describe("ScheduledAiMessageRunner permission pause", () => {
  it("on gated tool pause: stays registered + armed until grant resumes the loop", async () => {
    sinkOutcome.value = "pause";
    terminalEvent.value = { type: "complete", content: "resumed ok" };
    const runner = new ScheduledAiMessageRunner();
    const resultPromise = runner.runChatScheduledLoop({
      taskId: 1,
      scheduleId: 2,
      runId: 42,
      occurrence: 1,
      catchUp: false,
      scheduledFor: new Date(),
    });

    // Wait until the pause branch has run: submitMessage resolved, the
    // sink emitted the needsPermissionPrompt tool_result, and the runner
    // parked on `await sink.waitForTerminalOutcome()`. `setPendingPermission`
    // is the last pause side-effect, so once it fires the runner is parked.
    await vi.waitFor(
      () =>
        expect(mockSetPending).toHaveBeenCalledWith("v2-conv", {
          toolId: "t1",
        }),
      { timeout: 1000 }
    );

    // Pause side-effects fired.
    expect(mockRegisterEngine).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "v2-conv", runId: 42 })
    );
    expect(mockShowNotification).toHaveBeenCalled();
    const evt = mockBroadcastEmit.mock.calls.find(
      (c) => c[0]?.reason === "scheduled_turn_permission_requested"
    );
    expect(evt).toBeTruthy();

    // Critical contract: the engine is STILL registered while paused — the
    // runner did NOT run its finally/unregister. The runtime timeout was
    // cleared (suspended) and the 1h backstop is armed, not cleared.
    expect(mockUnregisterEngine).not.toHaveBeenCalled();

    // Simulate the user granting via IPC. Production IPC resolves the
    // engine through `registry.getByConversation(...)` then calls
    // `engine.resumeToolAfterPermission(...)`; the resumed `void loop.run`
    // emits the terminal outcome to the SAME sink. The mock captures that
    // sink and replays the terminal event here, unblocking the runner.
    await mockResume({ toolId: "t1", conversationId: "v2-conv" });
    const result = await resultPromise;

    // Now the runner finalized: engine unregistered, run completed.
    expect(mockUnregisterEngine).toHaveBeenCalledWith("v2-conv");
    expect(result.status).toBe("completed");
  });

  it("1h backstop auto-deny resolves the run when the user never responds", async () => {
    sinkOutcome.value = "pause";
    terminalEvent.value = { type: "error", message: "auto-denied" };
    const runner = new ScheduledAiMessageRunner();
    const resultPromise = runner.runChatScheduledLoop({
      taskId: 1,
      scheduleId: 2,
      runId: 42,
      occurrence: 1,
      catchUp: false,
      scheduledFor: new Date(),
    });
    await vi.waitFor(
      () =>
        expect(mockSetPending).toHaveBeenCalledWith("v2-conv", {
          toolId: "t1",
        }),
      { timeout: 1000 }
    );
    expect(mockUnregisterEngine).not.toHaveBeenCalled();

    // Advance past the 1h backstop. The backstop calls denyToolPermission,
    // whose resumed loop emits the terminal error to the sink.
    await vi.advanceTimersByTimeAsync(
      SCHEDULED_LOOP_PERMISSION_BACKSTOP_MS + 1
    );
    const result = await resultPromise;

    expect(mockDeny).toHaveBeenCalled();
    expect(mockUnregisterEngine).toHaveBeenCalledWith("v2-conv");
    expect(result.status).toBe("failed");
  });

  it("backstop does not clear a newer tool's pending metadata when deny returns ok:false (residual race)", async () => {
    // Scenario the adversarial review flagged: tool A pauses + arms backstop A.
    // The user denies A (IPC clears pending + backstop A's handle). The resumed
    // loop then pauses on tool B (pending = {toolId:B}, backstop B armed). If
    // backstop A's timer had already elapsed before the user denied, its fired
    // callback runs denyToolPermission({toolId:A}) → finds pending={toolId:B}
    // → matchedByToolId false → returns {ok:false}. The backstop's .then() must
    // NOT clearPendingPermission, or it orphans tool B's permission card.
    sinkOutcome.value = "pause";
    const runner = new ScheduledAiMessageRunner();
    const resultPromise = runner.runChatScheduledLoop({
      taskId: 1,
      scheduleId: 2,
      runId: 42,
      occurrence: 1,
      catchUp: false,
      scheduledFor: new Date(),
    });
    await vi.waitFor(
      () =>
        expect(mockSetPending).toHaveBeenCalledWith("v2-conv", {
          toolId: "t1",
        }),
      { timeout: 1000 }
    );
    expect(mockUnregisterEngine).not.toHaveBeenCalled();

    // Simulate the stale backstop firing: deny returns ok:false because a
    // newer tool replaced the pending entry. The terminal event is NOT emitted
    // (the deny didn't match), so the runner stays parked.
    mockDeny.mockImplementation(async () => ({ ok: false, error: "stale" }));
    await vi.advanceTimersByTimeAsync(
      SCHEDULED_LOOP_PERMISSION_BACKSTOP_MS + 1
    );
    // Yield so the backstop's async .then chain settles.
    await Promise.resolve();

    expect(mockDeny).toHaveBeenCalledWith({
      toolId: "t1",
      conversationId: "v2-conv",
    });
    // CRITICAL: the backstop issued an ok:false deny, so it must NOT clear the
    // (newer tool's) pending metadata. The runner is still parked.
    expect(mockClearPending).not.toHaveBeenCalled();
    expect(mockUnregisterEngine).not.toHaveBeenCalled();

    // Now the newer tool's actual deny resolves the run. (Production IPC would
    // call clearPendingPermission here; the runner's backstop only clears on
    // its own ok:true deny. We assert the runner finalizes after the terminal
    // event.)
    mockDeny.mockImplementation(async () => {
      emitTerminal(capturedSink);
      return { ok: true };
    });
    terminalEvent.value = { type: "complete", content: "b resumed" };
    await mockDeny({ toolId: "t2", conversationId: "v2-conv" });
    const result = await resultPromise;

    // The runner finalized: engine unregistered, run completed.
    expect(mockUnregisterEngine).toHaveBeenCalledWith("v2-conv");
    expect(result.status).toBe("completed");
  });

  it("resume timeout force-fails the run when the resumed loop never emits a terminal event (F1/F2)", async () => {
    // Adversarial scenario: after the permission pause the user grants, the
    // resumed `void loop.run` emits the resume signal (tool_result with
    // replacesPermissionPromptForToolId) but the provider then stalls
    // mid-stream (headers arrived, body hung). No complete/error/cancelled
    // event is ever emitted, so `sink.waitForTerminalOutcome()` would hang
    // forever — holding the run row + conversation lease. The bounded resume
    // timeout (armed on the resume signal) must fire, call failOutstanding
    // (resolves the sink with a failed outcome) + stopActiveTurn, finalizing
    // the run as failed.
    sinkOutcome.value = "pause";
    // Grant emits ONLY the resume signal — no terminal event — simulating the
    // resumed loop that started but stalled. deny is wired symmetrically but
    // must never fire (the resume timeout is much shorter than the 1h backstop).
    mockResume.mockImplementation(async () => {
      capturedSink?.emit({
        type: "tool_result",
        conversationId: "v2-conv",
        messageId: "scheduled-assistant-2-1",
        toolCallId: "t1",
        toolName: "file_write",
        fullContent: "ok",
        toolResult: { success: true, executionTimeMs: 0 },
        replacesPermissionPromptForToolId: "t1",
      });
      return { ok: true };
    });
    mockDeny.mockImplementation(async () => ({ ok: true }));

    const runner = new ScheduledAiMessageRunner();
    const resultPromise = runner.runChatScheduledLoop({
      taskId: 1,
      scheduleId: 2,
      runId: 42,
      occurrence: 1,
      catchUp: false,
      scheduledFor: new Date(),
    });
    await vi.waitFor(
      () =>
        expect(mockSetPending).toHaveBeenCalledWith("v2-conv", {
          toolId: "t1",
        }),
      { timeout: 1000 }
    );
    expect(mockUnregisterEngine).not.toHaveBeenCalled();

    // Grant to enter the resumed loop (which emits the resume signal, arming
    // the bounded resume timeout, then stalls — no terminal event).
    await mockResume({ toolId: "t1", conversationId: "v2-conv" });

    // The runner is parked on `await waitForTerminalOutcome()`. Advance past
    // the resume timeout; the timer fires failOutstanding + stopActiveTurn,
    // resolving the run.
    await vi.advanceTimersByTimeAsync(SCHEDULED_LOOP_RESUME_TIMEOUT_MS + 1);
    const result = await resultPromise;

    // Resume timeout fired: stopActiveTurn was called and the run finalized.
    expect(mockStopActiveTurn).toHaveBeenCalledWith("v2-conv");
    expect(mockUnregisterEngine).toHaveBeenCalledWith("v2-conv");
    expect(result.status).toBe("failed");
    // The 1h backstop never fired (resume timeout is shorter).
    expect(mockDeny).not.toHaveBeenCalled();
  });
});
