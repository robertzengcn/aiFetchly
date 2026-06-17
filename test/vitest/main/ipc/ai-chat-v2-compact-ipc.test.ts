import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  setupElectronMocks,
  resetElectronMocks,
  mockIpcMain,
} from "../../../utils/electron-mocks";

// Mock electron module — must be hoisted before handler import.
vi.mock("electron", () => ({
  ipcMain: mockIpcMain,
  app: { getPath: vi.fn().mockReturnValue("/tmp") },
}));

// Controllable AI-enabled state.
const mockState = vi.hoisted(() => ({ aiEnabled: "true" }));
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn().mockImplementation(() => mockState.aiEnabled),
  })),
}));
// Override USER_AI_ENABLED to a literal so the Token mock matches.
vi.mock("@/config/usersetting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/usersetting")>();
  return {
    ...actual,
    USER_AI_ENABLED: "USER_AI_ENABLED",
    USERSDBPATH: "USERSDBPATH",
  };
});

// Mock the compact agent — the heart of what we're testing.
const mockRunFullCompact = vi.hoisted(() => vi.fn());
vi.mock("@/service/AIChatCompactAgentService", () => ({
  AIChatCompactAgentService: vi.fn().mockImplementation(() => ({
    runFullCompact: mockRunFullCompact,
    enqueueSessionMemoryUpdate: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Stub remaining modules that the IPC file imports at load time.
vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(() => ({
    getConversations: vi.fn().mockResolvedValue([]),
    createConversationIfNeeded: vi.fn().mockReturnValue("v2-test"),
    saveUserMessage: vi.fn().mockResolvedValue({}),
    getConversationMessages: vi.fn().mockResolvedValue([]),
    saveAssistantMessage: vi.fn().mockResolvedValue({}),
    getDefaultSystemPrompt: vi.fn().mockReturnValue("sys"),
    clearConversation: vi.fn().mockResolvedValue(0),
    clearAllV2History: vi.fn().mockResolvedValue(0),
  })),
}));
vi.mock("@/modules/AIChatPlanModule", () => ({
  AIChatPlanModule: vi.fn().mockImplementation(() => ({
    getPlanState: vi.fn().mockResolvedValue(null),
    ensurePlanForConversation: vi.fn().mockResolvedValue(null),
  })),
}));
vi.mock("@/api/aiChatApi", () => ({
  AiChatApi: vi.fn().mockImplementation(() => ({})),
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

import { registerAiChatV2IpcHandlers } from "@/main-process/communication/ai-chat-v2-ipc";
import { AI_CHAT_V2_COMPACT_CONVERSATION } from "@/config/channellist";
import type { AIChatCompactSummaryView } from "@/entityTypes/aiChatCompactTypes";

const fakeSummary: AIChatCompactSummaryView = {
  compactId: "compact-1",
  conversationId: "v2-conv-1",
  summary: "# Recent Work\n- Did X\n- Did Y",
  throughMessageId: "assistant-5",
  throughTimestamp: "2026-06-15T12:00:00.000Z",
  sourceMessageCount: 10,
  inputTokenEstimate: 800,
  outputTokenEstimate: 200,
  model: "gpt-4o",
  status: "active",
};

describe("AI Chat V2 Compact Conversation IPC", () => {
  beforeEach(() => {
    setupElectronMocks();
    vi.clearAllMocks();
    mockState.aiEnabled = "true";
    registerAiChatV2IpcHandlers();
  });

  afterEach(() => {
    resetElectronMocks();
  });

  it("registers the compact channel", () => {
    const registered = mockIpcMain.getRegisteredChannels();
    expect(registered).toContain(AI_CHAT_V2_COMPACT_CONVERSATION);
  });

  it("returns denied when AI is not enabled", async () => {
    mockState.aiEnabled = "false";
    const result = await mockIpcMain.callHandler(
      AI_CHAT_V2_COMPACT_CONVERSATION,
      {},
      JSON.stringify({ conversationId: "v2-conv-1" })
    );
    expect(result).toMatchObject({ status: false });
    expect(mockRunFullCompact).not.toHaveBeenCalled();
  });

  it("returns denied when conversationId is missing", async () => {
    const result = (await mockIpcMain.callHandler(
      AI_CHAT_V2_COMPACT_CONVERSATION,
      {},
      JSON.stringify({})
    )) as { status: boolean; msg: string };
    expect(result.status).toBe(false);
    expect(result.msg).toMatch(/conversationId is required/i);
    expect(mockRunFullCompact).not.toHaveBeenCalled();
  });

  it("returns denied when conversationId lacks v2- prefix", async () => {
    const result = (await mockIpcMain.callHandler(
      AI_CHAT_V2_COMPACT_CONVERSATION,
      {},
      JSON.stringify({ conversationId: "legacy-1" })
    )) as { status: boolean; msg: string };
    expect(result.status).toBe(false);
    expect(result.msg).toMatch(/v2-/i);
    expect(mockRunFullCompact).not.toHaveBeenCalled();
  });

  it("returns compact summary on success", async () => {
    mockRunFullCompact.mockResolvedValueOnce(fakeSummary);

    const result = (await mockIpcMain.callHandler(
      AI_CHAT_V2_COMPACT_CONVERSATION,
      {},
      JSON.stringify({ conversationId: "v2-conv-1", model: "gpt-4o" })
    )) as { status: boolean; data: AIChatCompactSummaryView };

    expect(mockRunFullCompact).toHaveBeenCalledWith({
      conversationId: "v2-conv-1",
      model: "gpt-4o",
    });
    expect(result.status).toBe(true);
    expect(result.data).toEqual(fakeSummary);
  });

  it("returns denied when runFullCompact throws", async () => {
    mockRunFullCompact.mockRejectedValueOnce(
      new Error("No messages to compact")
    );
    const result = (await mockIpcMain.callHandler(
      AI_CHAT_V2_COMPACT_CONVERSATION,
      {},
      JSON.stringify({ conversationId: "v2-conv-1" })
    )) as { status: boolean; msg: string };
    expect(result.status).toBe(false);
    // userSafeError maps unknown errors to a generic safe message.
    expect(result.msg).toMatch(/unexpected error/i);
  });
});
