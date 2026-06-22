import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";

export const hasPendingToolExecution = (
  messages: ChatV2MessageView[]
): boolean => {
  const pendingToolCallIds = new Set<string>();
  let anonymousToolCalls = 0;

  for (const message of messages) {
    const toolCallId = message.metadata?.toolCallId;
    if (message.messageType === MessageType.TOOL_CALL) {
      if (toolCallId) {
        pendingToolCallIds.add(toolCallId);
      } else {
        anonymousToolCalls += 1;
      }
    } else if (message.messageType === MessageType.TOOL_RESULT) {
      if (toolCallId) {
        pendingToolCallIds.delete(toolCallId);
      } else if (anonymousToolCalls > 0) {
        anonymousToolCalls -= 1;
      }
    }
  }

  return pendingToolCallIds.size > 0 || anonymousToolCalls > 0;
};
