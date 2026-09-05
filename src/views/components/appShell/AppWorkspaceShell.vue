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
    <aside v-if="shell.mode !== 'narrow' || shell.navigationOpen" class="app-shell-left">
      <slot name="navigation" />
    </aside>

    <main class="app-shell-center">
      <slot />
    </main>

    <AppInspectorHost />
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useAppShellStore } from "@/views/store/appShell";
import { useResponsiveShell } from "@/views/composables/useResponsiveShell";
import AppInspectorHost from "./AppInspectorHost.vue";

const shell = useAppShellStore();
const shellRoot = ref<HTMLElement | null>(null);

// Measure the shell's own box — the application workspace, not the screen.
useResponsiveShell(() => shellRoot.value);
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
