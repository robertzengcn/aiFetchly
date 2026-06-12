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

// Mock Token so AI-enabled is controllable.
vi.mock("@/modules/token", () => {
  return {
    Token: vi.fn().mockImplementation(() => ({
      getValue: vi.fn().mockReturnValue("true"),
    })),
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

// Mock the v2 module.
const mockClearConversation = vi.fn().mockResolvedValue(5);
const mockClearAllV2 = vi.fn().mockResolvedValue(5);
const mockGetConversations = vi.fn().mockResolvedValue([]);
vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(() => ({
    clearConversation: mockClearConversation,
    clearAllV2History: mockClearAllV2,
    getConversations: mockGetConversations,
  })),
}));

import { registerAiChatV2IpcHandlers } from "@/main-process/communication/ai-chat-v2-ipc";
import {
  AI_CHAT_V2_CONVERSATIONS,
  AI_CHAT_V2_CLEAR_CONVERSATION,
  AI_CHAT_V2_CLEAR_ALL,
} from "@/config/channellist";

describe("AI Chat V2 IPC handlers", () => {
  beforeEach(() => {
    setupElectronMocks();
    vi.clearAllMocks();
    registerAiChatV2IpcHandlers();
  });

  afterEach(() => {
    resetElectronMocks();
  });

  it("registers a handler for each v2 channel", () => {
    const registered = mockIpcMain.getRegisteredChannels();
    expect(registered).toContain(AI_CHAT_V2_CONVERSATIONS);
    expect(registered).toContain(AI_CHAT_V2_CLEAR_CONVERSATION);
    expect(registered).toContain(AI_CHAT_V2_CLEAR_ALL);
  });

  it("lists conversations through the module", async () => {
    const result = await mockIpcMain.callHandler(AI_CHAT_V2_CONVERSATIONS);
    expect(mockGetConversations).toHaveBeenCalled();
    expect(result).toMatchObject({ status: true });
  });

  it("clears a conversation through the module", async () => {
    const result = await mockIpcMain.callHandler(
      AI_CHAT_V2_CLEAR_CONVERSATION,
      {},
      JSON.stringify({ conversationId: "v2-1" })
    );
    expect(mockClearConversation).toHaveBeenCalledWith("v2-1");
    expect(result).toMatchObject({ status: true });
  });

  it("clears all v2 history through the module", async () => {
    const result = await mockIpcMain.callHandler(AI_CHAT_V2_CLEAR_ALL);
    expect(mockClearAllV2).toHaveBeenCalled();
    expect(result).toMatchObject({ status: true });
  });
});
