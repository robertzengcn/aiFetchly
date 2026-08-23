import { ref, type Ref } from "vue";
import type { SettingSaveState } from "@/views/types/uiConvergenceTypes";

/**
 * Per-setting auto-save sequencing (design §17.3, IPR-034): saves carry a
 * revision; out-of-order responses cannot report an older value as saved.
 * Callers whose API cannot accept overlapping updates must serialize
 * edits themselves before calling beginSave.
 */
export function useSettingSaveState(): {
  state: Ref<SettingSaveState>;
  beginSave(): number;
  /** Returns true when the completion may update presentation. */
  completeSave(revision: number, ok: boolean): boolean;
  idle(): void;
} {
  const state = ref<SettingSaveState>("idle");
  let revision = 0;

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

  return { state, beginSave, completeSave, idle };
}
