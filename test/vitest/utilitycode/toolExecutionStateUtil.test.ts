import { describe, expect, it } from "vitest";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import { hasPendingToolExecution } from "@/views/components/aiChatV2/toolExecutionStateUtil";

const makeMessage = (
  id: string,
  messageType: MessageType,
  toolCallId?: string
): ChatV2MessageView => ({
  id,
  conversationId: "conv-1",
  role: "assistant",
  content: "",
  timestamp: "2026-06-22T00:00:00.000Z",
  messageType,
  metadata: {
    source: "chat-v2",
    toolCallId,
    toolName: "search",
  },
});

describe("toolExecutionStateUtil", () => {
  it("detects a loaded chat history with a tool call still running", () => {
    const messages = [
      makeMessage("tool-call-1", MessageType.TOOL_CALL, "call-1"),
    ];

    expect(hasPendingToolExecution(messages)).toBe(true);
  });

  it("does not report running after the matching tool result is loaded", () => {
    const messages = [
      makeMessage("tool-call-1", MessageType.TOOL_CALL, "call-1"),
      makeMessage("tool-result-1", MessageType.TOOL_RESULT, "call-1"),
    ];

    expect(hasPendingToolExecution(messages)).toBe(false);
  });
});
