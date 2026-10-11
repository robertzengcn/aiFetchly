// test/vitest/main/ipc/ai-chat-v2-task-state-get-ipc.test.ts
//
// T13 (PRD FR-13/14, AC-16/24/25/27/32) — the read-only latest-execution
// IPC handler `AI_CHAT_V2_TASK_STATE_GET` lets history reload restore the
// badge from the stored row. The handler is AI-gated first (the
// AI-feature-IPC mandate), delegates to `AiTaskExecutionModule.
// getLatestByConversation`, never touches a repository directly, and
// returns a minimal projection (executionId / conversationId / status /
// reasonCode / outcome). Returns null for response-only answers that
// never enrolled — the renderer shows no badge in that case.
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

// --- AiTaskExecutionModule: getLatestByConversation is the T13 query ----
const getLatestByConversationMock = vi.hoisted(() => vi.fn());
vi.mock("@/modules/AiTaskExecutionModule", () => ({
  AiTaskExecutionModule: class {
    getLatestByConversation = getLatestByConversationMock;
  },
}));

// --- The production getQueryEngine deps that would otherwise construct ----
vi.mock("@/service/aiTaskExecution/TaskExecutionCoordinator", () => ({
  TaskExecutionCoordinator: class {},
}));
vi.mock("@/service/AIChatQueryEngine", () => ({
  AIChatQueryEngine: class {
    submitMessage = vi.fn();
    stopActiveTurn = vi.fn();
  },
}));
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
import { AI_CHAT_V2_TASK_STATE_GET } from "@/config/channellist";
import type { CommonMessage } from "@/entityTypes/commonType";

/** A finalized execution row the module mock serves. */
function executionRow(overrides?: {
  execution_id?: string;
  conversation_id?: string;
  stage?: string;
  task_outcome?: string | null;
  outcome_reason_code?: string | null;
}) {
  // Use `=== undefined` checks (not `??`) so an explicit `null` override
  // — the "in-flight, not yet finalized" case — passes through to the
  // projection instead of being coalesced back to the finalized default.
  return {
    execution_id:
      overrides?.execution_id !== undefined
        ? overrides.execution_id
        : "exec-state-1",
    conversation_id:
      overrides?.conversation_id !== undefined
        ? overrides.conversation_id
        : "v2-test-conv",
    stage: overrides?.stage !== undefined ? overrides.stage : "terminal",
    task_outcome:
      overrides?.task_outcome !== undefined
        ? overrides.task_outcome
        : "verified_complete",
    outcome_reason_code:
      overrides?.outcome_reason_code !== undefined
        ? overrides.outcome_reason_code
        : "CRITERIA_SATISFIED",
  };
}

const call = async (
  payload: unknown
): Promise<CommonMessage<unknown>> =>
  (await mockIpcMain.callHandler(
    AI_CHAT_V2_TASK_STATE_GET,
    {},
    payload
  )) as CommonMessage<unknown>;

describe("AI Chat V2 task-state-get IPC — history reconstruction (T13)", () => {
  beforeEach(() => {
    setupElectronMocks();
    vi.clearAllMocks();
    mockState.aiEnabled = "true";
    mockState.tokenStore.clear();
    mockState.tokenStore.set("USERSDBPATH", "/tmp/aifetchly-test.db");
    getLatestByConversationMock.mockReset();
    getLatestByConversationMock.mockResolvedValue(null);
    registerAiChatV2IpcHandlers();
  });

  afterEach(() => {
    resetAiChatV2RuntimeForDatabaseSwitch();
    resetElectronMocks();
  });

  it("denies before any work when AI is disabled (AI-gate-first mandate)", async () => {
    mockState.aiEnabled = "false";
    getLatestByConversationMock.mockResolvedValue(executionRow());
    const res = await call(JSON.stringify({ conversationId: "v2-test-conv" }));
    expect(res.status).toBe(false);
    expect(getLatestByConversationMock).not.toHaveBeenCalled();
  });

  it("denies when the payload is not valid JSON / object", async () => {
    const res = await call("not-json");
    expect(res.status).toBe(false);
    expect(getLatestByConversationMock).not.toHaveBeenCalled();
  });

  it("denies when conversationId is missing or empty", async () => {
    const res = await call(JSON.stringify({ conversationId: "" }));
    expect(res.status).toBe(false);
    expect(getLatestByConversationMock).not.toHaveBeenCalled();
  });

  it("returns null when no execution exists for the conversation (response-only answers never enrolled)", async () => {
    getLatestByConversationMock.mockResolvedValue(null);
    const res = await call(JSON.stringify({ conversationId: "v2-test-conv" }));
    expect(res.status).toBe(true);
    expect(res.data).toBeNull();
    expect(getLatestByConversationMock).toHaveBeenCalledWith("v2-test-conv");
  });

  it("returns the row projection (executionId / status / outcome / reasonCode) for a finalized execution", async () => {
    getLatestByConversationMock.mockResolvedValue(executionRow());
    const res = await call(JSON.stringify({ conversationId: "v2-test-conv" }));
    expect(res.status).toBe(true);
    expect(res.data).toMatchObject({
      executionId: "exec-state-1",
      conversationId: "v2-test-conv",
      status: "terminal",
      outcome: "verified_complete",
      reasonCode: "CRITERIA_SATISFIED",
    });
  });

  it("returns undefined reasonCode / outcome when the row has none (in-flight, not yet finalized)", async () => {
    getLatestByConversationMock.mockResolvedValue(
      executionRow({
        stage: "active",
        task_outcome: null,
        outcome_reason_code: null,
      })
    );
    const res = await call(JSON.stringify({ conversationId: "v2-test-conv" }));
    expect(res.status).toBe(true);
    expect(res.data).toMatchObject({
      executionId: "exec-state-1",
      status: "active",
    });
    // The renderer treats absent outcome/reasonCode as "still in flight" —
    // no terminal badge until durable finalization commits the row.
    expect((res.data as { reasonCode?: string }).reasonCode).toBeUndefined();
    expect((res.data as { outcome?: string }).outcome).toBeUndefined();
  });

  it("denies safely (userSafeError) when the module throws — never leaks the raw error", async () => {
    getLatestByConversationMock.mockRejectedValue(new Error("boom: sqlite_locked table=ai_task_execution"));
    const res = await call(JSON.stringify({ conversationId: "v2-test-conv" }));
    expect(res.status).toBe(false);
    // The raw error message (with table name / internals) must NOT leak.
    expect(res.msg).not.toContain("ai_task_execution");
    expect(res.msg).not.toContain("sqlite_locked");
  });
});
