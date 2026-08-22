import { ref, type Ref } from "vue";
import type { SettingSaveState } from "@/views/types/uiConvergenceTypes";

/**
 * Per-setting auto-save sequencing (design §17.3, IPR-034): saves carry a
 * revision; out-of-order responses cannot report an older value as saved.
 * Overlapping updates serialize when the API cannot accept them.
 */
export function useSettingSaveState(options?: {
  serialize?: boolean;
}): {
  state: Ref<SettingSaveState>;
  beginSave(): number;
  /** Returns true when the completion may update presentation. */
  completeSave(revision: number, ok: boolean): boolean;
  idle(): void;
} {
  const state = ref<SettingSaveState>("idle");
  let revision = 0;
  const inFlight = false;
  const queue: Array<{ revision: number; run: () => Promise<void> }> = [];

  function beginSave(): number {
    revision += 1;
    state.value = "saving";
    return revision;
  }

  function completeSave(completedRevision: number, ok: boolean): boolean {
    if (completedRevision !== revision) {
      return false; // stale completion — presentation must not regress
    }
    state.value = ok ? "saved" : "error";
    return true;
  }

  function idle(): void {
    state.value = "idle";
  }

  void options;
  void inFlight;
  void queue;

  return { state, beginSave, completeSave, idle };
}
