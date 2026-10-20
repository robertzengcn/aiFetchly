import { ref, watch } from "vue";
import { defineStore } from "pinia";
import type { ChatV2GeneratedImageReference } from "@/entityTypes/aiChatV2Types";
import type { ChatV2PastedBlockKind } from "@/entityTypes/pastedTextTypes";
import { useSelectedConversationStore } from "@/views/store/selectedConversation";

/**
 * Bounded per-conversation composer drafts (FR-COMP-011 / acceptance
 * criterion 21).
 *
 * Route changes destroy the route-mounted chat center (AppCenterRouteHost),
 * so unsent draft state — typed text, selected files, pasted-text blocks, and
 * generated-image edit references — must live OUTSIDE the component tree.
 * This app-scoped store is that durable renderer boundary: an inner-page
 * round trip or a conversation switch restores the draft, and entries clear
 * only through the accepted-send rule (or explicit user action).
 */

/** Draft key while the composer edits a not-yet-created conversation. */
export const COMPOSER_DRAFT_PENDING_KEY = "__pending_conversation__";

/** Bounded memory: drafts for at most this many conversations are kept. */
export const COMPOSER_DRAFT_CAP = 50;

/** Identity-level equality of two generated-image references. */
export function sameGeneratedImageRef(
  a: ChatV2GeneratedImageReference,
  b: ChatV2GeneratedImageReference
): boolean {
  return a.messageId === b.messageId && a.imageIndex === b.imageIndex;
}

export interface ComposerPastedChipDraft {
  readonly id: number;
  readonly lineCount: number;
  readonly kind: ChatV2PastedBlockKind;
}

export interface ComposerDraftState {
  readonly text: string;
  readonly files: readonly File[];
  readonly pastedContents: Readonly<Record<string, string>>;
  readonly pastedChips: readonly ComposerPastedChipDraft[];
  readonly generatedImageReferences: readonly ChatV2GeneratedImageReference[];
}

const EMPTY_DRAFT: ComposerDraftState = {
  text: "",
  files: [],
  pastedContents: {},
  pastedChips: [],
  generatedImageReferences: [],
};

/** Stable draft key for a selected conversation (null → pending chat). */
export function composerDraftKeyFor(conversationId: string | null): string {
  return conversationId ?? COMPOSER_DRAFT_PENDING_KEY;
}

function isEmptyDraft(state: ComposerDraftState): boolean {
  return (
    state.text.trim().length === 0 &&
    state.files.length === 0 &&
    Object.keys(state.pastedContents).length === 0 &&
    state.pastedChips.length === 0 &&
    state.generatedImageReferences.length === 0
  );
}

