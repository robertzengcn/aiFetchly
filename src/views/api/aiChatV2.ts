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
  AI_CHAT_V2_PLAN_STATE,
  AI_CHAT_V2_ANSWER_QUESTION,
  AI_CHAT_V2_APPROVE_PLAN,
  AI_CHAT_V2_REJECT_PLAN,
  AI_CHAT_V2_REQUEST_PLAN_CHANGES,
  AI_CHAT_V2_PLAN_VERSIONS,
  AI_CHAT_V2_GET_TOOL_APPROVAL_MODE,
  AI_CHAT_V2_SET_TOOL_APPROVAL_MODE,
  AI_CHAT_V2_DENY_TOOL_PERMISSION,
  AI_CHAT_V2_READ_PASTE_CACHE,
  AI_CHAT_V2_AUTO_COMPACTED,
  AI_CHAT_V2_HISTORY_SEARCH,
  AI_CHAT_V2_HISTORY_READ,
  AI_CHAT_V2_HISTORY_BROWSE,
  AI_CHAT_V2_HISTORY_RESOLVE_SELECTIONS,
  AI_CHAT_V2_HISTORY_UI_ENABLED,
  AI_CHAT_V2_COMPACTION_STATUS,
  AI_CHAT_V2_COMPACTION_CANCEL,
  AI_CHAT_V2_COMPACTION_START,
  AI_CHAT_V2_COMPACTION_PROGRESS,
  AI_CHAT_V2_TASK_CONTINUE,
  AI_CHAT_V2_TASK_RETRY,
} from "@/config/channellist";
import type { ChatV2TaskExecutionStateEvent } from "@/entityTypes/aiTaskExecutionTypes";

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
 * T09 (FR-14/21/22, AC-16/27/28): attach the renderer to a task successor
 * (Continue / Retry) background turn.
 *
 * The component usually invokes the successor IPC itself first (create +
 * dispatch), then calls this helper with the SAME `submissionId`. The
 * second invoke dedups in the model as `reused` (no re-dispatch, no renewed
 * limits), so a `reused` response is SUCCESS here: the listeners still need
 * attaching because the engine turn from the first invoke is already
 * streaming. A denied / conflicted invoke (status false) is a real failure:
 * report it, clean up, and reject.
 *
 * The successor's events stream over the shared recovery channels
 * (AI_CHAT_V2_STREAM_CHUNK / _COMPLETE) with the successor's conversationId —
 * never AI_CHAT_V2_STREAM, which nothing sends for a successor. Listener
 * lifecycle mirrors streamChatV2Message: replace-then-register per
 * conversation, stale-conversation events neither route nor detach, and a
 * terminal event for the successor conversation resolves (complete) or
 * rejects (error) and detaches both listeners.
 *
 * B10 correlation: `executionId` (required) gates task_execution_state
 * forwarding; content/terminal chunks are attributed by assistant message
 * id (learned from the successor `start`, else the parent id passed by the
 * component). Late parent chunks are dropped — a parent complete can never
 * resolve or detach this attachment early.
 */
export interface AttachChatV2SuccessorStreamInput {
  mode: "continue" | "retry";
  parentExecutionId: string;
  /** Same submissionId the create call used — enables the model dedup. */
  submissionId: string;
  conversationId: string;
  /**
   * B10 (FR-13/14/21/22, AC-25/27/32): the successor execution identity
   * (from the `created` response). REQUIRED — task_execution_state chunks
   * are correlated by it, so late parent-execution states can never regress
   * the successor badge this attachment owns.
   */
  executionId: string;
  /**
   * B10: the superseded parent turn's assistant message id, when known.
   * Content/complete chunks carrying it are late-parent stragglers and are
   * dropped (they must neither render into the successor turn nor close
   * this attachment). Null when the parent id was never observed.
   */
  parentMessageId?: string | null;
  onTaskExecutionState: (state: ChatV2TaskExecutionStateEvent) => void;
  /**
   * B10: successor content chunks (token/tool/final segments, start) for
   * the component to render into the successor turn. Only
   * successor-attributed chunks arrive here — never parent stragglers, never
   * task_execution_state (those route to onTaskExecutionState).
   */
  onChunk?: (chunk: ChatV2StreamChunk) => void;
  onComplete: (chunk: ChatV2StreamChunk) => void;
  onError: (error: Error) => void;
}

/**
 * B10: a task_execution_state chunk belongs to the successor turn being
 * attached (pure — unit-tested without IPC).
 */
export function isSuccessorExecutionState(
  chunk: ChatV2StreamChunk,
  successorExecutionId: string
): boolean {
  return (
    chunk.eventType === "task_execution_state" &&
    chunk.taskExecutionState?.executionId === successorExecutionId
  );
}

/**
 * B10: a terminal chunk belongs to a superseded turn and must NOT close or
 * render into the successor attachment (pure — unit-tested without IPC).
 * A chunk is superseded when it carries the parent's message id, or a
 * message id that is neither the parent's nor the learned successor's
 * (a third turn's). Chunks with no message id cannot be attributed and are
 * accepted (the successor is the only turn this attachment streams).
 */
export function isSupersededTurnChunk(
  chunk: ChatV2StreamChunk,
  parentMessageId: string | null | undefined,
  successorMessageId: string | null | undefined
): boolean {
  const messageId = chunk.messageId;
  if (!messageId) return false;
  if (parentMessageId && messageId === parentMessageId) return true;
  if (successorMessageId && messageId !== successorMessageId) return true;
  return false;
}

