import {
  windowInvoke,
  windowSend,
  windowReceive,
  windowRemoveListener,
  windowRemoveAllListeners,
} from "@/views/utils/apirequest";
import type {
  ChatV2StreamRequest,
  ChatV2StreamChunk,
  ChatV2HistoryResponse,
  ChatV2ConversationSummary,
  ChatToolApprovalMode,
  ChatV2AutoCompactedEvent,
  ChatV2CompactionProgressEvent,
} from "@/entityTypes/aiChatV2Types";
import type { AIChatCompactSummaryView } from "@/entityTypes/aiChatCompactTypes";
import type {
  AIChatPlanStateView,
  AIChatPlanVersionView,
  AskUserQuestionAnswer,
} from "@/entityTypes/aiChatPlanTypes";
import type { OpenAIModelsResponse } from "@/api/aiChatApi";
import type {
  HistoryExcerpt,
  RecoverableHistoryErrorCode,
} from "@/entityTypes/aiChatArchiveTypes";
import type { CompactionStatusSnapshot } from "@/service/AIChatCompactionCoordinator";
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
  AI_CHAT_V2_AUTO_COMPACTED,
  AI_CHAT_V2_HISTORY_SEARCH,
  AI_CHAT_V2_HISTORY_READ,
  AI_CHAT_V2_HISTORY_BROWSE,
  AI_CHAT_V2_HISTORY_RESOLVE_SELECTIONS,
  AI_CHAT_V2_COMPACTION_STATUS,
  AI_CHAT_V2_COMPACTION_CANCEL,
  AI_CHAT_V2_COMPACTION_PROGRESS,
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

/**
 * Registry key used when a stream request omits a conversation id. V2 always
 * sets one in production, but the API still supports the legacy no-id path;
 * this sentinel keeps those listeners tracked so cleanup can detach them
 * instead of leaking (windowReceive registered them, but without a key the
 * registry had no handle to remove them with).
 */
