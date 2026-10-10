import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type {
  AppInspectorKind,
  AppInspectorTarget,
} from "@/views/types/uiConvergenceTypes";

/**
 * Typed inspector state (design §9.2–§9.5): discriminated targets with
 * validated identifiers only — never component instances, HTML, callbacks,
 * or full domain records. Stale responses are rejected through a
 * monotonically increasing request generation.
 */
export const useAppInspectorStore = defineStore("appInspector", () => {
  const target = ref<AppInspectorTarget | null>(null);
  const requestGeneration = ref(0);
  /** DOM element id to refocus on close (design §9.5) — never a ref. */
  const focusOriginId = ref<string | null>(null);

  const kind = computed<AppInspectorKind | null>(() => target.value?.kind ?? null);

  function open(
    next: AppInspectorTarget,
    options?: { focusOriginId?: string }
  ): void {
    target.value = next;
    focusOriginId.value = options?.focusOriginId ?? null;
    requestGeneration.value += 1;
  }

  function close(): void {
    target.value = null;
    focusOriginId.value = null;
    requestGeneration.value += 1; // invalidate in-flight inspector loads
  }

  /**
   * Route-change behavior (design §9.4): same owner keeps the selection,
   * a different owner closes and clears.
   */
  function onRouteChanged(ownerRoute: string): void {
    if (target.value && target.value.ownerRoute !== ownerRoute) {
      close();
    }
  }

  /** Begin an inspector load; returns the generation to compare on reply. */
  function beginRequest(): number {
    requestGeneration.value += 1;
    return requestGeneration.value;
  }

  /** True while `generation` is still the latest request. */
  function isCurrent(generation: number): boolean {
    return generation === requestGeneration.value;
  }

  return {
    target,
    kind,
    requestGeneration,
    focusOriginId,
    open,
    close,
    onRouteChanged,
    beginRequest,
    isCurrent,
  };
});
