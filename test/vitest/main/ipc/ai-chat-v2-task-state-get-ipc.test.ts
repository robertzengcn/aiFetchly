// test/vitest/main/ipc/ai-chat-v2-task-state-get-ipc.test.ts
//
// T13 (PRD FR-13/14, AC-16/24/25/27/32) — the read-only latest-execution
// IPC handler `AI_CHAT_V2_TASK_STATE_GET` lets history reload restore the
// badge from the stored row. The handler is AI-gated first (the
// AI-feature-IPC mandate), delegates to `AiTaskExecutionModule.
// getExecutionStateProjection` (G01-314 enriched projection: badge +
// progress + remaining limits + safe actions), never touches a repository
// directly, and returns the projection (executionId / conversationId /
// status / reasonCode / outcome + enrichment). Returns null for
// response-only answers that never enrolled — the renderer shows no badge
// in that case.
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

// --- AiTaskExecutionModule: getExecutionStateProjection is the T13/G01-314 query ----
const getExecutionStateProjectionMock = vi.hoisted(() => vi.fn());
vi.mock("@/modules/AiTaskExecutionModule", () => ({
  AiTaskExecutionModule: class {
    getExecutionStateProjection = getExecutionStateProjectionMock;
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

/** A finalized execution state projection the module mock serves. */
function executionProjection(overrides?: {
  executionId?: string;
  conversationId?: string;
  status?: string;
  outcome?: string | undefined;
  reasonCode?: string | undefined;
  finalEventIdentity?: string;
  safeActions?: string[];
}): Record<string, unknown> {
  // Presence checks (`in`) — not `??` — so an explicit `undefined` override
  // (the "in-flight, not yet finalized" case) omits the key instead of being
  // coalesced back to the finalized default. The handler spreads
  // `safeActions`, so the mock always serves an array (mirrors
  // `deriveSafeActions`: verified_complete → [], running → ["stop"]).
  const hasOutcome: boolean =
    overrides !== undefined && "outcome" in overrides;
  const hasReasonCode: boolean =
    overrides !== undefined && "reasonCode" in overrides;
  const projection: Record<string, unknown> = {
    executionId: overrides?.executionId ?? "exec-state-1",
    conversationId: overrides?.conversationId ?? "v2-test-conv",
    status: overrides?.status ?? "terminal",
    safeActions: overrides?.safeActions ?? [],
  };
  if (hasOutcome) {
    const outcome: string | undefined = overrides?.outcome;
    if (outcome !== undefined) {
      projection.outcome = outcome;
    }
  } else {
    projection.outcome = "verified_complete";
  }
  if (hasReasonCode) {
    const reasonCode: string | undefined = overrides?.reasonCode;
    if (reasonCode !== undefined) {
      projection.reasonCode = reasonCode;
    }
  } else {
    projection.reasonCode = "CRITERIA_SATISFIED";
  }
  if (overrides?.finalEventIdentity !== undefined) {
    projection.finalEventIdentity = overrides.finalEventIdentity;
  }
  return projection;
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
    getExecutionStateProjectionMock.mockReset();
    getExecutionStateProjectionMock.mockResolvedValue(null);
    registerAiChatV2IpcHandlers();
  });

  afterEach(() => {
    resetAiChatV2RuntimeForDatabaseSwitch();
    resetElectronMocks();
  });

  it("denies before any work when AI is disabled (AI-gate-first mandate)", async () => {
    mockState.aiEnabled = "false";
    getExecutionStateProjectionMock.mockResolvedValue(executionProjection());
    const res = await call(JSON.stringify({ conversationId: "v2-test-conv" }));
    expect(res.status).toBe(false);
    expect(getExecutionStateProjectionMock).not.toHaveBeenCalled();
  });

  it("denies when the payload is not valid JSON / object", async () => {
    const res = await call("not-json");
    expect(res.status).toBe(false);
    expect(getExecutionStateProjectionMock).not.toHaveBeenCalled();
  });

  it("denies when conversationId is missing or empty", async () => {
    const res = await call(JSON.stringify({ conversationId: "" }));
    expect(res.status).toBe(false);
    expect(getExecutionStateProjectionMock).not.toHaveBeenCalled();
  });

  it("returns null when no execution exists for the conversation (response-only answers never enrolled)", async () => {
    getExecutionStateProjectionMock.mockResolvedValue(null);
    const res = await call(JSON.stringify({ conversationId: "v2-test-conv" }));
    expect(res.status).toBe(true);
    expect(res.data).toBeNull();
    expect(getExecutionStateProjectionMock).toHaveBeenCalledWith("v2-test-conv");
  });

  it("returns the row projection (executionId / status / outcome / reasonCode) for a finalized execution", async () => {
    getExecutionStateProjectionMock.mockResolvedValue(executionProjection());
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
    getExecutionStateProjectionMock.mockResolvedValue(
      executionProjection({
        status: "active",
        outcome: undefined,
        reasonCode: undefined,
        safeActions: ["stop"],
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
    getExecutionStateProjectionMock.mockRejectedValue(new Error("boom: sqlite_locked table=ai_task_execution"));
    const res = await call(JSON.stringify({ conversationId: "v2-test-conv" }));
    expect(res.status).toBe(false);
    // The raw error message (with table name / internals) must NOT leak.
    expect(res.msg).not.toContain("ai_task_execution");
    expect(res.msg).not.toContain("sqlite_locked");
  });
});