const GLOBAL_STREAM_CONVERSATION_KEY = "__aiChatV2_global_stream__";

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
    // Registry key always resolves to a string so listeners are tracked even
    // on the legacy no-conversationId path (otherwise they could never be
    // detached, leaking windowReceive registrations).
    const conversationKey =
      expectedConversationId ?? GLOBAL_STREAM_CONVERSATION_KEY;
    const isChunkForRequest = (chunk: ChatV2StreamChunk): boolean => {
      if (!expectedConversationId) return true;
      if (chunk.conversationId === expectedConversationId) return true;
      // The main process checks the AI entitlement before parsing the request,
      // so that specific denial cannot echo the request conversation id.
      return !chunk.conversationId && chunk.eventType === "error";
    };
    const cleanup = (): void => {
      detachConversationStreamListeners(conversationKey, false);
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
      detachConversationStreamListeners(conversationKey, false);
      const chunkListener = windowReceive(
        AI_CHAT_V2_STREAM_CHUNK,
        chunkHandler
      );
      const completeListener = windowReceive(
        AI_CHAT_V2_STREAM_COMPLETE,
        completeHandler
      );
      streamListenersByConversation.set(conversationKey, {
        chunkListener,
        completeListener,
        detachedResolve: resolve,
      });
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

/**
 * Subscribe to the auto full-compact broadcast. The main process emits this
 * after it automatically compacts a conversation whose context reached the
 * threshold fraction of the model's window. Handlers must filter by
 * conversationId (only the active conversation's badge should reset).
 * Call unsubscribeAutoCompacted in onBeforeUnmount.
 */
export function subscribeAutoCompacted(
  handler: (event: ChatV2AutoCompactedEvent) => void
): void {
  windowReceive(AI_CHAT_V2_AUTO_COMPACTED, (event) => {
    handler(event as ChatV2AutoCompactedEvent);
  });
}

/** Remove all auto-compacted listeners (call in onBeforeUnmount). */
export function unsubscribeAutoCompacted(): void {
  windowRemoveAllListeners(AI_CHAT_V2_AUTO_COMPACTED);
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

// ---------------------------------------------------------------------------
// Recoverable History + Incremental Compaction (technical-design §13)
// ---------------------------------------------------------------------------

/**
 * Envelope the main process wraps local history-browsing results in. Carries
 * the recoverable-history errorCode so the renderer can distinguish
 * partial-scan / no-match / scope-invalid from a genuine empty result.
 */
export interface HistoryBrowseResult<T> {
  data: T | null;
  errorCode?: RecoverableHistoryErrorCode;
  errorMessage?: string;
}

export interface HistorySearchResult {
  records: HistoryExcerpt[];
  nextCursor: string | null;
  scanComplete: boolean;
  indexComplete: boolean;
  errorCode?: RecoverableHistoryErrorCode;
}

export interface HistoryReadResult {
  records: HistoryExcerpt[];
  nextCursor: string | null;
  truncated: boolean;
  sourceRevision: number;
  storedContentIncomplete: boolean;
  errorCode?: RecoverableHistoryErrorCode;
}

export interface HistoryBrowsePage {
  records: HistoryExcerpt[];
  nextCursor: string | null;
  truncated: boolean;
  sourceRevision: number;
}

/**
 * Paginated chronological browse of archived history (local, §13.1). Viewing
 * is independent of model-context selection: browsing never mutates the next
 * model request unless the user selects a passage.
 */
export async function browseHistory(
  conversationId: string,
  cursor?: string
): Promise<HistoryBrowsePage> {
  const resp = (await windowInvoke(AI_CHAT_V2_HISTORY_BROWSE, {
    conversationId,
    cursor,
  })) as HistoryBrowseResult<HistoryBrowsePage> | null;
  return (
    resp?.data ?? {
      records: [],
      nextCursor: null,
      truncated: false,
      sourceRevision: 0,
    }
  );
}

export interface HistoryResolveResult {
  resolved: HistoryExcerpt[];
  rejected: string[];
  errorCode?: RecoverableHistoryErrorCode;
}

/**
 * Search archived history excerpts for a conversation (local index scan, §13.1).
 * NOT turn-scoped — browsing has no model budget. Pass a cursor for paginated
 * continuation; the backend caps at 20 records per page.
 */
export async function searchHistory(
  conversationId: string,
  query: string,
  cursor?: string,
  limit?: number
): Promise<HistorySearchResult> {
  const resp = (await windowInvoke(AI_CHAT_V2_HISTORY_SEARCH, {
    conversationId,
    query,
    cursor,
    limit,
  })) as HistoryBrowseResult<HistorySearchResult> | null;
  const inner = resp?.data ?? {
    records: [],
    nextCursor: null,
    scanComplete: true,
    indexComplete: false,
    errorCode: resp?.errorCode,
  };
  // Surface the envelope's errorCode when the inner result didn't carry one.
  return {
    ...inner,
    errorCode: inner.errorCode ?? resp?.errorCode,
  };
}

/**
 * Read archived history source slices (§13.1). `args` mirrors the
 * conversation_history_read tool schema: exactly one of source_id/message_id
 * or from_source_id+to_source_id, plus optional neighbors (0-2).
 */
export async function readHistory(
  conversationId: string,
  args: Record<string, unknown>,
  cursor?: string
): Promise<HistoryReadResult> {
  const resp = (await windowInvoke(AI_CHAT_V2_HISTORY_READ, {
    conversationId,
    args,
    cursor,
  })) as HistoryBrowseResult<HistoryReadResult> | null;
  const inner = resp?.data ?? {
    records: [],
    nextCursor: null,
    truncated: false,
    sourceRevision: 0,
    storedContentIncomplete: false,
    errorCode: resp?.errorCode,
  };
  return {
    ...inner,
    errorCode: inner.errorCode ?? resp?.errorCode,
  };
}

/**
 * Resolve user-selected source references to exact excerpts on submit (§13.3).
 * The backend re-validates each opaque source id against the current epoch and
 * revision, returning rejected ids (SOURCE_CHANGED / SOURCE_UNAVAILABLE).
 */
export async function resolveSelections(
  conversationId: string,
  sourceIds: string[]
): Promise<HistoryResolveResult> {
  const resp = (await windowInvoke(AI_CHAT_V2_HISTORY_RESOLVE_SELECTIONS, {
    conversationId,
    sourceIds,
  })) as HistoryBrowseResult<HistoryResolveResult> | null;
  const inner = resp?.data ?? {
    resolved: [],
    rejected: sourceIds,
    errorCode: resp?.errorCode,
  };
  return {
    ...inner,
    errorCode: inner.errorCode ?? resp?.errorCode,
  };
}

/**
 * Read the active incremental-compaction run status for a conversation
 * (§13.1). Returns null when no run exists for this conversation.
 */
export async function getCompactionStatus(
  conversationId: string
): Promise<CompactionStatusSnapshot | null> {
  const resp = await windowInvoke(AI_CHAT_V2_COMPACTION_STATUS, {
    conversationId,
  });
  return (resp as CompactionStatusSnapshot | null) ?? null;
}

/**
 * Cancel the active compaction run for a conversation (§13.1). Best-effort;
 * resolves to { cancelled: true } even when no run was in flight.
 */
export async function cancelCompaction(
  conversationId: string
): Promise<{ cancelled: boolean }> {
  const resp = await windowInvoke(AI_CHAT_V2_COMPACTION_CANCEL, {
    conversationId,
  });
  return (resp as { cancelled: boolean } | null) ?? { cancelled: false };
}

/**
 * Subscribe to incremental-compaction run lifecycle broadcasts (§13.1). The
 * handler must filter by conversationId — only the active conversation's
 * status badge should update. Call unsubscribeCompactionProgress in
 * onBeforeUnmount to avoid leaking the shared-channel listener.
 */
export function subscribeCompactionProgress(
  handler: (event: ChatV2CompactionProgressEvent) => void
): void {
  windowReceive(AI_CHAT_V2_COMPACTION_PROGRESS, (event) => {
    handler(event as ChatV2CompactionProgressEvent);
  });
}

/** Remove ALL compaction-progress listeners (call in onBeforeUnmount). */
export function unsubscribeCompactionProgress(): void {
  windowRemoveAllListeners(AI_CHAT_V2_COMPACTION_PROGRESS);
}
