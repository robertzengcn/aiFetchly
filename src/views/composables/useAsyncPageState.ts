import { ref, type Ref } from "vue";
import type { PageLoadState } from "@/views/types/uiConvergenceTypes";

/**
 * Safe load state with stale-response rejection (design §12.3): every load
 * bumps a generation; only the newest response may apply.
 */
export function useAsyncPageState(): {
  loadState: Ref<PageLoadState>;
  beginLoad(): number;
  isCurrent(generation: number): boolean;
  applyReady(): void;
  applyEmpty(kind: "first-use" | "no-results"): void;
  applyError(recoverable: boolean): void;
  applyForbidden(): void;
} {
  const loadState = ref<PageLoadState>({ state: "loading" });
  let generation = 0;

  function beginLoad(): number {
    generation += 1;
    loadState.value = { state: "loading" };
    return generation;
  }

  function isCurrent(candidate: number): boolean {
    return candidate === generation;
  }

  return {
    loadState,
    beginLoad,
    isCurrent,
    applyReady(): void {
      loadState.value = { state: "ready" };
    },
    applyEmpty(kind: "first-use" | "no-results"): void {
      loadState.value = { state: "empty", kind };
    },
    applyError(recoverable: boolean): void {
      loadState.value = {
        state: "error",
        messageKey: "ui.state.errorBody",
        recoverable,
      };
    },
    applyForbidden(): void {
      loadState.value = { state: "forbidden", capabilityKey: "ui.state.forbiddenBody" };
    },
  };
}
