import { ref } from "vue";
import { defineStore } from "pinia";
import type {
  AIChatPendingMessageEvent,
  AIChatPendingMessageView,
} from "@/entityTypes/aiChatV2Types";
import {
  listChatV2PendingMessages,
  subscribeChatV2PendingEvents,
} from "@/views/api/aiChatV2";

/**
 * Pending (queued) message rows for the chat-first shell (message-queue PRD
 * §7 rendered surface). The legacy dock kept these inside AiChatV2.vue's
 * per-conversation runtime map; the shell needs the same bubbles in its
 * transcript, so the durable queue's rows live in this app-scoped store:
 * seeded per conversation via the list IPC and kept fresh by the lifecycle
 * event subscription (a refresh hint — the list IPC reconstructs truth).
 */
export const usePendingMessagesStore = defineStore("pendingMessages", () => {
  const byConversation = ref<Map<string, readonly AIChatPendingMessageView[]>>(
    new Map()
  );

  let subscribed = false;
  let unsubscribe: (() => void) | null = null;

  /**
   * Event-vs-snapshot reconciliation bookkeeping: a slow list response must
   * never overwrite lifecycle events that arrived while it was in flight
   * (erasing a just-queued row, or resurrecting a just-removed one). Both
   * maps record the sequence of the LAST event that touched a row.
   */
  let eventSeq = 0;
  const lastUpsertSeq = new Map<string, number>();
  const lastRemovalSeq = new Map<string, number>();

  function ensureSubscription(): void {
    if (subscribed) return;
    subscribed = true;
    unsubscribe = subscribeChatV2PendingEvents((event) => {
      applyEvent(event);
    });
  }

  function rowsFor(
    conversationId: string | null
  ): readonly AIChatPendingMessageView[] {
    if (!conversationId) return [];
    return byConversation.value.get(conversationId) ?? [];
  }

  /** Seed the durable queue's current rows for one conversation. */
  async function loadConversation(
    conversationId: string | null
  ): Promise<void> {
    ensureSubscription();
    if (!conversationId) return;
    const requestSeq = eventSeq;
    try {
      const rows = await listChatV2PendingMessages(conversationId);
      // The IPC list deliberately includes terminal rows (audit trail);
      // only live queue states render as bubbles — committing terminal rows
      // would resurrect sent/cancelled/applied bubbles on every
      // re-selection. Lifecycle events already remove them at transition.
      const live = (rows ?? []).filter(
        (row) =>
          row.status !== "sent" &&
          row.status !== "cancelled" &&
          row.status !== "applied"
      );
      // Overlay events received DURING the request: rows those events
      // removed stay removed; rows they added/updated keep their newer
      // state. The snapshot only contributes rows no event has superseded.
      const current = byConversation.value.get(conversationId) ?? [];
      const currentIds = new Set(current.map((row) => row.pendingMessageId));
      const snapshotRows = live.filter((row) => {
        if (currentIds.has(row.pendingMessageId)) return false;
        return (lastRemovalSeq.get(row.pendingMessageId) ?? 0) <= requestSeq;
      });
      const merged = [...snapshotRows, ...current].sort(
        (a, b) => a.sequence - b.sequence
      );
      commit(conversationId, merged);
    } catch {
      // Non-fatal: lifecycle events still upsert; next load retries.
    }
  }

  function upsert(view: AIChatPendingMessageView): void {
    const current = [...(byConversation.value.get(view.conversationId) ?? [])];
    const exists = current.some(
      (entry) => entry.pendingMessageId === view.pendingMessageId
    );
    const next = exists
      ? current.map((entry) =>
          entry.pendingMessageId === view.pendingMessageId ? view : entry
        )
      : [...current, view];
    commit(view.conversationId, next);
  }

  function remove(conversationId: string, pendingMessageId: string): void {
    commit(
      conversationId,
      (byConversation.value.get(conversationId) ?? []).filter(
        (entry) => entry.pendingMessageId !== pendingMessageId
      )
    );
  }

  function applyEvent(event: AIChatPendingMessageEvent): void {
    eventSeq += 1;
    if (event.pendingMessage) {
      upsert(event.pendingMessage);
      lastUpsertSeq.set(event.pendingMessageId, eventSeq);
    }
    if (
      event.status === "sent" ||
      event.status === "cancelled" ||
      event.status === "applied"
    ) {
      remove(event.conversationId, event.pendingMessageId);
      lastRemovalSeq.set(event.pendingMessageId, eventSeq);
    }
  }

  /** Immutable map copy; empty lists delete so the store stays bounded. */
  function commit(
    conversationId: string,
    rows: readonly AIChatPendingMessageView[]
  ): void {
    const next = new Map(byConversation.value);
    if (rows.length === 0) {
      next.delete(conversationId);
    } else {
      next.set(conversationId, rows);
    }
    byConversation.value = next;
  }

  function teardown(): void {
    unsubscribe?.();
    unsubscribe = null;
    subscribed = false;
    byConversation.value = new Map();
    eventSeq = 0;
    lastUpsertSeq.clear();
    lastRemovalSeq.clear();
  }

  return {
    byConversation,
    rowsFor,
    loadConversation,
    upsert,
    remove,
    applyEvent,
    teardown,
  };
});
