import { MessageType } from "@/entityTypes/commonType";
import type {
  ChatV2MessageMetadata,
  ChatV2MessageView,
} from "@/entityTypes/aiChatV2Types";
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

export const clearToolProgressForToolResult = (
  messages: ChatV2MessageView[],
  toolCallId: string | undefined
): ChatV2MessageView[] => {
  if (!toolCallId) return messages;

  let cleared = false;
  const nextMessages = messages.map((message) => {
    if (
      message.messageType !== MessageType.TOOL_CALL ||
      message.metadata?.toolCallId !== toolCallId ||
      !message.metadata.toolProgress
    ) {
      return message;
    }

    const metadata: ChatV2MessageMetadata = { ...message.metadata };
    delete metadata.toolProgress;
    cleared = true;

    return {
      ...message,
      metadata,
    };
  });

  return cleared ? nextMessages : messages;
};

/**
 * Replace an approved permission card with a non-interactive running state.
 * Long-running tools can take minutes after approval; keeping the approval
 * button spinning for that whole interval incorrectly implies that the click
 * itself is stuck. The final streamed tool result replaces this local state.
 */
export const markPermissionPromptExecuting = (
  messages: ChatV2MessageView[],
  messageId: string
): ChatV2MessageView[] => {
  let changed = false;
  const nextMessages = messages.map((message) => {
    if (
      message.id !== messageId ||
      message.messageType !== MessageType.TOOL_RESULT ||
      message.metadata?.toolResult?.needsPermissionPrompt !== true
    ) {
      return message;
    }

    changed = true;
    return {
      ...message,
      content: "",
      metadata: {
        ...message.metadata,
        toolResult: {
          ...message.metadata.toolResult,
          needsPermissionPrompt: false,
          executionPending: true,
        },
      },
    };
  });

  return changed ? nextMessages : messages;
};
