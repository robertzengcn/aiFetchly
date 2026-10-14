import { computed, markRaw, ref } from "vue";
import { defineStore } from "pinia";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import type {
  ChatRunDetailEvent,
  ConversationRuntimeStatus,
} from "@/entityTypes/aiChatWorkspaceTypes";
import {
  createWorkspaceStreamPresenter,
  type StreamPresenterOptions,
  type WorkspaceStreamStatus,
  type GoalRunInfo,
  type RecoveryInfo,
  type RetryInfo,
} from "@/views/utils/workspaceStreamPresenter";
import {
  cancelChatRun,
  createClientRequestId,
  loadHistoryPage,
  markConversationRead,
  selectConversation,
  startChatRun,
  subscribeDetailEvents,
  unsubscribeDetail,
} from "@/views/api/aiChatWorkspace";
import { denyChatV2ToolPermission } from "@/views/api/aiChatV2";
import { windowInvoke } from "@/views/utils/apirequest";
import { AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION } from "@/config/channellist";
import {
  markPermissionPromptExecuting,
  restorePermissionPromptAfterFailure,
} from "@/views/components/aiChatV2/toolExecutionStateUtil";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";
import {
  emitShellDiagnostic,
  hashConversationId,
} from "@/views/utils/shellDiagnostics";

/** Default mounted ordinary message rows (design §12.2: bounded window). */
export const MAX_MOUNTED_MESSAGES = 200;

export interface SendOptions {
  readonly model?: string;
  readonly mode?: "chat" | "plan";
  readonly toolApprovalMode?:
    | "ask_for_approval"
    | "approve_for_me"
    | "full_access";
  readonly showReasoning?: boolean;
  /** Encoded attachments forwarded through the workspace start-run IPC. */
  readonly attachments?: readonly {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    contentBase64: string;
    kind: "document" | "image";
  }[];
  /**
   * Generated images attached as edit references (message + tile index).
   * The engine resolves them against persisted history and forwards the
   * image bytes to the model as `image_url` parts.
   */
  readonly generatedImageReferences?: readonly {
    messageId: string;
    imageIndex: number;
  }[];
  /**
   * FR-SUB-004 (capability parity): send-time paste bodies keyed by the
   * composer's numeric paste ids — forwarded through the workspace IPC to
   * the engine exactly as the Chat V2 stream edge does.
   */
  readonly pastedContents?: Record<string, string>;
  /**
   * FR-IMG-004 trusted channel: the user-confirmed generated-image batch
   * reference set (above the 3-reference direct cap). Rides outside
   * `generatedImageReferences` as `confirmedGeneratedImageBatch`.
   */
  readonly confirmedBatchReferences?: readonly {
    messageId: string;
    imageIndex: number;
  }[];
  /**
   * FR-HIS-002 transport: opaque archive references + retry-stable
   * submission identity (resolved by the engine start acknowledgement).
   */
  readonly historySelectionIds?: readonly string[];
  readonly submissionId?: string;
  /**
   * T8/T2 (audit): request identity. Defaults to a fresh random id; plan
   * continuations pass the AD-007 deterministic hash so a reload or replay
   * resubmits the SAME job identity instead of minting a duplicate.
   */
  readonly clientRequestId?: string;
}

/**
 * Localized permission-card strings passed in by the surface that owns
 * `useI18n` — the store stays i18n-free (technical-design §14.2).
 */
export interface PermissionActionTexts {
  readonly deniedText: string;
  readonly resumeFailedText: string;
  readonly noToolIdText: string;
}

/**
 * Replaceable selected-chat state (technical-design §14.2): bounded message
 * window, runtime snapshot, detail-event application with 50 ms batching,
 * and the selection handshake. Switching conversations never cancels the
 * previous run — only presentation buffers are cleared.
 */
