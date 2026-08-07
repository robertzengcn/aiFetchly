import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setupElectronMocks,
  resetElectronMocks,
  mockIpcMain,
} from "../../../utils/electron-mocks";

// Controllable module mock so the IPC test stays off the database.
const mockCreateDraftGoal = vi.hoisted(() => vi.fn());
const mockGetActiveGoal = vi.hoisted(() => vi.fn());
const mockGetGoal = vi.hoisted(() => vi.fn());
const mockCreateRun = vi.hoisted(() => vi.fn());
const mockTransitionGoalStatus = vi.hoisted(() => vi.fn());
const mockCancelActiveRun = vi.hoisted(() => vi.fn());

const aiEnabled = vi.hoisted(() => ({ value: "true" }));

vi.mock("electron", () => ({ ipcMain: mockIpcMain }));
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn(() => aiEnabled.value),
  })),
}));
vi.mock("@/modules/AIChatGoalModule", () => ({
  AIChatGoalModule: vi.fn().mockImplementation(() => ({
    createDraftGoal: mockCreateDraftGoal,
    getActiveGoal: mockGetActiveGoal,
    getGoal: mockGetGoal,
    createRun: mockCreateRun,
    transitionGoalStatus: mockTransitionGoalStatus,
    cancelActiveRun: mockCancelActiveRun,
  })),
}));

import { registerAiChatGoalIpcHandlers } from "@/main-process/communication/ai-chat-goal-ipc";
import {
  AI_CHAT_V2_GOAL_CREATE,
  AI_CHAT_V2_GOAL_GET,
  AI_CHAT_V2_GOAL_LOOP_START,
  AI_CHAT_V2_GOAL_LOOP_STOP,
} from "@/config/channellist";
import type { CommonMessage } from "@/entityTypes/commonType";
import type { AIChatGoalView } from "@/entityTypes/aiChatGoalTypes";

const GOAL_VIEW: AIChatGoalView = {
  goalId: "g-1",
  conversationId: "v2-conv",
  objective: "Build a scraper",
  criteria: [
    {
      criterionId: "c1",
      description: "scraper works",
      required: true,
      verification: { kind: "manual" },
    },
  ],
  status: "draft",
  iterationCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("AI Chat goal/loop IPC", () => {
  beforeEach(() => {
    setupElectronMocks();
    vi.clearAllMocks();
    aiEnabled.value = "true";
    registerAiChatGoalIpcHandlers();
  });
  afterEach(() => resetElectronMocks());

  const call = async (
    channel: string,
    payload: unknown
  ): Promise<CommonMessage<unknown>> =>
    (await mockIpcMain.callHandler(
      channel,
      {},
      payload
    )) as CommonMessage<unknown>;

  it("denies every handler when AI is disabled, before any work", async () => {
    aiEnabled.value = "false";
    const res = await call(
      AI_CHAT_V2_GOAL_CREATE,
      JSON.stringify({ conversationId: "v2-conv", objective: "x" })
    );
    expect(res.status).toBe(false);
    expect(mockCreateDraftGoal).not.toHaveBeenCalled();
  });

  it("creates a draft goal and returns a Plan Mode prompt", async () => {
    mockCreateDraftGoal.mockResolvedValue(GOAL_VIEW);
    const res = await call(
      AI_CHAT_V2_GOAL_CREATE,
      JSON.stringify({
        conversationId: "v2-conv",
        objective: "Build a scraper",
      })
    );
    expect(res.status).toBe(true);
    const created = res.data as {
      goal: { goalId: string };
      planPrompt: string;
    };
    expect(created.goal.goalId).toBe("g-1");
    expect(created.planPrompt).toContain("Build a scraper");
    // /goal with no criteria supplies a default manual criterion.
    const passed = mockCreateDraftGoal.mock.calls[0][0];
    expect(passed.criteria).toHaveLength(1);
    expect(passed.criteria[0].verification.kind).toBe("manual");
    expect(passed.replace).toBe(false);
  });

  it("forwards replace=true so /goal retries can supersede a leftover draft", async () => {
    mockCreateDraftGoal.mockResolvedValue(GOAL_VIEW);
    const res = await call(
      AI_CHAT_V2_GOAL_CREATE,
      JSON.stringify({
        conversationId: "v2-conv",
        objective: "Build a scraper",
        replace: true,
      })
    );
    expect(res.status).toBe(true);
    const passed = mockCreateDraftGoal.mock.calls[0][0];
    expect(passed.replace).toBe(true);
  });

  it("rejects goal-create with an empty objective", async () => {
    const res = await call(
      AI_CHAT_V2_GOAL_CREATE,
      JSON.stringify({ conversationId: "v2-conv", objective: "   " })
    );
    expect(res.status).toBe(false);
    expect(mockCreateDraftGoal).not.toHaveBeenCalled();
  });

  it("rejects malformed criteria", async () => {
    const res = await call(
      AI_CHAT_V2_GOAL_CREATE,
      JSON.stringify({
        conversationId: "v2-conv",
        objective: "x",
        criteria: [{ criterionId: "c1" }],
      })
    );
    expect(res.status).toBe(false);
    expect(mockCreateDraftGoal).not.toHaveBeenCalled();
  });

  it("returns the active goal for a conversation", async () => {
    mockGetActiveGoal.mockResolvedValue(GOAL_VIEW);
    const res = await call(
      AI_CHAT_V2_GOAL_GET,
      JSON.stringify({ conversationId: "v2-conv" })
    );
    expect(res.status).toBe(true);
    const fetched = res.data as { goalId: string };
    expect(fetched.goalId).toBe("g-1");
  });

  it("refuses /loop when the goal is not active", async () => {
    mockGetGoal.mockResolvedValue({ ...GOAL_VIEW, status: "draft" });
    const res = await call(
      AI_CHAT_V2_GOAL_LOOP_START,
      JSON.stringify({
        conversationId: "v2-conv",
        goalId: "g-1",
        maxIterations: 5,
      })
    );
    expect(res.status).toBe(false);
    expect(mockCreateRun).not.toHaveBeenCalled();
  });

  it("clamps loop iterations and starts a run for an active goal", async () => {
    mockGetGoal.mockResolvedValue({ ...GOAL_VIEW, status: "active" });
    mockCreateRun.mockResolvedValue({
      runId: "r-1",
      goalId: "g-1",
      conversationId: "v2-conv",
      status: "running",
      iterationCount: 0,
      maxIterations: 10,
      cancelled: false,
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    const res = await call(
      AI_CHAT_V2_GOAL_LOOP_START,
      JSON.stringify({
        conversationId: "v2-conv",
        goalId: "g-1",
        maxIterations: 99,
      })
    );
    expect(res.status).toBe(true);
    // maxIterations clamped to the configured maximum (10).
    expect(mockCreateRun.mock.calls[0][0].maxIterations).toBe(10);
    expect(mockTransitionGoalStatus).toHaveBeenCalledWith(
      "g-1",
      "running",
      expect.anything()
    );
  });

  it("cancels the active run on loop-stop", async () => {
    mockCancelActiveRun.mockResolvedValue({
      cancelled: true,
      goalId: "g-1",
      runId: "r-1",
    });
    const res = await call(
      AI_CHAT_V2_GOAL_LOOP_STOP,
      JSON.stringify({ conversationId: "v2-conv" })
    );
    expect(res.status).toBe(true);
    const stopped = res.data as { cancelled: boolean };
    expect(stopped.cancelled).toBe(true);
    expect(mockCancelActiveRun).toHaveBeenCalledWith("v2-conv");
  });
});
