import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setupElectronMocks,
  resetElectronMocks,
  mockIpcMain,
} from "../../../utils/electron-mocks";

const suggestMock = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({ ipcMain: mockIpcMain }));

vi.mock("@/service/aiChatAtMentions/AtMentionSuggestionService", () => ({
  AtMentionSuggestionService: vi.fn().mockImplementation(() => ({
    suggest: suggestMock,
  })),
}));

import { registerAiChatAtMentionIpcHandlers } from "@/main-process/communication/ai-chat-at-mention-ipc";
import { AI_CHAT_V2_AT_MENTION_SUGGEST } from "@/config/channellist";
import type { CommonMessage } from "@/entityTypes/commonType";
import type { ChatV2AtMentionSuggestionResponse } from "@/entityTypes/aiChatAtMentionTypes";

describe("AI Chat V2 @-mention suggestion IPC", () => {
  beforeEach(() => {
    setupElectronMocks();
    vi.clearAllMocks();
    registerAiChatAtMentionIpcHandlers();
  });

  afterEach(() => {
    resetElectronMocks();
  });

  it("denies a malformed payload (missing query) without calling the service", async () => {
    const result = (await mockIpcMain.callHandler(
      AI_CHAT_V2_AT_MENTION_SUGGEST,
      {},
      { conversationId: "v2-x" }
    )) as CommonMessage<unknown>;

    expect(result.status).toBe(false);
    expect(typeof result.msg).toBe("string");
    expect(suggestMock).not.toHaveBeenCalled();
  });

  it("denies a non-string conversationId", async () => {
    const result = (await mockIpcMain.callHandler(
      AI_CHAT_V2_AT_MENTION_SUGGEST,
      {},
      { conversationId: 123, query: "src" }
    )) as CommonMessage<unknown>;

    expect(result.status).toBe(false);
    expect(suggestMock).not.toHaveBeenCalled();
  });

  it("parses a valid object payload and delegates to the service", async () => {
    const response: ChatV2AtMentionSuggestionResponse = {
      suggestions: [],
      workspaceRequired: false,
      truncated: false,
    };
    suggestMock.mockResolvedValue(response);

    const result = (await mockIpcMain.callHandler(
      AI_CHAT_V2_AT_MENTION_SUGGEST,
      {},
      { conversationId: "v2-x", query: "src", limit: 999 }
    )) as CommonMessage<ChatV2AtMentionSuggestionResponse>;

    expect(result.status).toBe(true);
    expect(result.data).toEqual(response);
    expect(suggestMock).toHaveBeenCalledTimes(1);
    const passed = suggestMock.mock.calls[0][0];
    expect(passed.conversationId).toBe("v2-x");
    expect(passed.query).toBe("src");
    // The handler passes limit through; the service is responsible for clamping.
    expect(passed.limit).toBe(999);
  });

  it("accepts a JSON-string payload", async () => {
    suggestMock.mockResolvedValue({
      suggestions: [],
      workspaceRequired: true,
      truncated: false,
    });

    const result = (await mockIpcMain.callHandler(
      AI_CHAT_V2_AT_MENTION_SUGGEST,
      {},
      JSON.stringify({ conversationId: "v2-x", query: "foo" })
    )) as CommonMessage<unknown>;

    expect(result.status).toBe(true);
    expect(suggestMock).toHaveBeenCalledTimes(1);
  });

  it("returns a denied CommonMessage without leaking stack traces on failure", async () => {
    suggestMock.mockRejectedValue(new Error("boom at /home/secret/path"));

    const result = (await mockIpcMain.callHandler(
      AI_CHAT_V2_AT_MENTION_SUGGEST,
      {},
      { conversationId: "v2-x", query: "foo" }
    )) as CommonMessage<unknown>;

    expect(result.status).toBe(false);
    expect(typeof result.msg).toBe("string");
    expect(result.msg).not.toContain("/home/secret/path");
  });
});
