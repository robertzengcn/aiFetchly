import { computed, markRaw, ref } from "vue";
import { defineStore } from "pinia";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import type { ChatRunDetailEvent } from "@/entityTypes/aiChatWorkspaceTypes";
import {
  createWorkspaceStreamPresenter,
  type StreamPresenterOptions,
  type WorkspaceStreamStatus,
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
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";

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

    const presenter = markRaw(createWorkspaceStreamPresenter());
    // Re-create presenter with options indirection for tests.
    function resetPresenter(options?: StreamPresenterOptions): void {
      const next = createWorkspaceStreamPresenter(options);
      Object.assign(presenter, next);
    }

    const messages = ref<readonly ChatV2MessageView[]>([]);
    const activeAssistantMessageId = ref<string | null>(null);
    const streamStatus = ref<WorkspaceStreamStatus>("idle");
    const errorMessage = ref<string | null>(null);
    const runtimeStatus = ref("idle");
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
      syncFromPresenter();
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

      ensureDetailSubscription();
      try {
        const snapshot = await selectConversation(conversationId, generation);
        // Apply only if this handshake is still the latest selection.
        if (appliedGeneration !== generation) return;
        if (snapshot.acceptedGeneration === -1) return;
        presenter.seedHistory([...snapshot.messages]);
        nextBeforeCursor = snapshot.nextBefore;
        hasOlder.value = snapshot.hasOlder;
        runtimeStatus.value = snapshot.runtimeStatus;
        activeRunId.value = snapshot.activeRunId;
        selectedTitle.value = snapshot.title;
        syncFromPresenter();
        await markReadAfterLoad(conversationId);
      } catch (err) {
        if (appliedGeneration === generation) {
          loadError.value =
            err instanceof Error ? err.message : "Failed to load conversation";
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
      presenter.appendLocalUserMessage({
        id: `local-user-${Date.now()}`,
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
        });
        activeRunId.value = response.runId;
        runtimeStatus.value = response.status;
        streamStatus.value =
          response.status === "running" ? "streaming" : "idle";
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

    return {
      messages,
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
      stopActiveRun,
      applyDetailEvent,
      markReadAfterLoad,
      teardown,
      isBusy,
      resetPresenter,
    };
  }
);
