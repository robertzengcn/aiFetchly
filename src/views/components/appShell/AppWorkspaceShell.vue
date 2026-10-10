<template>
  <!--
    One persistent authenticated three-region shell (design §5, IPR-001/002).
    Left: the workspace sidebar from the parent redesign. Center: the center
    route host. Right: the shared typed inspector host. Route changes swap
    the center surface only — never the shell.
  -->
  <div ref="shellRoot" class="app-workspace-shell" :data-shell-mode="shell.mode">
    <!-- Narrow: the sidebar is an opt-in drawer (IPR-045). -->
    <div
      v-if="shell.mode === 'narrow' && shell.navigationOpen"
      class="app-shell-backdrop"
      data-testid="app-shell-nav-backdrop"
      @click="shell.toggleNavigation()"
    />
    <aside
      v-if="shell.mode !== 'narrow' || shell.navigationOpen"
      ref="navigationRegion"
      class="app-shell-left"
      data-testid="app-shell-navigation"
      @keydown="onNavigationKeydown"
    >
      <slot name="navigation" />
    </aside>

    <main class="app-shell-center" data-testid="app-center-route">
      <slot />
    </main>

    <AppInspectorHost />
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useAppShellStore } from "@/views/store/appShell";
import { useResponsiveShell } from "@/views/composables/useResponsiveShell";
import AppInspectorHost from "./AppInspectorHost.vue";

const shell = useAppShellStore();
const shellRoot = ref<HTMLElement | null>(null);
const navigationRegion = ref<HTMLElement | null>(null);

// Measure the shell's own box — the application workspace, not the screen.
useResponsiveShell(() => shellRoot.value);

// ---------------------------------------------------------------------------
// Narrow drawer focus management (design §13): the navigation overlay traps
// Tab focus while open and restores focus to the opening control on close.
// ---------------------------------------------------------------------------
let focusOrigin: HTMLElement | null = null;

function focusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  // The drawer region only renders visible content while open, so the
  // selector alone defines the focus cycle (offsetParent is unusable in
  // non-layout environments like happy-dom).
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      [
        "button:not([disabled])",
        "[href]",
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
      ].join(", ")
    )
  );
}

const drawerOpen = () => shell.mode === "narrow" && shell.navigationOpen;
watch(
  () => shell.mode === "narrow" && shell.navigationOpen,
  (open) => {
    if (open) {
      // Remember the opening control; <body> carries nothing to restore.
      const active = document.activeElement;
      focusOrigin =
        active instanceof HTMLElement && active !== document.body
          ? active
          : null;
      void nextTick(() => {
        focusableElements(navigationRegion.value)[0]?.focus();
      });
    } else if (focusOrigin) {
      focusOrigin.focus();
      focusOrigin = null;
    }
  }
);

function onNavigationKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && drawerOpen()) {
    event.preventDefault();
    shell.toggleNavigation();
    return;
  }
  if (event.key !== "Tab" || !drawerOpen()) return;
  const items = focusableElements(navigationRegion.value);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const region = navigationRegion.value;
  const active = document.activeElement;
  const focusInsideRegion =
    active instanceof HTMLElement && region?.contains(active) === true;
  // Treat "focus outside the drawer" as sitting on the edge: Tab wraps back
  // to the first element, Shift+Tab wraps to the last — a true trap.
  const atFirst = !focusInsideRegion || active === first;
  const atLast = !focusInsideRegion || active === last;
  if (event.shiftKey && atFirst) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && atLast) {
    event.preventDefault();
    first.focus();
  }
}
</script>

<style scoped>
.app-workspace-shell {
  display: flex;
  height: 100vh;
  width: 100%;
  overflow: hidden;
  background: var(--app-canvas);
  color: var(--app-text);
}

.app-shell-left {
  flex-shrink: 0;
  min-width: 0;
  border-right: 1px solid var(--app-border);
  background: var(--app-shell);
}

.app-shell-center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.app-shell-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.32);
  z-index: 35;
}

/* Medium: collapsible sidebar rendered as a rail-width column the slot
   controls; narrow: overlay drawer. */
.app-workspace-shell[data-shell-mode="narrow"] {
  position: relative;
}

.app-workspace-shell[data-shell-mode="narrow"] .app-shell-left {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  max-width: 86vw;
  z-index: 40;
  box-shadow: 6px 0 24px rgba(0, 0, 0, 0.2);
}
</style>
