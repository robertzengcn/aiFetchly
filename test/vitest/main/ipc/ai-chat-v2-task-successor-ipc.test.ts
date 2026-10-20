import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  setupElectronMocks,
  resetElectronMocks,
  mockIpcMain,
} from "../../../utils/electron-mocks";

// Mock electron module — must be hoisted by vitest before handler import.
vi.mock("electron", () => ({
  ipcMain: mockIpcMain,
  app: { getPath: vi.fn().mockReturnValue("/tmp") },
}));

/**
 * T09 (FR-14/21/22, AC-16/27/28) — the successor IPC handlers must not just
 * CREATE the successor execution: on `created` they must also DISPATCH a real
 * engine turn carrying the trusted `successorContext` (the coordinator's
 * binding + the parent's parsed route) through the singleton engine, with an
 * event sink bound to the requesting renderer so successor chunks stream.
 * `reused`/`denied` dispatch nothing.
 */

const mockState = vi.hoisted(() => ({
  aiEnabled: "true",
  tokenStore: new Map<string, string>(),
}));

// Token as an ES class: `new Token()` runs in the flag read, the AI gate,
// and getCurrentUserDbPath. Vitest 4 mock functions are not constructable.
vi.mock("@/modules/token", () => {
  return {
    Token: class {
      getValue(key: string): string {
        if (key === "USER_AI_ENABLED") {
          return mockState.aiEnabled;
        }
        return mockState.tokenStore.get(key) ?? "";
      }
      setValue(key: string, value: string): void {
        mockState.tokenStore.set(key, value);
      }
      deleteValue(key: string): void {
        mockState.tokenStore.delete(key);
      }
      hasValue(key: string): boolean {
        return (
          mockState.tokenStore.has(key) &&
          (mockState.tokenStore.get(key)?.length ?? 0) > 0
        );
      }
    },
  };
});
vi.mock("@/config/usersetting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/usersetting")>();
  return {
    ...actual,
    USER_AI_ENABLED: "USER_AI_ENABLED",
    USERSDBPATH: "USERSDBPATH",
  };
});

// --- TaskExecutionCoordinator: continueExecution / retryExecution ---------
const continueMock = vi.hoisted(() => vi.fn());
const retryMock = vi.hoisted(() => vi.fn());
vi.mock("@/service/aiTaskExecution/TaskExecutionCoordinator", () => ({
  TaskExecutionCoordinator: class {
    continueExecution = continueMock;
    retryExecution = retryMock;
  },
}));

// --- AiTaskExecutionModule: getExecution returns the parent row ------------
const getExecutionMock = vi.hoisted(() => vi.fn());
vi.mock("@/modules/AiTaskExecutionModule", () => ({
  AiTaskExecutionModule: class {
    getExecution = getExecutionMock;
  },
}));

// --- AIChatQueryEngine: mock the MODULE so getQueryEngine() never builds
// the heavy production loop (createQueryLoop / compact agent / catalog).
const submitMessageMock = vi.hoisted(() => vi.fn());
vi.mock("@/service/AIChatQueryEngine", () => ({
  AIChatQueryEngine: class {
    submitMessage = submitMessageMock;
    stopActiveTurn = vi.fn();
  },
}));

// --- The production getQueryEngine deps that would otherwise construct ----
vi.mock("@/service/AIChatCompactAgentService", () => ({
  AIChatCompactAgentService: class {},
}));
vi.mock("@/service/AIChatCompactionCoordinator", () => ({
  AIChatCompactionCoordinator: class {},
}));
vi.mock("@/service/AIChatModelCatalogService", () => ({
  AIChatModelCatalogService: class {},
}));
vi.mock("@/service/AIChatContextAssembler", () => ({
  AIChatContextAssembler: class {},
}));
vi.mock("@/modules/AIChatCompactionModule", () => ({
  AIChatCompactionModule: class {},
}));
vi.mock("@/modules/AIChatArchiveModule", () => ({
  AIChatArchiveModule: class {},
}));
vi.mock("@/modules/ToolResultModule", () => ({
  ToolResultModule: class {
    asLegacyProjectionLookup = vi.fn().mockReturnValue(null);
  },
}));
vi.mock("@/service/AIAutoDreamFactory", () => ({
  getSharedAutoDreamService: vi.fn(() => ({})),
  resetSharedAutoDreamService: vi.fn(),
  getSharedWorkspaceAutoDreamService: vi.fn(() => ({})),
  resetSharedWorkspaceAutoDreamService: vi.fn(),
}));

import {
  registerAiChatV2IpcHandlers,
  resetAiChatV2RuntimeForDatabaseSwitch,
} from "@/main-process/communication/ai-chat-v2-ipc";
import {
  AI_CHAT_V2_TASK_CONTINUE,
  AI_CHAT_V2_TASK_RETRY,
  AI_CHAT_V2_STREAM_COMPLETE,
} from "@/config/channellist";

