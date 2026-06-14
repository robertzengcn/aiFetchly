import {
  windowInvoke,
  windowSend,
  windowReceive,
  windowRemoveAllListeners,
} from "@/views/utils/apirequest";
import type {
  ChatV2StreamRequest,
  ChatV2StreamChunk,
  ChatV2HistoryResponse,
  ChatV2ConversationSummary,
} from "@/entityTypes/aiChatV2Types";
import type {
  AIChatPlanStateView,
  AIChatPlanVersionView,
  AskUserQuestionAnswer,
} from "@/entityTypes/aiChatPlanTypes";
import type { OpenAIModelsResponse } from "@/api/aiChatApi";
import {
  AI_CHAT_V2_MODELS,
  AI_CHAT_V2_CONVERSATIONS,
  AI_CHAT_V2_HISTORY,
  AI_CHAT_V2_STREAM,
  AI_CHAT_V2_STREAM_STOP,
  AI_CHAT_V2_STREAM_CHUNK,
  AI_CHAT_V2_STREAM_COMPLETE,
  AI_CHAT_V2_CLEAR_CONVERSATION,
  AI_CHAT_V2_CLEAR_ALL,
  AI_CHAT_V2_PLAN_STATE,
  AI_CHAT_V2_ANSWER_QUESTION,
  AI_CHAT_V2_APPROVE_PLAN,
  AI_CHAT_V2_REJECT_PLAN,
  AI_CHAT_V2_REQUEST_PLAN_CHANGES,
  AI_CHAT_V2_PLAN_VERSIONS,
} from "@/config/channellist";

let activeChunkHandler: ((raw: string) => void) | null = null;
let activeCompleteHandler: ((raw: string) => void) | null = null;

export function clearChatV2StreamListeners(): void {
  if (activeChunkHandler || activeCompleteHandler) {
    windowRemoveAllListeners(AI_CHAT_V2_STREAM_CHUNK);
    windowRemoveAllListeners(AI_CHAT_V2_STREAM_COMPLETE);
  }
  activeChunkHandler = null;
  activeCompleteHandler = null;
}

/**
 * Get available OpenAI-compatible models.
 *
 * `windowInvoke` returns the unwrapped `result.data` from the IPC handler,
 * so the return type matches the inner payload directly.
 */
export async function getOpenAIChatModels(): Promise<OpenAIModelsResponse | null> {
  const resp = await windowInvoke(AI_CHAT_V2_MODELS);
  return (resp as OpenAIModelsResponse | null) ?? null;
}

/**
 * List all v2 chat conversations with summary metadata.
 * Pass a searchQuery to filter conversations by message content (LIKE).
 */
export async function getChatV2Conversations(
  searchQuery?: string
): Promise<ChatV2ConversationSummary[]> {
  const resp = await windowInvoke(AI_CHAT_V2_CONVERSATIONS, searchQuery);
  return (resp as ChatV2ConversationSummary[] | null) ?? [];
}

/**
 * Load the message history for a specific conversation.
 */
export async function getChatV2History(
  conversationId: string
): Promise<ChatV2HistoryResponse | null> {
  const resp = await windowInvoke(AI_CHAT_V2_HISTORY, { conversationId });
  return (resp as ChatV2HistoryResponse | null) ?? null;
}

/**
 * Stream a chat message over IPC.
 *
 * Registers listeners for chunk and complete events, then sends the stream
 * request. The returned Promise resolves when the stream completes (success,
 * error, or cancelled). Listeners are cleaned up in the complete handler.
 *
 * @param request - The stream request payload (message, model, etc.)
 * @param onChunk - Callback for each token/chunk event received
 * @param onComplete - Callback for the successful completion event
 * @param onError - Callback invoked on stream error or parse failure
 */
export async function streamChatV2Message(
  request: ChatV2StreamRequest,
  onChunk: (chunk: ChatV2StreamChunk) => void,
  onComplete: (chunk: ChatV2StreamChunk) => void,
  onError: (error: Error) => void
): Promise<void> {
  const chunkHandler = (raw: string): void => {
    try {
      const chunk: ChatV2StreamChunk = JSON.parse(raw);
      onChunk(chunk);
    } catch (err) {
      console.error("aiChatV2: parse chunk error", err);
    }
  };

  const completeHandler = (raw: string): void => {
    try {
      const chunk: ChatV2StreamChunk = JSON.parse(raw);
      if (chunk.eventType === "error" && chunk.errorMessage) {
        onError(new Error(chunk.errorMessage));
      } else {
        onComplete(chunk);
      }
    } catch (err) {
      onError(
        err instanceof Error ? err : new Error("Stream completion parse error")
      );
    }
    clearChatV2StreamListeners();
  };

  clearChatV2StreamListeners();
  activeChunkHandler = chunkHandler;
  activeCompleteHandler = completeHandler;
  windowReceive(AI_CHAT_V2_STREAM_CHUNK, chunkHandler);
  windowReceive(AI_CHAT_V2_STREAM_COMPLETE, completeHandler);
  windowSend(AI_CHAT_V2_STREAM, request);
}

