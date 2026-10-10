import { ref } from "vue";
import { defineStore } from "pinia";
import type { ChatV2GeneratedImageReference } from "@/entityTypes/aiChatV2Types";
import type { ChatV2PastedBlockKind } from "@/entityTypes/pastedTextTypes";

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

  function clearDraft(key: string): void {
    commit(key, EMPTY_DRAFT);
  }

  return {
    drafts,
    getDraft,
    updateComposerState,
    setGeneratedImageReferences,
    clearDraft,
  };
});