/**
 * A coordinator-created binding (T08 shape). Only the fields the IPC
 * handler threads into successorContext matter for these assertions.
 */
function createdBinding() {
  return {
    executionId: "exec-successor-1",
    conversationId: "v2-test-conv",
    sourceUserMessageId: "user-1",
    origin: { kind: "manual" },
    route: "task_best_effort",
    completionOwner: "standalone",
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

/** The finalized, continuable parent row the module mock serves. */
function parentExecutionRow() {
  return {
    execution_id: "exec-parent-1",
    route: "task_best_effort",
    finalized: true,
    task_outcome: "incomplete",
    lineage_ledger_id: "ledger-1",
    conversation_id: "v2-test-conv",
    source_user_message_id: "user-1",
    completion_owner: "standalone",
    contract_snapshot_json: null,
  };
}

function successorPayload(message?: string): string {
  return JSON.stringify({
    parentExecutionId: "exec-parent-1",
    submissionId: "sub-succ-1",
    ...(message !== undefined ? { message } : {}),
  });
}

function findCompletePayload(
  senderSend: ReturnType<typeof vi.fn>
): { eventType?: string; conversationId?: string; errorMessage?: string } | undefined {
  for (const call of senderSend.mock.calls) {
    if (call[0] !== AI_CHAT_V2_STREAM_COMPLETE) continue;
    try {
      return JSON.parse(String(call[1]));
    } catch {
      // keep scanning
    }
  }
  return undefined;
}

describe("AI Chat V2 task successor IPC — dispatch after create (T09)", () => {
  beforeEach(() => {
    setupElectronMocks();
    vi.clearAllMocks();
    // Flag ON via the Token store (featureFlags reads the flag Token key).
    mockState.aiEnabled = "true";
    mockState.tokenStore.clear();
    mockState.tokenStore.set("ai_task_completion_policy_v1_enabled", "true");
    mockState.tokenStore.set("USERSDBPATH", "/tmp/aifetchly-test.db");
    getExecutionMock.mockResolvedValue(parentExecutionRow());
    // The production submitMessage is async (always returns a promise) and
    // the IPC handler attaches `.catch` to its result — the mock must mirror
    // that async contract or the dispatch throws synchronously.
    submitMessageMock.mockImplementation(async () => {});
    registerAiChatV2IpcHandlers();
  });

  afterEach(() => {
    resetAiChatV2RuntimeForDatabaseSwitch();
    resetElectronMocks();
  });

  it("Continue: created successor dispatches the engine with the trusted successorContext and the parent's route", async () => {
    const binding = createdBinding();
    continueMock.mockResolvedValue({ status: "created", binding });

    const senderSend = vi.fn();
    const result = (await mockIpcMain.callHandler(
      AI_CHAT_V2_TASK_CONTINUE,
      { sender: { send: senderSend } },
      successorPayload("Continue extracting contacts")
    )) as { status: boolean; data: { executionId: string | null; status: string } };

    // The coordinator claimed the lineage ledger with the trusted fields.
    expect(continueMock).toHaveBeenCalledTimes(1);
    const input = continueMock.mock.calls[0][0] as Record<string, unknown>;
    expect(input.parentExecutionId).toBe("exec-parent-1");
    expect(input.conversationId).toBe("v2-test-conv");
    expect(input.route).toBe("task_best_effort");
    expect(input.lineageLedgerId).toBe("ledger-1");
    expect(input.submissionId).toBe("sub-succ-1");

    // THE T09 GAP: the created successor must be dispatched through the
    // engine (not just returned) carrying the binding + route.
    expect(submitMessageMock).toHaveBeenCalledTimes(1);
    const submit = submitMessageMock.mock.calls[0][0] as {
      request: { conversationId: string; message: string; submissionId: string };
      eventSink: unknown;
      successorContext: { binding: { executionId: string }; route: string };
    };
    expect(submit.request.conversationId).toBe("v2-test-conv");
    expect(submit.request.message).toBe("Continue extracting contacts");
    expect(submit.request.submissionId).toBe("sub-succ-1");
    expect(submit.successorContext.binding.executionId).toBe(
      "exec-successor-1"
    );
    expect(submit.successorContext.route).toBe("task_best_effort");
    expect(submit.eventSink).toBeDefined();

    // The invoke still resolves promptly with the successor identity.
    expect(result.status).toBe(true);
    expect(result.data).toEqual({
      executionId: "exec-successor-1",
      status: "created",
    });
  });

  it("Retry: created successor dispatches the engine through retryExecution (no lineage ledger arg)", async () => {
    const binding = createdBinding();
    retryMock.mockResolvedValue({ status: "created", binding });

    const senderSend = vi.fn();
    const result = (await mockIpcMain.callHandler(
      AI_CHAT_V2_TASK_RETRY,
      { sender: { send: senderSend } },
      successorPayload("Retry the extraction")
    )) as { status: boolean; data: { executionId: string | null; status: string } };

    expect(retryMock).toHaveBeenCalledTimes(1);
    expect(retryMock.mock.calls[0][0]).not.toHaveProperty("lineageLedgerId");
    expect(submitMessageMock).toHaveBeenCalledTimes(1);
    const submit = submitMessageMock.mock.calls[0][0] as {
      request: { message: string };
      successorContext: { binding: { executionId: string }; route: string };
    };
    expect(submit.request.message).toBe("Retry the extraction");
    expect(submit.successorContext.binding.executionId).toBe(
      "exec-successor-1"
    );
    expect(result.data).toEqual({
      executionId: "exec-successor-1",
      status: "created",
    });
  });

  it("reused: resolves with executionId null and dispatches NOTHING (no re-dispatch of effects)", async () => {
    continueMock.mockResolvedValue({
      status: "reused",
      existing: { executionId: "exec-existing" },
    });

    const senderSend = vi.fn();
    const result = (await mockIpcMain.callHandler(
      AI_CHAT_V2_TASK_CONTINUE,
      { sender: { send: senderSend } },
      successorPayload()
    )) as { status: boolean; data: { executionId: string | null; status: string } };

    expect(result.status).toBe(true);
    expect(result.data).toEqual({ executionId: null, status: "reused" });
    expect(submitMessageMock).not.toHaveBeenCalled();
    expect(senderSend).not.toHaveBeenCalled();
  });

  it("message fallback: with no renderer message, the dispatched request falls back to the contract objective (empty for a contractless parent)", async () => {
    const binding = createdBinding();
    continueMock.mockResolvedValue({ status: "created", binding });

    await mockIpcMain.callHandler(
      AI_CHAT_V2_TASK_CONTINUE,
      { sender: { send: vi.fn() } },
      successorPayload()
    );

    expect(submitMessageMock).toHaveBeenCalledTimes(1);
    const submit = submitMessageMock.mock.calls[0][0] as {
      request: { message: string };
    };
    expect(submit.request.message).toBe("");
  });

  it("dispatch failure sends a terminal error completion to the renderer (no dead-air successor)", async () => {
    const binding = createdBinding();
    continueMock.mockResolvedValue({ status: "created", binding });
    submitMessageMock.mockRejectedValue(new Error("engine dispatch boom"));

    const senderSend = vi.fn();
    const result = (await mockIpcMain.callHandler(
      AI_CHAT_V2_TASK_CONTINUE,
      { sender: { send: senderSend } },
      successorPayload()
    )) as { status: boolean; data: { executionId: string | null; status: string } };

    // The identity still returns created (the row exists); the renderer gets
    // the terminal error event so the badge does not hang on continuing.
    await vi.waitFor(() => {
      expect(findCompletePayload(senderSend)).toBeDefined();
    });
    const payload = findCompletePayload(senderSend)!;
    // Raw internal messages must not leak to the renderer — the sanitizer
    // maps unknown errors to the generic safe message. Assert the terminal
    // error shape (the console above proves the raw error reached the catch).
    expect(payload.eventType).toBe("error");
    expect(payload.errorMessage).toBeTruthy();
    expect(result.data.status).toBe("created");
  });

  it("denies when the completion policy flag is off (no coordinator, no dispatch)", async () => {
    mockState.tokenStore.delete("ai_task_completion_policy_v1_enabled");

    const result = (await mockIpcMain.callHandler(
      AI_CHAT_V2_TASK_CONTINUE,
      { sender: { send: vi.fn() } },
      successorPayload()
    )) as { status: boolean; msg: string };

    expect(result.status).toBe(false);
    expect(result.msg).toContain("not enabled");
    expect(continueMock).not.toHaveBeenCalled();
    expect(submitMessageMock).not.toHaveBeenCalled();
  });

  it("denies when AI is disabled, before any parent load or dispatch", async () => {
    mockState.aiEnabled = "false";

    const result = (await mockIpcMain.callHandler(
      AI_CHAT_V2_TASK_RETRY,
      { sender: { send: vi.fn() } },
      successorPayload()
    )) as { status: boolean; msg: string };

    expect(result.status).toBe(false);
    expect(getExecutionMock).not.toHaveBeenCalled();
    expect(retryMock).not.toHaveBeenCalled();
    expect(submitMessageMock).not.toHaveBeenCalled();
  });
});
