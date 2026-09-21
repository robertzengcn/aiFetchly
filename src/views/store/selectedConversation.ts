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
import { windowInvoke } from "@/views/utils/apirequest";
import { AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION } from "@/config/channellist";
import { markPermissionPromptExecuting } from "@/views/components/aiChatV2/toolExecutionStateUtil";
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
    const presenter = markRaw(
      createWorkspaceStreamPresenter({
        onMutate: () => syncFromPresenter(),
      })
    );
    // Re-create presenter with options indirection for tests.
    function resetPresenter(options?: StreamPresenterOptions): void {
      const next = createWorkspaceStreamPresenter(options);
      Object.assign(presenter, next);
    }

    const messages = ref<readonly ChatV2MessageView[]>([]);
    const recovery = ref<RecoveryInfo | null>(null);
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

    /** Send a message through the coordinator with send-button retry safety. */
    async function sendMessage(
      text: string,
      options?: SendOptions
    ): Promise<void> {
      const conversationId = workspaceStore.selectedConversationId;
      if (!conversationId || text.trim().length === 0) return;

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

      try {
        const response = await startChatRun({
          conversationId,
          clientRequestId: createClientRequestId(),
          message: text,
          model: options?.model,
          mode: options?.mode,
          toolApprovalMode: options?.toolApprovalMode,
          showReasoning: options?.showReasoning,
          uploadedFiles: options?.attachments,
          generatedImageReferences: options?.generatedImageReferences,
        });
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
      } catch (err) {
        errorMessage.value =
          err instanceof Error ? err.message : "Failed to start the run";
        streamStatus.value = "error";
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
          presenter.rewriteMessage(message.id, (m) => ({
            ...m,
            content: errMsg,
            metadata: {
              ...m.metadata,
              source: "chat-v2",
              toolResult: { error: errMsg, success: false },
              success: false,
              error: errMsg,
            },
          }));
          errorMessage.value = errMsg;
        }
      } catch (error) {
        errorMessage.value =
          error instanceof Error ? error.message : String(error);
      } finally {
        permissionResumeInFlightToolIds.delete(toolId);
      }
    }

    /**
     * Deny a parked tool permission: rewrite the row to a denied receipt
     * locally, then stop the parked run so the durable state settles to
     * cancelled through the normal terminal path.
     */
    function denyToolPermission(
      message: ChatV2MessageView,
      texts: PermissionActionTexts
    ): void {
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
      void stopActiveRun();
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
      stopActiveRun,
      grantToolPermission,
      denyToolPermission,
      applyDetailEvent,
      markReadAfterLoad,
      teardown,
      isBusy,
      resetPresenter,
    };
  }
);
