/**
 * Renderer-only UI test (TODO 2 / PRD §5.1).
 *
 * Exercises the renderer API layer with a typed `window.api` fake — NO Electron,
 * NO Electron-level IPC mock. Establishes the renderer test layer: fast, typed,
 * no `any`.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { WindowApiFake } from "./windowApiFake";
import {
  getChatV2Conversations,
  denyChatV2ToolPermission,
} from "@/views/api/aiChatV2";
import { AI_CHAT_V2_DENY_TOOL_PERMISSION } from "@/config/channellist";

describe("renderer API with a typed window.api fake", () => {
  const api = new WindowApiFake();

  beforeEach(() => {
    api.reset();
    api.install();
  });

  it("returns typed conversations from the fake IPC response", async () => {
    api.setInvokeResponse("ai-chat-v2:conversations", [
      { conversationId: "conv-1", title: "First", lastMessageTimestamp: 0 },
    ]);
    const result = await getChatV2Conversations();
    expect(result).toHaveLength(1);
    expect(result[0].conversationId).toBe("conv-1");
  });

  it("returns an empty array when the fake has no data", async () => {
    api.setInvokeResponse("ai-chat-v2:conversations", null);
    const result = await getChatV2Conversations();
    expect(result).toEqual([]);
  });

  it("records the IPC channel the renderer called", async () => {
    api.setInvokeResponse("ai-chat-v2:conversations", []);
    await getChatV2Conversations();
    expect(
      api.invocations.some((c) => c.channel === "ai-chat-v2:conversations")
    ).toBe(true);
  });

  it("throws a typed error when the fake responds with status false", async () => {
    api.setInvokeResponse(
      "ai-chat-v2:conversations",
      null,
      false,
      "AI is disabled"
    );
    await expect(getChatV2Conversations()).rejects.toThrow("AI is disabled");
  });
});

describe("denyChatV2ToolPermission", () => {
  const api = new WindowApiFake();

  beforeEach(() => {
    api.reset();
    api.install();
  });

  it("returns the scheduled-engine deny result when handled", async () => {
    api.setInvokeResponse(AI_CHAT_V2_DENY_TOOL_PERMISSION, {
      ok: true,
      handled: true,
    });
    const result = await denyChatV2ToolPermission("tool-1", "conv-1");
    expect(result).toEqual({ ok: true, handled: true });
    // Confirms the helper invoked the deny channel (mirrors the conversations
    // test's proven recording assertion).
    expect(
      api.invocations.some((c) => c.channel === AI_CHAT_V2_DENY_TOOL_PERMISSION)
    ).toBe(true);
  });

  it("returns handled:false so the renderer falls back to stopChatV2Stream", async () => {
    api.setInvokeResponse(AI_CHAT_V2_DENY_TOOL_PERMISSION, {
      ok: true,
      handled: false,
    });
    const result = await denyChatV2ToolPermission("tool-2");
    expect(result.handled).toBe(false);
  });

  it("defaults to handled:false when the main process returns null data", async () => {
    api.setInvokeResponse(AI_CHAT_V2_DENY_TOOL_PERMISSION, null);
    const result = await denyChatV2ToolPermission("tool-3", "conv-3");
    expect(result).toEqual({ ok: true, handled: false });
  });

  it("surfaces the error string from the scheduled engine", async () => {
    api.setInvokeResponse(AI_CHAT_V2_DENY_TOOL_PERMISSION, {
      ok: false,
      handled: true,
      error: "deny failed",
    });
    const result = await denyChatV2ToolPermission("tool-4", "conv-4");
    expect(result.error).toBe("deny failed");
  });

  it("throws when the canUseChat gate denies access", async () => {
    api.setInvokeResponse(
      AI_CHAT_V2_DENY_TOOL_PERMISSION,
      null,
      false,
      "AI is disabled"
    );
    await expect(denyChatV2ToolPermission("tool-5", "conv-5")).rejects.toThrow(
      "AI is disabled"
    );
  });
});
