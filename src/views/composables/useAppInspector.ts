import { computed } from "vue";
import { useAppInspectorStore } from "@/views/store/appInspector";
import type { AppInspectorTarget } from "@/views/types/uiConvergenceTypes";

/**
 * Typed inspector composable (design §9, §27.3 file map).
 * Thin wrapper over the appInspector Pinia store exposing the
 * open/close/focus API expected by feature pages.
 */
export function useAppInspector() {
  const store = useAppInspectorStore();

  const target = computed(() => store.target);
  const kind = computed(() => store.kind);
  const isOpen = computed(() => store.target !== null);

  function open(
    next: AppInspectorTarget,
    options?: { focusOriginId?: string }
  ): void {
    store.open(next, options);
  }

  function close(): void {
    store.close();
  }

  /** Clear selection on route change (design §9.4). */
  function onRouteChanged(ownerRoute: string): void {
    store.onRouteChanged(ownerRoute);
  }

  return {
    target,
    kind,
    isOpen,
    open,
    close,
    onRouteChanged,
    /** Raw store for advanced use (request generation checks). */
    store,
  };
}