export const useSelectedConversationStore = defineStore(
  "selectedConversation",
  () => {
    const workspaceStore = useChatWorkspaceStore();

    // Flush-time sync (design §13): onMutate fires on real state mutations
    // — never per buffered token — so one reactive update lands per flush
    // window, terminal, or seed instead of per stream chunk.
    // onStartAck fans engine `start` acknowledgements out to registered
    // surfaces (FR-HIS-003: history-selection accepted/changed/rejected ids).
    const startAckListeners = new Set<(chunk: Record<string, unknown>) => void>();
    const liveToolResultListeners = new Set<
      (chunk: Record<string, unknown>) => void
    >();
    const presenter = markRaw(
      createWorkspaceStreamPresenter({
        onMutate: () => syncFromPresenter(),
        onStartAck: (chunk) => {
          for (const listener of startAckListeners) {
            listener(chunk);
          }
        },
        onLiveToolResult: (chunk) => {
          for (const listener of liveToolResultListeners) {
            listener(chunk);
          }
        },
      })
    );
    // Re-create presenter with options indirection for tests.
    function resetPresenter(options?: StreamPresenterOptions): void {
      const next = createWorkspaceStreamPresenter(options);
      Object.assign(presenter, next);
    }

    const messages = ref<readonly ChatV2MessageView[]>([]);
    const recovery = ref<RecoveryInfo | null>(null);
    const retry = ref<RetryInfo | null>(null);
    const goal = ref<GoalRunInfo | null>(null);
    const activeAssistantMessageId = ref<string | null>(null);
    const streamStatus = ref<WorkspaceStreamStatus>("idle");
    const errorMessage = ref<string | null>(null);
    const runtimeStatus = ref<ConversationRuntimeStatus>("idle");
    const activeRunId = ref<string | null>(null);
    const loading = ref(false);
    const loadError = ref<string | null>(null);
    const hasOlder = ref(false);
    const loadingOlder = ref(false);
    const selectedTitle = ref<string | null>(null);

    let detailUnsubscribe: (() => void) | null = null;
    let appliedGeneration = -1;
    let nextBeforeCursor: { timestamp: string; messageId: string } | null =
      null;

    function syncFromPresenter(): void {
      const state = presenter.getState();
      messages.value = [...state.messages];
      activeAssistantMessageId.value = state.activeAssistantMessageId;
      streamStatus.value = state.streamStatus;
      errorMessage.value = state.errorMessage;
      runtimeStatus.value = state.runtimeStatus;
      activeRunId.value = state.activeRunId;
      recovery.value = state.recovery;
      retry.value = state.retry;
      goal.value = state.goal;
    }

    /** Ensure exactly one detail subscription exists for this renderer. */
    function ensureDetailSubscription(): void {
      if (detailUnsubscribe) return;
      detailUnsubscribe = subscribeDetailEvents((event) => {
        if (event.conversationId !== workspaceStore.selectedConversationId) {
          return; // stale or foreign conversation (design §18.4)
        }
        applyDetailEvent(event);
      });
    }

    function applyDetailEvent(event: ChatRunDetailEvent): void {
      const consumed = presenter.applyEvent(event);
      if (!consumed) return;
      // Reactive sync happens through the presenter's onMutate hook — one
      // update per flush window, not one per token chunk.
      // FR-026: an openImmediately artifact opens the inspector preview for
      // the SELECTED conversation only (events arrive selected-only).
      if (event.eventType === "tool_result") {
        const pending = presenter.consumePendingArtifactOpen();
        if (pending) {
          workspaceStore.requestArtifactPreview(pending.artifactId);
        }
      }
      // A terminal event for the selected conversation means durable state
      // changed — the view is authoritative enough (the presenter applied
      // the full content) but clear unread locally.
      if (
        event.eventType === "complete" ||
        event.eventType === "error" ||
        event.eventType === "cancelled"
      ) {
        workspaceStore.markConversationReadLocally(event.conversationId);
      }
    }

    /**
     * Selection handshake (design §11.6): bump generation, subscribe FIRST
     * (main registers before reading), then seed from the returned snapshot.
     */
    async function loadSelection(conversationId: string | null): Promise<void> {
      const generation = workspaceStore.nextGeneration();
      appliedGeneration = generation;
      workspaceStore.setSelected(conversationId);
      loading.value = conversationId !== null;
      loadError.value = null;

      // Clear only presentation buffers — the previous run keeps executing.
      presenter.dispose();
      syncFromPresenter();

      if (conversationId === null) {
        nextBeforeCursor = null;
        hasOlder.value = false;
        selectedTitle.value = null;
        loading.value = false;
        return;
      }

      const startedAt = Date.now();
      ensureDetailSubscription();
      try {
        const snapshot = await selectConversation(conversationId, generation);
        // Apply only if this handshake is still the latest selection.
        if (
          appliedGeneration !== generation ||
          snapshot.acceptedGeneration === -1
        ) {
          emitShellDiagnostic({
            type: "chat.selection_loaded",
            conversationHash: hashConversationId(conversationId),
            generation,
            latencyMs: Date.now() - startedAt,
            outcome: "superseded",
          });
          return;
        }
        presenter.seedHistory([...snapshot.messages]);
        nextBeforeCursor = snapshot.nextBefore;
        hasOlder.value = snapshot.hasOlder;
        runtimeStatus.value = snapshot.runtimeStatus;
        activeRunId.value = snapshot.activeRunId;
        selectedTitle.value = snapshot.title;
        syncFromPresenter();
        emitShellDiagnostic({
          type: "chat.selection_loaded",
          conversationHash: hashConversationId(conversationId),
          generation,
          latencyMs: Date.now() - startedAt,
          outcome: "ok",
        });
        await markReadAfterLoad(conversationId);
      } catch (err) {
        if (appliedGeneration === generation) {
          loadError.value =
            err instanceof Error ? err.message : "Failed to load conversation";
          emitShellDiagnostic({
            type: "chat.selection_loaded",
            conversationHash: hashConversationId(conversationId),
            generation,
            latencyMs: Date.now() - startedAt,
            outcome: "error",
          });
        }
      } finally {
        if (appliedGeneration === generation) {
          loading.value = false;
        }
      }
    }

    /** Advance the durable read marker after the newest page is displayed. */
    async function markReadAfterLoad(conversationId: string): Promise<void> {
      const newest = messages.value[messages.value.length - 1];
      if (!newest) return;
      try {
        await markConversationRead({
          conversationId,
          observedThrough: newest.timestamp,
        });
        workspaceStore.markConversationReadLocally(conversationId);
      } catch {
        // Non-fatal: unread stays until the next successful mark.
      }
    }

    /** Load the next older page and prepend it (design §12.2). */
    async function loadOlder(): Promise<void> {
      const conversationId = workspaceStore.selectedConversationId;
      if (!conversationId || !nextBeforeCursor || loadingOlder.value) return;
      loadingOlder.value = true;
      try {
        const page = await loadHistoryPage(
          conversationId,
          50,
          nextBeforeCursor
        );
        nextBeforeCursor = page.nextBefore;
        hasOlder.value = page.hasOlder;
        presenter.prependHistory([...page.messages]);
        // Evict distant rows beyond the bounded window (design §12.2).
        evictBeyondWindow();
        syncFromPresenter();
      } catch {
        // Keep the current window; user can retry via the affordance.
      } finally {
        loadingOlder.value = false;
      }
    }

    function evictBeyondWindow(): void {
      // Evict from the TOP (oldest) — they are reloadable via cursor.
      presenter.trimToWindow(MAX_MOUNTED_MESSAGES);
      hasOlder.value = true;
    }

    /**
     * Send a message through the coordinator with send-button retry safety.
     * Returns whether THIS send was accepted (a run started or the durable
     * queue took the row) — the composer keys its draft clear on the result,
     * never on shared run state (a stale activeRunId from the previous run
     * must not clear a rejected send's draft).
     */
    async function sendMessage(
      text: string,
      options?: SendOptions
    ): Promise<boolean> {
      const conversationId = workspaceStore.selectedConversationId;
      if (!conversationId || text.trim().length === 0) return false;
      // B07: the originating conversation is fixed BEFORE the first await.
      // Every post-await presenter/status mutation below rechecks it — a
      // delayed IPC success/rejection for A must never touch B's messages,
      // error banner or draft (including A→B→A generation changes: the id
      // check passes on return and durable reload reconciles the view).
      const originConversationId = conversationId;

      // Optimistic user message; history reload replaces it durably.
      const optimisticId = `local-user-${Date.now()}`;
      presenter.appendLocalUserMessage({
        id: optimisticId,
        conversationId,
        role: "user",
        content: text,
        timestamp: new Date().toISOString(),
        messageType: MessageType.MESSAGE,
        metadata: { source: "chat-v2" },
      });
      syncFromPresenter();

      // T8/D5 (audit): the optimistic row is the request's identity holder —
      // a REJECTION removes it so the draft (still in the composer) is not
      // duplicated in the transcript; the error bubble alone remains.
      const clientRequestId = options?.clientRequestId ?? createClientRequestId();
      try {
        const response = await startChatRun({
          conversationId,
          clientRequestId,
          message: text,
          model: options?.model,
          mode: options?.mode,
          toolApprovalMode: options?.toolApprovalMode,
          showReasoning: options?.showReasoning,
          uploadedFiles: options?.attachments,
          generatedImageReferences: options?.generatedImageReferences,
          pastedContents: options?.pastedContents,
          confirmedGeneratedImageBatch: options?.confirmedBatchReferences
            ? { references: [...options.confirmedBatchReferences] }
            : undefined,
          historySelectionIds: options?.historySelectionIds
            ? [...options.historySelectionIds]
            : undefined,
          submissionId: options?.submissionId,
        });
        // B07: only when the selection still owns this send — after a
        // switch, A's durable row renders via subscription/summary when the
        // user returns; touching B's presenter/status here would corrupt it.
        if (workspaceStore.selectedConversationId !== originConversationId) {
          return true;
        }
        activeRunId.value = response.runId;
        runtimeStatus.value = response.status;
        streamStatus.value =
          response.status === "running" ? "streaming" : "idle";
        // A busy-conversation send was accepted into the durable pending
        // queue (main-process delegation): the pending bubble replaces the
        // optimistic row, and the queue drains FIFO at the turn terminal.
        if (
          response.status === "queued" &&
          response.runId.startsWith("pending-")
        ) {
          presenter.removeMessage(optimisticId);
          syncFromPresenter();
        }
        return true;
      } catch (err) {
        // B07: a delayed rejection for A must not mutate B. The draft stays
        // (composer clears only on acceptance) so A's text remains available
        // for retry; B's messages/error/draft are untouched.
        if (workspaceStore.selectedConversationId !== originConversationId) {
          return false;
        }
        // T8/D5: rejected — drop the optimistic row (the draft stays in the
        // composer for retry; keeping both showed the text twice).
        presenter.removeMessage(optimisticId);
        syncFromPresenter();
        const messageText: string =
          err instanceof Error ? err.message : "Failed to start the run";
        // Pre-V2 parity (AiChatBox + AiChatV2.showAssistantError): surface the
        // denial as a visible assistant bubble so an AI-disabled
        // (subscription-required) rejection is not silent. The optimistic user
        // row is kept for retry; the error bubble carries the backend's
        // user-safe message (e.g. hosted-subscription notice).
        presenter.appendLocalUserMessage({
          id: `local-error-${Date.now()}`,
          conversationId,
          role: "assistant",
          content: messageText,
          timestamp: new Date().toISOString(),
          messageType: MessageType.MESSAGE,
          metadata: { source: "chat-v2", error: messageText },
        });
        syncFromPresenter();
        // syncFromPresenter copies the presenter's (null) errorMessage, so
        // re-apply the rejection AFTER the sync or the banner stays silent.
        errorMessage.value = messageText;
        streamStatus.value = "error";
        return false;
      }
    }

    /** Stop the selected active run (composer Send/Stop control). */
    async function stopActiveRun(): Promise<void> {
      const conversationId = workspaceStore.selectedConversationId;
      if (!conversationId) return;
      try {
        await cancelChatRun({ conversationId });
      } catch {
        // Terminal events still arrive via the detail subscription.
      }
    }

    // -------------------------------------------------------------------------
    // Tool permission actions (design §15.5)
    // -------------------------------------------------------------------------

    /**
     * Render a local (non-persisted) user/assistant command exchange
     * (capability-parity FR-CMD-004): slash-command results and command
     * errors surface as transcript rows with the same lifetime contract as
     * Chat V2's `appendLocalCommandExchange` — visible until the next
     * history reload, never persisted, never sent to the model.
     */
    function appendLocalCommandExchange(
      userText: string,
      assistantText: string
    ): void {
      const current = workspaceStore.selectedConversationId;
      if (!current) return;
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timestamp = new Date().toISOString();
      presenter.appendLocalUserMessage({
        id: `local-command-user-${suffix}`,
        conversationId: current,
        role: "user",
        content: userText,
        timestamp,
        messageType: MessageType.MESSAGE,
      });
      presenter.appendLocalUserMessage({
        id: `local-command-assistant-${suffix}`,
        conversationId: current,
        role: "assistant",
        content: assistantText,
        timestamp,
        messageType: MessageType.MESSAGE,
        metadata: { source: "slash-command" },
      });
      syncFromPresenter();
    }

    /**
     * Append the durable user row a queue-drained turn just delivered
     * (message-queue §7): the delegated send's optimistic row was swapped for
     * the pending bubble, and the bubble is removed at delivery — without
     * this append the live transcript would lose the user's message until a
     * re-selection reloads history. The persisted id makes the later history
     * reload dedupe seamlessly.
     */
    function appendDeliveredUserRow(input: {
      readonly id: string;
      readonly content: string;
      readonly timestamp: string;
    }): void {
      const current = workspaceStore.selectedConversationId;
      if (!current) return;
      if (messages.value.some((m) => m.id === input.id)) return; // idempotent
      presenter.appendLocalUserMessage({
        id: input.id,
        conversationId: current,
        role: "user",
        content: input.content,
        timestamp: input.timestamp,
        messageType: MessageType.MESSAGE,
        metadata: { source: "chat-v2" },
      });
      syncFromPresenter();
    }

    /** One in-flight resume per tool id — double clicks are no-ops. */
    const permissionResumeInFlightToolIds = new Set<string>();

    /** Resolve the tool id for a permission message: direct metadata first,
     * then the nearest preceding TOOL_CALL with the same tool name (mirrors
     * the legacy dock's resolution for histories without toolCallId rows). */
    function resolveToolIdForPermission(
      message: ChatV2MessageView
    ): string | undefined {
      const direct = message.metadata?.toolCallId;
      if (typeof direct === "string" && direct.length > 0) {
        return direct;
      }
      const toolName = message.metadata?.toolName;
      if (!toolName) {
        return undefined;
      }
      const idx = messages.value.findIndex((m) => m.id === message.id);
      for (let i = idx - 1; i >= 0; i -= 1) {
        const candidate = messages.value[i];
        if (
          candidate.messageType === MessageType.TOOL_CALL &&
          candidate.metadata?.toolName === toolName &&
          candidate.metadata?.toolCallId
        ) {
          return candidate.metadata.toolCallId;
        }
      }
      return undefined;
    }

    /**
     * Grant a parked tool permission: mark the prompt executing locally,
     * resume the main-process turn, and surface failures on the row (the
     * resumed tool_result event replaces the row on success).
     */
    async function grantToolPermission(
      message: ChatV2MessageView,
      texts: PermissionActionTexts
    ): Promise<void> {
      const toolId = resolveToolIdForPermission(message);
      if (!toolId) {
        errorMessage.value = texts.noToolIdText;
        return;
      }
      if (permissionResumeInFlightToolIds.has(toolId)) return;
      permissionResumeInFlightToolIds.add(toolId);
      // Executing rewrite goes through the presenter so the next presenter
      // mutation cannot clobber it (single source of truth for the window).
      presenter.rewriteMessage(message.id, (m) => {
        const [next] = markPermissionPromptExecuting([m], message.id);
        return next;
      });
      try {
        const raw = await windowInvoke(
          AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION,
          {
            toolId,
            conversationId:
              message.conversationId || workspaceStore.selectedConversationId,
          }
        );
        const res = raw as { ok: boolean; error?: string } | null;
        if (!res?.ok) {
          const errMsg = res?.error || texts.resumeFailedText;
          // T4/D1 (audit): a failed resume RESTORES the prompt — Grant/Deny
          // stay mounted and actionable (FR-PER-007); the safe error rides
          // the row content so it is announced without stealing focus.
          presenter.rewriteMessage(message.id, (m) =>
            restorePermissionPromptAfterFailure([m], message.id, errMsg)[0]
          );
          syncFromPresenter();
          errorMessage.value = errMsg;
        }
      } catch (error) {
        const errMsg =
          error instanceof Error ? error.message : String(error);
        presenter.rewriteMessage(message.id, (m) =>
          restorePermissionPromptAfterFailure([m], message.id, errMsg)[0]
        );
        syncFromPresenter();
        errorMessage.value = errMsg;
      } finally {
        permissionResumeInFlightToolIds.delete(toolId);
      }
    }

    /**
     * Deny a parked tool permission (V2 parity, FR-PER-004/006/007).
     * Routes Deny by the exact tool/conversation through the existing
     * continuation API first: when a scheduled-loop engine owns the paused
     * turn it synthesizes the denial result and the run continues (honor
     * `handled` — never stop an unrelated task). Otherwise falls back to
     * the interactive stop, which settles the parked run to cancelled
     * through the normal terminal path. Ordinary interactive denial keeps
     * its stop fallback; only the scheduled-owner gap is closed here.
     */
    async function denyToolPermission(
      message: ChatV2MessageView,
      texts: PermissionActionTexts
    ): Promise<void> {
      const toolId = resolveToolIdForPermission(message);
      const targetConversationId =
        message.conversationId || workspaceStore.selectedConversationId || undefined;
      if (toolId) {
        try {
          const result = await denyChatV2ToolPermission(
            toolId,
            targetConversationId
          );
          if (result.handled) {
            // Scheduled engine owned the paused turn — it synthesized a
            // denied tool_result and the run continues. Rewrite the row to
            // the denied receipt (the engine's tool_result replaces it on
            // success) and do NOT stop any stream.
            presenter.rewriteMessage(message.id, (m) => ({
              ...m,
              content: texts.deniedText,
              metadata: {
                ...m.metadata,
                source: "chat-v2",
                toolResult: undefined,
                success: false,
              },
            }));
            syncFromPresenter();
            return;
          }
        } catch {
          // IPC denied (e.g. AI gate) or stale tool id — fall through to
          // the interactive stop below, which keeps an actionable card on
          // failure via the grant-style restore path.
        }
      }
      presenter.rewriteMessage(message.id, (m) => ({
        ...m,
        content: texts.deniedText,
        metadata: {
          ...m.metadata,
          source: "chat-v2",
          toolResult: undefined,
          success: false,
        },
      }));
      syncFromPresenter();
      await stopActiveRun();
    }

    function teardown(): void {
      if (detailUnsubscribe) {
        detailUnsubscribe();
        detailUnsubscribe = null;
      }
      unsubscribeDetail();
      presenter.dispose();
      syncFromPresenter();
    }

    /**
     * Seed authoritative goal state from the backend (FR-CMD-006): the
     * run-strip's /loop precondition must survive selection reloads.
     */
    function seedGoal(goal: GoalRunInfo | null): void {
      presenter.setGoal(goal);
      syncFromPresenter();
    }

    /**
     * Subscribe to engine start acknowledgements (FR-HIS-003). Returns an
     * unsubscribe function; the surface cleans up on unmount.
     */
    function onStartAck(
      listener: (chunk: Record<string, unknown>) => void
    ): () => void {
      startAckListeners.add(listener);
      return () => {
        startAckListeners.delete(listener);
      };
    }

    /**
     * Subscribe to LIVE tool results (FR-INT-003) — selected conversation
     * only, never history seeding. Returns an unsubscribe function.
     */
    function onLiveToolResult(
      listener: (chunk: Record<string, unknown>) => void
    ): () => void {
      liveToolResultListeners.add(listener);
      return () => {
        liveToolResultListeners.delete(listener);
      };
    }

    const isBusy = computed(
      () =>
        runtimeStatus.value === "running" ||
        runtimeStatus.value === "queued" ||
        streamStatus.value === "streaming"
    );

    /** Latest scheduled-loop row state derived from message metadata. */
    const scheduledLoop = computed(() => {
      for (let i = messages.value.length - 1; i >= 0; i -= 1) {
        const loop = messages.value[i].metadata?.scheduledLoop;
        if (loop) return loop;
      }
      return null;
    });

    return {
      messages,
      recovery,
      retry,
      goal,
      scheduledLoop,
      activeAssistantMessageId,
      streamStatus,
      errorMessage,
      runtimeStatus,
      activeRunId,
      loading,
      loadError,
      hasOlder,
      loadingOlder,
      selectedTitle,
      loadSelection,
      loadOlder,
      sendMessage,
      appendDeliveredUserRow,
      appendLocalCommandExchange,
      stopActiveRun,
      grantToolPermission,
      denyToolPermission,
      applyDetailEvent,
      onStartAck,
      onLiveToolResult,
      seedGoal,
      markReadAfterLoad,
      teardown,
      isBusy,
      resetPresenter,
    };
  }
);
