import {
  windowInvoke,
  windowSend,
  windowReceive,
  windowRemoveListener,
} from "@/views/utils/apirequest";
import type {
  ChatV2StreamRequest,
  ChatV2StreamChunk,
  ChatV2HistoryResponse,
  ChatV2ConversationSummary,
  ChatToolApprovalMode,
} from "@/entityTypes/aiChatV2Types";
import type { AIChatCompactSummaryView } from "@/entityTypes/aiChatCompactTypes";
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
  AI_CHAT_V2_COMPACT_CONVERSATION,
  AI_CHAT_V2_PLAN_STATE,
  AI_CHAT_V2_ANSWER_QUESTION,
  AI_CHAT_V2_APPROVE_PLAN,
  AI_CHAT_V2_REJECT_PLAN,
  AI_CHAT_V2_REQUEST_PLAN_CHANGES,
  AI_CHAT_V2_PLAN_VERSIONS,
  AI_CHAT_V2_GET_TOOL_APPROVAL_MODE,
  AI_CHAT_V2_SET_TOOL_APPROVAL_MODE,
  AI_CHAT_V2_READ_PASTE_CACHE,
} from "@/config/channellist";

/**
 * Per-conversation stream listeners, keyed by conversationId. Each entry holds
 * the exact `windowReceive` return values (required by `windowRemoveListener`)
 * so a stream owns its own listener lifecycle on the shared IPC channel.
 *
 * ipcRenderer.on registers additively, and every chunk handler filters by
 * conversationId (isChunkForRequest), so multiple concurrent conversations can
 * listen at once — starting a stream in B no longer detaches A's listeners.
 */
interface ChatV2StreamListeners {
  chunkListener: (raw: unknown) => void;
  completeListener: (raw: unknown) => void;
  detachedResolve: () => void;
}
const streamListenersByConversation = new Map<string, ChatV2StreamListeners>();

const detachConversationStreamListeners = (
  conversationId: string,
  resolvePending: boolean
): void => {
  const listeners = streamListenersByConversation.get(conversationId);
  if (!listeners) return;
  windowRemoveListener(AI_CHAT_V2_STREAM_CHUNK, listeners.chunkListener);
  windowRemoveListener(AI_CHAT_V2_STREAM_COMPLETE, listeners.completeListener);
  streamListenersByConversation.delete(conversationId);
  if (resolvePending) {
    listeners.detachedResolve();
  }
};

/**
 * Detach ALL conversation stream listeners and resolve their pending stream
 * promises. Used only on teardown (component unmount / DB switch); normal
 * stream completion detaches only the owning conversation's listeners.
 */
export function clearChatV2StreamListeners(): void {
  for (const conversationId of [...streamListenersByConversation.keys()]) {
    detachConversationStreamListeners(conversationId, true);
  }
}

/**
 * Detach listeners for a single conversation without touching other
 * conversations' background streams. Pass `resolvePending: true` to also
 * resolve that conversation's pending streamChatV2Message promise — required
 * when stopping the stream from the renderer side (Stop button / permission
 * deny) so the awaited stream call in onSend unblocks instead of hanging.
 */
