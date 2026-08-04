import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setupElectronMocks,
  resetElectronMocks,
  mockIpcMain,
} from "../../../utils/electron-mocks";
import type { CommonMessage } from "@/entityTypes/commonType";
import type {
  CreateScheduledLoopResponse,
  ScheduledLoopView,
} from "@/entityTypes/aiChatScheduledLoopTypes";

// Controllable module mock so the IPC test stays off the database.
const mockCreate = vi.hoisted(() => vi.fn());
const mockGetStatus = vi.hoisted(() => vi.fn());
const mockPause = vi.hoisted(() => vi.fn());
const mockResume = vi.hoisted(() => vi.fn());
const mockStop = vi.hoisted(() => vi.fn());
const mockStopCurrentRun = vi.hoisted(() => vi.fn());

const aiEnabled = vi.hoisted(() => ({ value: "true" }));

vi.mock("electron", () => ({ ipcMain: mockIpcMain }));
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn(() => aiEnabled.value),
  })),
}));
vi.mock("@/modules/AIChatScheduledLoopModule", () => ({
  AIChatScheduledLoopModule: vi.fn().mockImplementation(() => ({
    create: mockCreate,
    getStatus: mockGetStatus,
    pause: mockPause,
    resume: mockResume,
    stop: mockStop,
    stopCurrentRun: mockStopCurrentRun,
  })),
  ScheduledLoopError: class extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
}));

import { registerAiChatScheduledLoopIpcHandlers } from "@/main-process/communication/ai-chat-scheduled-loop-ipc";
import {
  AI_CHAT_V2_SCHEDULED_LOOP_CREATE,
  AI_CHAT_V2_SCHEDULED_LOOP_GET,
  AI_CHAT_V2_SCHEDULED_LOOP_PAUSE,
  AI_CHAT_V2_SCHEDULED_LOOP_STOP_RUN,
} from "@/config/channellist";

const VIEW: ScheduledLoopView = {
  scheduleId: 1,
  taskId: 2,
  conversationId: "v2-conv",
  prompt: "check deployment",
  status: "active",
  intervalMs: 300_000,
  maxRuns: 24,
  claimedRuns: 0,
  successfulRuns: 0,
  consecutiveFailures: 0,
  expiresAt: "2026-01-02T00:00:00.000Z",
};

describe("AI Chat scheduled-loop IPC", () => {
  beforeEach(() => {
    setupElectronMocks();
    vi.clearAllMocks();
    aiEnabled.value = "true";
    registerAiChatScheduledLoopIpcHandlers();
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

  it("denies create when AI is disabled, before module construction", async () => {
    aiEnabled.value = "false";
    const res = await call(AI_CHAT_V2_SCHEDULED_LOOP_CREATE, {
      conversationId: "v2-conv",
      rawCommand: "/loop 5m x",
      prompt: "x",
      intervalMs: 300_000,
      maxRuns: 24,
      maxLifetimeMs: 86_400_000,
    });
    expect(res.status).toBe(false);
    expect(res.msg).toContain("subscribers");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects an invalid create payload without touching the module", async () => {
    const res = await call(AI_CHAT_V2_SCHEDULED_LOOP_CREATE, {
      conversationId: "v2-conv",
      rawCommand: "/loop 5m x",
      // prompt missing on purpose
      intervalMs: 300_000,
      maxRuns: 24,
      maxLifetimeMs: 86_400_000,
    });
    expect(res.status).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates a scheduled loop and returns the response", async () => {
    const response: CreateScheduledLoopResponse = {
      conversationId: "v2-conv",
      commandMessageId: "cmd-1",
      resultMessageId: "res-1",
      loop: VIEW,
    };
    mockCreate.mockResolvedValue(response);
    const res = await call(AI_CHAT_V2_SCHEDULED_LOOP_CREATE, {
      conversationId: "v2-conv",
      rawCommand: "/loop 5m check deployment",
      prompt: "check deployment",
      intervalMs: 300_000,
      maxRuns: 24,
      maxLifetimeMs: 86_400_000,
    });
    expect(res.status).toBe(true);
    expect((res.data as CreateScheduledLoopResponse).loop.status).toBe("active");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "check deployment" })
    );
  });

  it("maps a ScheduledLoopError code to a stable message", async () => {
    const { ScheduledLoopError } = await import(
      "@/modules/AIChatScheduledLoopModule"
    );
    mockCreate.mockRejectedValue(new ScheduledLoopError("LOOP_ALREADY_ACTIVE"));
    const res = await call(AI_CHAT_V2_SCHEDULED_LOOP_CREATE, {
      conversationId: "v2-conv",
      rawCommand: "/loop 5m x",
      prompt: "x",
      intervalMs: 300_000,
      maxRuns: 24,
      maxLifetimeMs: 86_400_000,
    });
    expect(res.status).toBe(false);
    expect(res.msg).toContain("already has an active");
  });

  it("returns the schedule view for get", async () => {
    mockGetStatus.mockResolvedValue(VIEW);
    const res = await call(AI_CHAT_V2_SCHEDULED_LOOP_GET, {
      conversationId: "v2-conv",
    });
    expect(res.status).toBe(true);
    expect((res.data as ScheduledLoopView).scheduleId).toBe(1);
  });

  it("denies pause when AI is disabled", async () => {
    aiEnabled.value = "false";
    const res = await call(AI_CHAT_V2_SCHEDULED_LOOP_PAUSE, {
      conversationId: "v2-conv",
    });
    expect(res.status).toBe(false);
    expect(mockPause).not.toHaveBeenCalled();
  });

  it("runs pause and returns the updated view", async () => {
    mockPause.mockResolvedValue({ ...VIEW, status: "paused" });
    const res = await call(AI_CHAT_V2_SCHEDULED_LOOP_PAUSE, {
      conversationId: "v2-conv",
    });
    expect(res.status).toBe(true);
    expect((res.data as ScheduledLoopView).status).toBe("paused");
  });

  it("stop-run returns the cancelled flag", async () => {
    mockStopCurrentRun.mockResolvedValue({ cancelled: true });
    const res = await call(AI_CHAT_V2_SCHEDULED_LOOP_STOP_RUN, {
      conversationId: "v2-conv",
    });
    expect(res.status).toBe(true);
    expect((res.data as { cancelled: boolean }).cancelled).toBe(true);
  });
});
