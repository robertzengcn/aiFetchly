import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * Structural slice of AiChatSelectedContext's SelectedContextItem (the .vue
 * module cannot be imported under the main-process tsconfig). Only the
 * opaque sourceId is trusted across the boundary; preview/tokens are
 * display-only.
 */
export interface HistorySelectedContextItem {
  readonly sourceId: string;
  readonly preview: string;
  readonly estimatedTokens: number;
  readonly refreshed?: boolean;
  readonly rejected?: boolean;
}

/**
 * Conversation-keyed history-selection drafts + stable submission identities
 * (B14, FR-HIS-002–004, AD-005).
 *
 * The history `submissionId` is a per-logical-draft identity: minted on the
 * first send that carries chips, retained across selection switches and
 * route remounts, and resolved only by the engine start acknowledgement
 * (accepted/mixed) — never by switching conversations. Restored chips
 * therefore retry with the SAME submission identity instead of acquiring a
 * new one per switch. Intentional chip changes rotate a pending identity so
 * a changed payload never reuses an old one.
 *
 * This is the history-resolution identity only; the pending queue's
 * `clientRequestId` is tracked separately in the selected-conversation
 * store. Both are retained per conversation until acceptance resolves them.
 */

/** Bound the map so abandoned conversations cannot grow it without limit. */
const HISTORY_DRAFT_CAP = 50;

interface HistorySelectionDraft {
  items: HistorySelectedContextItem[];
  submissionId: string | null;
}

function newDraftId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `hist-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

export const useHistorySelectionStore = defineStore("historySelection", () => {
  const drafts = ref(new Map<string, HistorySelectionDraft>());

  function read(conversationId: string): HistorySelectionDraft {
    const existing = drafts.value.get(conversationId);
    if (existing) return existing;
    return { items: [], submissionId: null };
  }

  function touch(conversationId: string): void {
    if (!drafts.value.has(conversationId) && drafts.value.size >= HISTORY_DRAFT_CAP) {
      const oldest = drafts.value.keys().next().value;
      if (oldest !== undefined) drafts.value.delete(oldest);
    }
  }

  /** Chips for a conversation (restored on return / remount). */
  function getItems(conversationId: string): HistorySelectedContextItem[] {
    return [...(drafts.value.get(conversationId)?.items ?? [])];
  }

  /**
   * Replace a conversation's chips. An intentional chip change rotates a
   * pending (unacknowledged) submission identity — the next send mints a
   * fresh one for the changed payload.
   */
  function setItems(conversationId: string, items: HistorySelectedContextItem[]): void {
    touch(conversationId);
    const prev = drafts.value.get(conversationId);
    const changed =
      !prev ||
      prev.items.length !== items.length ||
      prev.items.some((item, index) => item.sourceId !== items[index]?.sourceId);
    drafts.value.set(conversationId, {
      items: [...items],
      submissionId: changed ? null : (prev?.submissionId ?? null),
    });
  }

  /**
   * Stable submission identity for the next send: reused across transport
   * retries and selection round-trips; minted once per logical draft.
   */
  function ensureSubmissionId(conversationId: string): string {
    touch(conversationId);
    const prev = drafts.value.get(conversationId);
    if (prev?.submissionId) return prev.submissionId;
    const submissionId = newDraftId();
    drafts.value.set(conversationId, {
      items: prev ? [...prev.items] : [],
      submissionId,
    });
    return submissionId;
  }

  function peekSubmissionId(conversationId: string): string | null {
    return drafts.value.get(conversationId)?.submissionId ?? null;
  }

  /** Start-ack acceptance (accepted/mixed) resolves the identity. */
  function resolveSubmission(conversationId: string): void {
    const prev = drafts.value.get(conversationId);
    if (!prev || !prev.submissionId) return;
    drafts.value.set(conversationId, { items: [...prev.items], submissionId: null });
  }

  /** Test seam: reset all drafts. */
  function clearAll(): void {
    drafts.value.clear();
  }

  return {
    getItems,
    setItems,
    ensureSubmissionId,
    peekSubmissionId,
    resolveSubmission,
    clearAll,
  };
});
