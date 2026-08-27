import type {
  AIChatQueryEvent,
  AIChatQueryEventSink,
} from "@/service/AIChatQueryEvents";
import type { ChatV2StreamChunk } from "@/entityTypes/aiChatV2Types";

/**
 * Delivery target for mapped Chat V2 stream chunks (workspace redesign §7.6).
 *
 * The legacy IPC handler targets `event.sender`; the workspace coordinator
 * targets the run-owned event router. Both share one mapping so renderer
 * chunk semantics never diverge between the two paths.
 */
export interface ChatV2StreamSinkTarget {
  sendChunk(chunk: ChatV2StreamChunk): void;
  sendComplete(chunk: ChatV2StreamChunk): void;
}

/** Map engine query events to renderer ChatV2StreamChunk payloads. */
export function createChatV2StreamSink(
  sinkTarget: ChatV2StreamSinkTarget
): AIChatQueryEventSink {
  return {
    emit: (e: AIChatQueryEvent) => {
      switch (e.type) {
        case "start":
          sinkTarget.sendChunk({
            eventType: "start",
            conversationId: e.conversationId,
            messageId: e.messageId,
          });
          break;
        case "token":
          sinkTarget.sendChunk({
            eventType: "token",
            conversationId: e.conversationId,
            messageId: e.messageId,
            contentDelta: e.contentDelta,
            model: e.model,
          });
          break;
        case "reasoning_delta":
          sinkTarget.sendChunk({
            eventType: "reasoning_delta",
            conversationId: e.conversationId,
            messageId: e.messageId,
            reasoningDelta: e.reasoningDelta,
            model: e.model,
          });
          break;
        case "retry_connect":
          sinkTarget.sendChunk({
            eventType: "retry_connect",
            conversationId: e.conversationId,
            messageId: e.messageId,
            retryAttempt: e.retryAttempt,
            retryMaxAttempts: e.retryMaxAttempts,
            retryDelayMs: e.retryDelayMs,
          });
          break;
        case "recovery_status":
          sinkTarget.sendChunk({
            eventType: "recovery_status",
            conversationId: e.conversationId,
            messageId: e.messageId,
            recoveryLayer: e.layer,
            recoveryReason: e.reason,
            recoveryAttempt: e.attempt,
            recoveryMaxAttempts: e.maxAttempts,
            recoveryDelayMs: e.delayMs,
            recoveryElapsedMs: e.elapsedMs,
            recoveryOriginalModel: e.originalModel,
            recoveryCurrentModel: e.currentModel,
            recoveryFallbackModel: e.fallbackModel,
            recoveryMessage: e.message,
          });
          break;
        case "tool_progress":
          sinkTarget.sendChunk({
            eventType: "tool_progress",
            conversationId: e.conversationId,
            messageId: e.messageId,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            phase: e.phase,
            progressMessage: e.message,
            progressFraction:
              typeof e.progress === "number" ? e.progress : undefined,
            partialCount: e.partialCount ?? undefined,
            expectedCount: e.expectedCount ?? undefined,
            progressTimestamp: e.timestamp,
          });
          break;
        case "tool_call":
          sinkTarget.sendChunk({
            eventType: "tool_call",
            conversationId: e.conversationId,
            messageId: e.messageId,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            toolArguments: e.toolArguments,
          });
          break;
        case "tool_result":
          sinkTarget.sendChunk({
            eventType: "tool_result",
            conversationId: e.conversationId,
            messageId: e.messageId,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            fullContent: e.fullContent,
            toolResult: e.toolResult,
            replacesPermissionPromptForToolId:
              e.replacesPermissionPromptForToolId,
          });
          break;
        case "plan_blocked_tool":
          sinkTarget.sendChunk({
            eventType: "plan_blocked_tool" as never,
            conversationId: e.conversationId,
            messageId: e.messageId,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            fullContent: e.fullContent,
            planBlockedToolName: e.planBlockedToolName,
            planBlockedReason: e.planBlockedReason,
          } as ChatV2StreamChunk);
          break;
        case "ask_user_question":
          sinkTarget.sendChunk({
            eventType: "ask_user_question" as never,
            conversationId: e.conversationId,
            messageId: e.messageId,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            question: e.question,
            planState: e.planState,
          } as ChatV2StreamChunk);
          break;
        case "plan_submitted":
          sinkTarget.sendChunk({
            eventType: "plan_submitted" as never,
            conversationId: e.conversationId,
            messageId: e.messageId,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            planState: e.planState,
          } as ChatV2StreamChunk);
          break;
        case "plan_state":
          sinkTarget.sendChunk({
            eventType: "plan_state" as never,
            conversationId: e.conversationId,
            messageId: e.messageId,
            planState: e.planState,
            autoEntered: e.autoEntered,
          } as ChatV2StreamChunk);
          break;
        case "usage_update":
          sinkTarget.sendChunk({
            eventType: "usage_update",
            conversationId: e.conversationId,
            messageId: e.messageId,
            model: e.model,
            promptTokens: e.promptTokens,
            completionTokens: e.completionTokens,
            totalTokens: e.totalTokens,
          });
          break;
        case "complete":
          sinkTarget.sendComplete({
            eventType: "complete",
            conversationId: e.conversationId,
            messageId: e.messageId,
            fullContent: e.fullContent,
            images: e.images,
            model: e.model,
            finishReason: e.finishReason,
            promptTokens: e.promptTokens,
            completionTokens: e.completionTokens,
            totalTokens: e.totalTokens,
          });
          break;
        case "cancelled":
          sinkTarget.sendComplete({
            eventType: "cancelled",
            conversationId: e.conversationId,
            messageId: e.messageId,
            fullContent: e.fullContent,
          });
          break;
        case "error":
          sinkTarget.sendComplete({
            eventType: "error",
            conversationId: e.conversationId,
            messageId: e.messageId,
            errorMessage: e.errorMessage,
          });
          break;
      }
    },
  };
}
