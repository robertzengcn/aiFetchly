import { watch } from "vue";

/**
 * Conversation-bound overlay ownership (G01, AD-008).
 *
 * Dialogs that can outlive one transcript row or hold security-sensitive
 * state mount in the shared overlay host below the workspace shell. Every
 * overlay descriptor carries its owning conversation (or null for genuinely
 * global overlays); a selection change closes conversation-bound overlays
 * whose owner is no longer selected, so a dialog can never describe —
 * or submit into — a conversation the user navigated away from.
 *
 * Both surfaces (workspace center today, Chat V2 as it migrates) register
 * here instead of scattering one `watch(selectedId)` reset per dialog,
 * which is how resets drifted out of sync. Reset failures are isolated so
 * one broken closer cannot keep its siblings open.
 */

export interface ScopedOverlayDescriptor {
  readonly id: string;
  /**
   * Owning conversation at open time. Null marks a genuinely global
   * overlay (e.g. app settings) that survives selection changes.
   */
  readonly conversationId: string | null;
  readonly close: () => void;
}

/** Internal marker for selection-bound dialogs (closed on every change). */
const SELECTION_BOUND = Symbol("selection-bound");

type StoredOverlay =
  | ScopedOverlayDescriptor
  | { readonly id: string; readonly bound: typeof SELECTION_BOUND; readonly close: () => void };

function isSelectionBound(
  overlay: StoredOverlay
): overlay is Extract<StoredOverlay, { bound: typeof SELECTION_BOUND }> {
  return (overlay as { bound?: unknown }).bound === SELECTION_BOUND;
}

export function useConversationScopedOverlays(
  getSelectionId: () => string | null
): {
  /** Register (or replace) an overlay; returns an unregister function. */
  readonly registerOverlay: (overlay: ScopedOverlayDescriptor) => () => void;
  /**
   * Register a selection-bound dialog (report/image/approval dialogs that
   * always describe the current chat): its closer runs on EVERY selection
   * change. Unlike owned overlays this registration PERSISTS (standing
   * reset rule) so dialogs reopened under a later chat are still cleaned
   * up on the next switch.
   */
  readonly registerSelectionBoundOverlay: (
    id: string,
    close: () => void
  ) => () => void;
  /**
   * Close + drop every OWNED overlay matching the predicate (selection-
   * bound standing rules are unaffected); returns closed ids.
   */
  readonly closeOverlays: (
    predicate?: (overlay: ScopedOverlayDescriptor) => boolean
  ) => string[];
  readonly openCount: () => number;
} {
  const overlays = new Map<string, StoredOverlay>();

  function registerOverlay(overlay: ScopedOverlayDescriptor): () => void {
    overlays.set(overlay.id, overlay);
    return () => {
      if (overlays.get(overlay.id) === overlay) {
        overlays.delete(overlay.id);
      }
    };
  }

  function registerSelectionBoundOverlay(
    id: string,
    close: () => void
  ): () => void {
    const overlay = { id, bound: SELECTION_BOUND, close } as const;
    overlays.set(id, overlay);
    return () => {
      if (overlays.get(id) === overlay) {
        overlays.delete(id);
      }
    };
  }

  function closeOverlays(
    predicate: (overlay: ScopedOverlayDescriptor) => boolean = () => true
  ): string[] {
    const closed: string[] = [];
    for (const [id, overlay] of [...overlays]) {
      if (isSelectionBound(overlay)) continue;
      if (!predicate(overlay)) continue;
      try {
        overlay.close();
      } catch {
        // One broken closer must not keep its siblings open.
      }
      if (overlays.get(id) === overlay) {
        overlays.delete(id);
      }
      closed.push(id);
    }
    return closed;
  }

  watch(getSelectionId, () => {
    for (const [id, overlay] of [...overlays]) {
      if (isSelectionBound(overlay)) {
        // Standing rule: run on every change, registration persists.
        try {
          overlay.close();
        } catch {
          // Isolated per closer.
        }
        continue;
      }
      if (
        overlay.conversationId !== null &&
        overlay.conversationId !== getSelectionId()
      ) {
        try {
          overlay.close();
        } catch {
          // Isolated per closer.
        }
        if (overlays.get(id) === overlay) {
          overlays.delete(id);
        }
      }
    }
  });

  return {
    registerOverlay,
    registerSelectionBoundOverlay,
    closeOverlays,
    openCount: () => overlays.size,
  };
}
