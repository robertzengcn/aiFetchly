/**
 * Renderer-only UI test (TODO 2 / PRD §5.1).
 *
 * Exercises the renderer API layer with a typed `window.api` fake — NO Electron,
 * NO Electron-level IPC mock. Establishes the renderer test layer: fast, typed,
 * no `any`.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { WindowApiFake } from "./windowApiFake";
import { getChatV2Conversations } from "@/views/api/aiChatV2";

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
