import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import { isPlanToolName } from "@/service/PlanModeToolPolicy";
import { isEnterPlanModeToolName } from "@/service/EnterPlanModeTool";

/**
 * Plan-mode tools (`EnterPlanMode`, `AskUserQuestion`, `SubmitPlanForApproval`)
 * never produce a matching `tool_result` event — they drive UI state through
 * `plan_state` / `ask_user_question` / `plan_submitted` events instead.
 * Treating their `tool_call` rows as pending execution would leave the chat
 * stuck in a "running" state forever. Exclude them from the pending check.
 */
const isPlanModeUiToolCall = (message: ChatV2MessageView): boolean => {
  const toolName = message.metadata?.toolName;
  if (typeof toolName !== "string") return false;
  return isEnterPlanModeToolName(toolName) || isPlanToolName(toolName);
};

export const hasPendingToolExecution = (
  messages: ChatV2MessageView[]
): boolean => {
  const pendingToolCallIds = new Set<string>();
  let anonymousToolCalls = 0;

  for (const message of messages) {
    const toolCallId = message.metadata?.toolCallId;
    if (message.messageType === MessageType.TOOL_CALL) {
      if (isPlanModeUiToolCall(message)) continue;
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
