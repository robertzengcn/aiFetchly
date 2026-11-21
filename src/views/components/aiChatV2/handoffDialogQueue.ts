import { computed, ref } from "vue";

/**
 * R06/C-FR-10: ONE handoff dialog at a time across ALL session cards.
 * The first card whose session enters a handoff-like state CLAIMS the
 * slot and opens its dialog; the others show a "N tasks need you" badge
 * and keep their receipt controls. The claim releases when the session
 * leaves the handoff-like states or the user dismisses — a waiting card
 * then claims on its next status refresh. "Open browser" stays the only
 * focus change (no automatic focus steal, per the PRD).
 */
const claimedBy = ref<string | null>(null);
const waiting = ref<Set<string>>(new Set());

export function useHandoffDialogQueue() {
  /** Try to claim the dialog slot; false when another session holds it. */
  function claim(sessionId: string): boolean {
    if (claimedBy.value === null || claimedBy.value === sessionId) {
      claimedBy.value = sessionId;
      waiting.value.delete(sessionId);
      return true;
    }
    waiting.value.add(sessionId);
    return false;
  }

  /** Release the slot (state left handoff / dismissed / session ended). */
  function release(sessionId: string): void {
    if (claimedBy.value === sessionId) {
      claimedBy.value = null;
    }
    waiting.value.delete(sessionId);
  }

  const waitingCount = computed(() => waiting.value.size);

  return { claim, release, waitingCount };
}

/** Test seam: clear the app-wide queue state between tests. */
export function resetHandoffDialogQueueForTest(): void {
  claimedBy.value = null;
  waiting.value.clear();
}