export async function attachChatV2SuccessorStream(
  input: AttachChatV2SuccessorStreamInput
): Promise<void> {
  const {
    mode,
    parentExecutionId,
    submissionId,
    conversationId,
    executionId,
    parentMessageId,
    onTaskExecutionState,
    onChunk,
    onComplete,
    onError,
  } = input;
  return new Promise((resolve, reject) => {
    const conversationKey = conversationId;
    const isChunkForRequest = (chunk: ChatV2StreamChunk): boolean =>
      chunk.conversationId === conversationId;
    const cleanup = (): void => {
      detachConversationStreamListeners(conversationKey, false);
    };
    // B10: the successor turn's assistant message id, learned from its
    // `start` chunk (authoritative turn open — the parent's start fired long
    // before attach, so a post-attach start is the successor's). Content and
    // terminal chunks are correlated against it once known.
    let successorMessageId: string | null = null;

    const chunkHandler = (raw: unknown): void => {
      try {
        const chunk: ChatV2StreamChunk = JSON.parse(String(raw));
        if (!isChunkForRequest(chunk)) return;
        if (
          chunk.eventType === "task_execution_state" &&
          chunk.taskExecutionState
        ) {
          // B10: only the successor execution's states reach the badge —
          // late parent-execution states must not regress it.
          if (isSuccessorExecutionState(chunk, executionId)) {
            onTaskExecutionState(chunk.taskExecutionState);
          }
          return;
        }
        // B10: drop identifiable late-parent content (it must not render
        // into the successor turn). Unattributable chunks flow — the parent
        // is terminal (continue) or stopped (retry), so the successor is the
        // only turn streaming on this conversation.
        if (isSupersededTurnChunk(chunk, parentMessageId, successorMessageId)) {
          return;
        }
        if (chunk.eventType === "start" && chunk.messageId) {
          successorMessageId = chunk.messageId;
        }
        onChunk?.(chunk);
      } catch (err) {
        console.error("aiChatV2: successor chunk parse error", err);
      }
    };

    const completeHandler = (raw: unknown): void => {
      let shouldCleanup = true;
      try {
        const chunk: ChatV2StreamChunk = JSON.parse(String(raw));
        if (!isChunkForRequest(chunk)) {
          shouldCleanup = false;
          return;
        }
        // B10: a late parent complete must neither resolve this attachment
        // nor detach its listeners — the successor is still running.
        if (isSupersededTurnChunk(chunk, parentMessageId, successorMessageId)) {
          shouldCleanup = false;
          return;
        }
        if (chunk.messageId && !successorMessageId) {
          successorMessageId = chunk.messageId;
        }
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
            : new Error("Successor completion parse error");
        onError(error);
        reject(error);
      } finally {
        if (shouldCleanup) {
          cleanup();
        }
      }
    };

    void (async () => {
      try {
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
        const channel =
          mode === "retry" ? AI_CHAT_V2_TASK_RETRY : AI_CHAT_V2_TASK_CONTINUE;
        await windowInvoke(channel, { parentExecutionId, submissionId });
      } catch (err) {
        cleanup();
        const error =
          err instanceof Error ? err : new Error("Successor attach failed");
        onError(error);
        reject(error);
      }
    })();
  });
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
 * Start (or resume) a bounded compaction run and return IMMEDIATELY with a
 * start acknowledgement (design §13.1 start/status/progress). The run
 * continues in the main process; track it via `getCompactionStatus` and the
 * `subscribeCompactionProgress` event. Resume is just another start call.
 */
export async function startCompaction(
  conversationId: string,
  model?: string
): Promise<{ started: boolean }> {
  const resp = await windowInvoke(AI_CHAT_V2_COMPACTION_START, {
    conversationId,
    model,
  });
  return (resp as { started: boolean } | null) ?? { started: false };
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
 * Returns the stored mode for the conversation.
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
// Tool Permission Grant / Deny
// ---------------------------------------------------------------------------

/**
 * Response from denying a paused tool permission. When `handled` is `true`, a
 * scheduled-loop engine owned the paused turn and synthesized a denied
 * tool_result (the run continues without the tool). When `handled` is `false`,
 * no scheduled engine owned the permission and the renderer must fall back to
 * `stopChatV2Stream` (interactive deny).
 */
export interface DenyToolPermissionResult {
  ok: boolean;
  handled: boolean;
  error?: string;
}

/**
 * Deny a paused tool permission. Routes through the main-process
 * `ScheduledLoopEngineRegistry`: when a scheduled engine owns the paused turn
 * it synthesizes a denied tool_result and continues the run; otherwise the
 * caller falls back to `stopChatV2Stream`. `windowInvoke` throws on a denied
 * `canUseChat` gate, so callers should wrap in try/catch.
 */
export async function denyChatV2ToolPermission(
  toolId: string,
  conversationId?: string
): Promise<DenyToolPermissionResult> {
  const resp = await windowInvoke(AI_CHAT_V2_DENY_TOOL_PERMISSION, {
    toolId,
    conversationId,
  });
  return (
    (resp as DenyToolPermissionResult | null) ?? { ok: true, handled: false }
  );
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

/**
 * Read whether the recoverable-history UI stage is enabled (design §18,
 * stage 3). The flag lives in main (Token); the renderer cannot force-enable
 * it. Fail-closed: any transport error resolves to false so selection chips
 * never render without backend resolution.
 */
export async function isHistoryUiEnabled(): Promise<boolean> {
  try {
    const resp = (await windowInvoke(AI_CHAT_V2_HISTORY_UI_ENABLED, {})) as {
      data?: { enabled?: boolean } | null;
      enabled?: boolean;
    } | null;
    if (!resp) return false;
    if (typeof (resp as { enabled?: unknown }).enabled === "boolean") {
      return (resp as { enabled: boolean }).enabled;
    }
    const inner = (resp as { data?: { enabled?: unknown } | null }).data;
    return inner?.enabled === true;
  } catch {
    return false;
  }
}