export function detachChatV2ConversationStreamListeners(
  conversationId: string,
  resolvePending = false
): void {
  detachConversationStreamListeners(conversationId, resolvePending);
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
  const resp = await windowInvoke(
    AI_CHAT_V2_CONVERSATIONS,
    searchQuery ? { searchQuery } : undefined
  );
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
 * Read cached expanded pasted-text body for history preview dialogs.
 * Returns null when the cache entry is missing.
 */
export async function readPasteCache(
  contentHash: string
): Promise<string | null> {
  const resp = await windowInvoke(AI_CHAT_V2_READ_PASTE_CACHE, {
    contentHash,
  });
  return (resp as string | null) ?? null;
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
  return new Promise((resolve, reject) => {
    let tokenLogCount = 0;
    const expectedConversationId =
      typeof request.conversationId === "string" &&
      request.conversationId.length > 0
        ? request.conversationId
        : undefined;
    const isChunkForRequest = (chunk: ChatV2StreamChunk): boolean => {
      if (!expectedConversationId) return true;
      if (chunk.conversationId === expectedConversationId) return true;
      // The main process checks the AI entitlement before parsing the request,
      // so that specific denial cannot echo the request conversation id.
      return !chunk.conversationId && chunk.eventType === "error";
    };
    const cleanup = (): void => {
      if (expectedConversationId) {
        detachConversationStreamListeners(expectedConversationId, false);
      } else {
        // Legacy no-conversationId fallback (V2 always sets one): clear all.
        clearChatV2StreamListeners();
      }
    };

    const chunkHandler = (raw: unknown): void => {
      try {
        const chunk: ChatV2StreamChunk = JSON.parse(String(raw));
        if (!isChunkForRequest(chunk)) {
          console.debug(
            `[aiChatV2] ignored stale chunk event=${chunk.eventType} conv=${
              chunk.conversationId || "(none)"
            } expected=${expectedConversationId}`
          );
          return;
        }
        if (chunk.eventType === "token") {
          if (tokenLogCount < 5 || tokenLogCount % 25 === 0) {
            console.debug(
              `[aiChatV2] token chunk conv=${
                chunk.conversationId || "(none)"
              } message=${chunk.messageId || "(none)"} deltaLen=${
                chunk.contentDelta?.length ?? 0
              } tokenIndex=${tokenLogCount}`
            );
          }
          tokenLogCount += 1;
        } else {
          console.debug(
            `[aiChatV2] stream chunk event=${chunk.eventType} conv=${
              chunk.conversationId || "(none)"
            } message=${chunk.messageId || "(none)"} fullContentLen=${
              chunk.fullContent?.length ?? 0
            } error=${chunk.errorMessage ? "yes" : "no"}`
          );
        }
        onChunk(chunk);
      } catch (err) {
        console.error("aiChatV2: parse chunk error", err);
      }
    };

    const completeHandler = (raw: unknown): void => {
      let shouldCleanup = true;
      try {
        const chunk: ChatV2StreamChunk = JSON.parse(String(raw));
        if (!isChunkForRequest(chunk)) {
          console.debug(
            `[aiChatV2] ignored stale complete event=${chunk.eventType} conv=${
              chunk.conversationId || "(none)"
            } expected=${expectedConversationId}`
          );
          shouldCleanup = false;
          return;
        }
        console.debug(
          `[aiChatV2] stream complete event=${chunk.eventType} conv=${
            chunk.conversationId || "(none)"
          } message=${chunk.messageId || "(none)"} fullContentLen=${
            chunk.fullContent?.length ?? 0
          } finish=${chunk.finishReason ?? "(none)"} error=${
            chunk.errorMessage ? "yes" : "no"
          }`
        );
        if (chunk.eventType === "error" && chunk.errorMessage) {
          const error = new Error(chunk.errorMessage);
          onError(error);
          reject(error);
        } else {
          onComplete(chunk);
          resolve();
        }
      } catch (err) {
        const error =
          err instanceof Error
            ? err
            : new Error("Stream completion parse error");
        onError(error);
        reject(error);
      } finally {
        if (shouldCleanup) {
          cleanup();
        }
      }
    };

    try {
      // Replace any prior listener for THIS conversation only (a same-
      // conversation re-send supersedes the in-flight stream). Other
      // conversations' listeners are intentionally left registered so their
      // background streams keep receiving their own chunks.
      if (expectedConversationId) {
        detachConversationStreamListeners(expectedConversationId, false);
      } else {
        clearChatV2StreamListeners();
      }
      const chunkListener = windowReceive(
        AI_CHAT_V2_STREAM_CHUNK,
        chunkHandler
      );
      const completeListener = windowReceive(
        AI_CHAT_V2_STREAM_COMPLETE,
        completeHandler
      );
      if (expectedConversationId) {
        streamListenersByConversation.set(expectedConversationId, {
          chunkListener,
          completeListener,
          detachedResolve: resolve,
        });
      }
      void windowSend(AI_CHAT_V2_STREAM, request).catch((err: unknown) => {
        cleanup();
        const error =
          err instanceof Error
            ? err
            : new Error("Failed to start AI chat stream");
        onError(error);
        reject(error);
      });
    } catch (err) {
      cleanup();
      const error =
        err instanceof Error
          ? err
          : new Error("Failed to start AI chat stream");
      onError(error);
      reject(error);
    }
  });
}

/**
 * Request the main process to abort a v2 chat stream. Fire-and-forget; the
 * stream completion handler will fire with a cancelled payload.
 *
 * Pass `conversationId` to stop ONLY that conversation's turn (other
 * conversations' background streams are unaffected). Omit it to stop every
 * active turn (DB switch / sign-out).
 */
export function stopChatV2Stream(conversationId?: string): void {
  windowSend(AI_CHAT_V2_STREAM_STOP, conversationId ? { conversationId } : {});
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

/**
 * Run a full compact for the selected v2 conversation and return the active
 * compact summary saved by the main process.
 */
export async function compactChatV2Conversation(
  conversationId: string,
  model?: string
): Promise<AIChatCompactSummaryView | null> {
  const resp = await windowInvoke(AI_CHAT_V2_COMPACT_CONVERSATION, {
    conversationId,
    model,
  });
  return (resp as AIChatCompactSummaryView | null) ?? null;
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

// ---------------------------------------------------------------------------
// Tool Approval Mode
// ---------------------------------------------------------------------------

/**
 * Get the tool approval mode for a conversation.
 */
export async function getChatV2ToolApprovalMode(
  conversationId: string
): Promise<ChatToolApprovalMode> {
  const resp = await windowInvoke(AI_CHAT_V2_GET_TOOL_APPROVAL_MODE, {
    conversationId,
  });
  return (resp as ChatToolApprovalMode) ?? "ask_for_approval";
}

/**
 * Set the tool approval mode for a conversation.
 * Returns the stored mode (may differ from requested if downgraded).
 */
export async function setChatV2ToolApprovalMode(
  conversationId: string,
  mode: ChatToolApprovalMode
): Promise<ChatToolApprovalMode> {
  const resp = await windowInvoke(AI_CHAT_V2_SET_TOOL_APPROVAL_MODE, {
    conversationId,
    mode,
  });
  return (resp as ChatToolApprovalMode) ?? "ask_for_approval";
}