/**
 * Request the main process to abort the active v2 chat stream.
 * Fire-and-forget; the stream completion handler will fire with a cancelled payload.
 */
export function stopChatV2Stream(): void {
  windowSend(AI_CHAT_V2_STREAM_STOP, {});
}

/**
 * Clear all messages in a specific v2 conversation.
 */
export async function clearChatV2Conversation(
  conversationId: string
): Promise<{ deleted: number } | null> {
  const resp = await windowInvoke(AI_CHAT_V2_CLEAR_CONVERSATION, {
    conversationId,
  });
  return (resp as { deleted: number } | null) ?? null;
}

/**
 * Clear all v2 chat history across all conversations.
 */
export async function clearAllChatV2History(): Promise<{
  deleted: number;
} | null> {
  const resp = await windowInvoke(AI_CHAT_V2_CLEAR_ALL);
  return (resp as { deleted: number } | null) ?? null;
}

// ---------------------------------------------------------------------------
// Plan Mode API
// ---------------------------------------------------------------------------

/**
 * Load the current plan state for a conversation (status, version, pending
 * question, etc.). Returns null if no plan exists for this conversation.
 */
export async function getChatV2PlanState(
  conversationId: string
): Promise<AIChatPlanStateView | null> {
  const resp = await windowInvoke(AI_CHAT_V2_PLAN_STATE, { conversationId });
  return (resp as AIChatPlanStateView | null) ?? null;
}

/**
 * Submit answers to a pending plan question. If the AI stream was paused
 * waiting for this answer, the main process will resume it automatically.
 */
export async function answerChatV2Question(
  conversationId: string,
  questionId: string,
  answers: AskUserQuestionAnswer[]
): Promise<{ ok: boolean; error?: string }> {
  const resp = await windowInvoke(AI_CHAT_V2_ANSWER_QUESTION, {
    conversationId,
    questionId,
    answers,
  });
  return (resp as { ok: boolean; error?: string }) ?? { ok: false };
}

/**
 * Approve the current plan version. After approval, high-impact tools are
 * unblocked and the AI can begin executing the plan.
 */
export async function approveChatV2Plan(
  conversationId: string,
  planId: string,
  version: number
): Promise<AIChatPlanStateView | null> {
  const resp = await windowInvoke(AI_CHAT_V2_APPROVE_PLAN, {
    conversationId,
    planId,
    version,
  });
  return (resp as AIChatPlanStateView | null) ?? null;
}

/**
 * Reject the current plan version permanently.
 */
export async function rejectChatV2Plan(
  conversationId: string,
  planId: string,
  version: number,
  feedback?: string
): Promise<AIChatPlanStateView | null> {
  const resp = await windowInvoke(AI_CHAT_V2_REJECT_PLAN, {
    conversationId,
    planId,
    version,
    feedback,
  });
  return (resp as AIChatPlanStateView | null) ?? null;
}

/**
 * Request changes to the current plan. The plan goes back to "draft" status
 * so the AI can produce a new version. Feedback is required.
 */
export async function requestChatV2PlanChanges(
  conversationId: string,
  planId: string,
  version: number,
  feedback: string
): Promise<AIChatPlanStateView | null> {
  const resp = await windowInvoke(AI_CHAT_V2_REQUEST_PLAN_CHANGES, {
    conversationId,
    planId,
    version,
    feedback,
  });
  return (resp as AIChatPlanStateView | null) ?? null;
}

/**
 * List all versions of a plan (for history/diff view).
 */
export async function getChatV2PlanVersions(
  planId: string
): Promise<AIChatPlanVersionView[]> {
  const resp = await windowInvoke(AI_CHAT_V2_PLAN_VERSIONS, { planId });
  return (resp as AIChatPlanVersionView[] | null) ?? [];
}
