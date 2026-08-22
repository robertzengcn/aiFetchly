import { ref } from "vue";
import { defineStore } from "pinia";

/** Shell layout mode from measured available width (design §10.1). */
export type AppShellMode = "wide" | "medium" | "narrow";

/**
 * Shell-only state (design §9.1): layout mode, navigation visibility, and
 * inspector geometry. Never feature collections, forms, or domain records.
 */
export const useAppShellStore = defineStore("appShell", () => {
  const mode = ref<AppShellMode>("wide");
  const navigationOpen = ref(true);
  const navigationCollapsed = ref(false);
  const inspectorOpen = ref(false);
  const inspectorWidth = ref(420);

  /** Threshold selection from measured available width (design §10.1). */
  function setModeFromWidth(availableWidth: number): AppShellMode {
    const next: AppShellMode =
      availableWidth >= 1280
        ? "wide"
        : availableWidth >= 900
          ? "medium"
          : "narrow";
    mode.value = next;
    if (next === "narrow") {
      navigationOpen.value = false; // drawer is opt-in on narrow
    }
    return next;
  }

  function toggleNavigation(): void {
    navigationOpen.value = !navigationOpen.value;
  }

  function setInspectorOpen(open: boolean): void {
    inspectorOpen.value = open;
  }

  /** Wide-mode width clamp; overlay modes derive from the container. */
  function setInspectorWidth(width: number): void {
    inspectorWidth.value = Math.min(720, Math.max(320, Math.round(width)));
  }

  return {
    mode,
    navigationOpen,
    navigationCollapsed,
    inspectorOpen,
    inspectorWidth,
    setModeFromWidth,
    toggleNavigation,
    setInspectorOpen,
    setInspectorWidth,
  };
});