export const useComposerDraftStore = defineStore("composerDrafts", () => {
  const drafts = ref<Map<string, ComposerDraftState>>(new Map());

  function getDraft(key: string): ComposerDraftState | null {
    return drafts.value.get(key) ?? null;
  }

  /** Immutable map update; empty states delete so the store stays bounded. */
  function commit(key: string, state: ComposerDraftState): void {
    const next = new Map(drafts.value);
    if (isEmptyDraft(state)) {
      next.delete(key);
    } else {
      if (!next.has(key) && next.size >= COMPOSER_DRAFT_CAP) {
        const oldest = next.keys().next().value;
        if (oldest !== undefined) next.delete(oldest);
      }
      next.set(key, state);
    }
    drafts.value = next;
  }

  /**
   * Replace the composer-owned slice (text/files/pasted) for one key,
   * preserving the generated-image references of the same conversation.
   */
  function updateComposerState(
    key: string,
    text: string,
    files: readonly File[],
    pastedContents: Readonly<Record<string, string>>,
    pastedChips: readonly ComposerPastedChipDraft[]
  ): void {
    const prev = getDraft(key) ?? EMPTY_DRAFT;
    commit(key, {
      ...prev,
      text,
      files: [...files],
      pastedContents: { ...pastedContents },
      pastedChips: [...pastedChips],
    });
  }

  /** Replace the generated-image reference tray for one conversation. */
  function setGeneratedImageReferences(
    key: string,
    references: readonly ChatV2GeneratedImageReference[]
  ): void {
    const prev = getDraft(key) ?? EMPTY_DRAFT;
    commit(key, {
      ...prev,
      generatedImageReferences: [...references],
    });
  }

  /**
   * Accepted image submissions awaiting their run's completion (audit R2
   * N04 / FR-IMG-002/015): app-scoped so the registry survives route
   * remounts — the previous component-local Map destroyed the registered
   * snapshot while this store (and the composer draft it clears) survived,
   * losing both the cleanup and its durable identity. Entries carry the
   * accepted send's ledger ordinal; consumption is driven by the
   * selected-conversation store's durable run resolutions
   * (`lastResolvedReferenceRun`), never by independent counters.
   */
  interface PendingReferenceClear {
    readonly runOrdinal: number;
    readonly references: readonly ChatV2GeneratedImageReference[];
  }
  const referenceClearsByDraftKey = ref<Map<string, PendingReferenceClear[]>>(
    new Map()
  );

  function storeReferenceClear(
    key: string,
    entry: PendingReferenceClear
  ): void {
    const next = new Map(referenceClearsByDraftKey.value);
    next.set(key, [...(next.get(key) ?? []), entry]);
    referenceClearsByDraftKey.value = next;
  }

  /** Remove (and return) the entry registered with this ledger ordinal. */
  function consumeReferenceClear(
    key: string,
    runOrdinal: number
  ): PendingReferenceClear | null {
    const queue = referenceClearsByDraftKey.value.get(key);
    if (!queue) return null;
    const index = queue.findIndex((entry) => entry.runOrdinal === runOrdinal);
    if (index < 0) return null;
    const consumed = queue[index];
    const next = new Map(referenceClearsByDraftKey.value);
    const remaining = queue.filter((_, i) => i !== index);
    if (remaining.length === 0) next.delete(key);
    else next.set(key, remaining);
    referenceClearsByDraftKey.value = next;
    return consumed;
  }

  function clearReferenceClears(key: string): void {
    if (!referenceClearsByDraftKey.value.has(key)) return;
    const next = new Map(referenceClearsByDraftKey.value);
    next.delete(key);
    referenceClearsByDraftKey.value = next;
  }

  function clearDraft(key: string): void {
    commit(key, EMPTY_DRAFT);
  }

  /**
   * Audit R04: the run-resolution consumer is APP-SCOPED, not surface-scoped.
   * It previously lived in the mounted chat center, so a run settling while
   * no surface instance was mounted (route round trip) left its queued
   * reference-clear armed forever and remounting restored the stale tray.
   * This store is created once per pinia (app lifetime); a watcher inside
   * this setup runs for the app and consumes every resolution the moment it
   * is published, mounted or not.
   */
  const selectedStore = useSelectedConversationStore();
  watch(
    () => selectedStore.lastResolvedReferenceRun,
    (resolution) => {
      if (!resolution) return;
      const draftKey = composerDraftKeyFor(resolution.conversationId);
      const submitted = consumeReferenceClear(draftKey, resolution.ordinal);
      if (!submitted || resolution.kind !== "complete") return;
      // Remove the EXACT snapshotted references from the stored draft so
      // references added after the submission survive (legacy retry parity:
      // error/cancelled resolutions dequeue but keep the tray).
      const current = getDraft(draftKey)?.generatedImageReferences ?? [];
      if (current.length === 0) return;
      setGeneratedImageReferences(
        draftKey,
        current.filter(
          (reference) =>
            !submitted.references.some((sent) =>
              sameGeneratedImageRef(reference, sent)
            )
        )
      );
    }
  );

  return {
    drafts,
    getDraft,
    updateComposerState,
    setGeneratedImageReferences,
    clearDraft,
    storeReferenceClear,
    consumeReferenceClear,
    clearReferenceClears,
  };
});
