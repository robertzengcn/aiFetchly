import { computed, ref } from "vue";

/**
 * R06/C-FR-10: ONE handoff dialog at a time across ALL session cards.
 * The first card whose session enters a handoff-like state CLAIMS the
 * slot and opens its dialog; the others show a "N tasks need you" badge
 * and keep their receipt controls. C04/C-FR-10: releasing the slot
 * PROMOTES the next waiting session immediately (FIFO) — a waiter no
 * longer depends on its own card's next status refresh to notice the
 * freed slot. "Open browser" stays the only focus change (no automatic
 * focus steal, per the PRD).
 */
const claimedBy = ref<string | null>(null);
const waitingQueue = ref<string[]>([]);
/**
 * C04/C-FR-10: promotion listeners — a waiting card registers for its
 * session id so the dialog opens the MOMENT the queue promotes it (no
 * dependence on a status refresh that may never come).
 */
const promotionListeners = new Map<string, Set<(sessionId: string) => void>>();

export function useHandoffDialogQueue() {
  /**
   * C04: register for promotion of THIS session (fires when the queue
   * hands the slot over). Returns the unsubscribe function.
   */
  function onPromoted(
    sessionId: string,
    callback: (sessionId: string) => void
  ): () => void {
    // "*" registers for ANY promotion (a card checks the promoted id
    // against its CURRENT session before opening its dialog).
    const key = sessionId === "*" ? "*" : sessionId;
    let listeners = promotionListeners.get(key);
    if (!listeners) {
      listeners = new Set();
      promotionListeners.set(sessionId, listeners);
    }
    listeners.add(callback);
    return () => {
      listeners?.delete(callback);
      if (listeners && listeners.size === 0) {
        promotionListeners.delete(key);
      }
    };
  }
  /** Try to claim the dialog slot; false when another session holds it. */
  function claim(sessionId: string): boolean {
    if (claimedBy.value === null || claimedBy.value === sessionId) {
      claimedBy.value = sessionId;
      waitingQueue.value = waitingQueue.value.filter(
        (id) => id !== sessionId
      );
      return true;
    }
    if (!waitingQueue.value.includes(sessionId)) {
      waitingQueue.value = [...waitingQueue.value, sessionId];
    }
    return false;
  }

  /** Release the slot (state left handoff / dismissed / session ended). */
  function release(sessionId: string): void {
    if (claimedBy.value === sessionId) {
      claimedBy.value = null;
      // C04/C-FR-10: promote the next waiter NOW and NOTIFY its card —
      // the dialog opens without waiting for a status refresh that may
      // never come.
      const next = waitingQueue.value.shift();
      if (next) {
        claimedBy.value = next;
        for (const listener of promotionListeners.get(next) ?? []) {
          listener(next);
        }
        for (const listener of promotionListeners.get("*") ?? []) {
          listener(next);
        }
      }
    }
    waitingQueue.value = waitingQueue.value.filter((id) => id !== sessionId);
    // A released session's listeners die with its claim attempt.
    promotionListeners.delete(sessionId);
  }

  const waitingCount = computed(() => waitingQueue.value.length);

  return { claim, release, waitingCount, onPromoted };
}

/** Test seam: clear the app-wide queue state between tests. */
export function resetHandoffDialogQueueForTest(): void {
  claimedBy.value = null;
  waitingQueue.value = [];
  promotionListeners.clear();
}
