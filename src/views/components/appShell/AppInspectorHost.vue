<template>
  <!--
    Static-registry inspector dispatch (design §9.3): the target's kind maps
    to an ALLOWLISTED component through a static record — never a component
    path from route data, IPC, or user input. The inspector is optional and
    scoped to the active page/selection (IPR-007/008).

    Docked-column change (2026-10-26): no body teleport — the host is a
    direct flex child of `.app-workspace-shell`, so the active inspector
    mounts INLINE as the shell row's third column (wide: real layout
    column; narrow/medium: the surface's own overlay variant).
  -->
  <component
    :is="inspectorComponent"
    v-if="inspectorComponent && inspector.target"
    :key="inspectorKey"
  />
</template>

<script setup lang="ts">
import { computed, type Component } from "vue";
import { useAppInspectorStore } from "@/views/store/appInspector";
import type { AppInspectorKind } from "@/views/types/uiConvergenceTypes";
import { useAppShellStore } from "@/views/store/appShell";
import ScheduleInspector from "@/views/components/appShell/inspectors/ScheduleInspector.vue";
import ChatInspectorAdapter from "@/views/components/appShell/inspectors/ChatInspectorAdapter.vue";

/**
 * Kind → component allowlist. Adding a domain inspector requires extending
 * AppInspectorTarget AND registering here — both reviewed changes.
 */
const INSPECTOR_REGISTRY: Partial<Record<AppInspectorKind, Component>> = {
  schedule: ScheduleInspector,
  chat: ChatInspectorAdapter,
};

const inspector = useAppInspectorStore();
const shell = useAppShellStore();

const inspectorComponent = computed<Component | null>(() => {
  const kind = inspector.kind;
  return kind ? INSPECTOR_REGISTRY[kind] ?? null : null;
});

// Key by kind only — NEVER requestGeneration. Mount-time loads call
// `inspector.beginRequest()` (ScheduleInspector.load), which mutates
// `requestGeneration`; reading it here would change this child's key on
// every mount, remounting the child — whose mount reloads and re-remounts…
// an infinite synchronous cycle reported as
// "Maximum recursive updates exceeded in component <AppInspectorHost>".
// Open/close lifecycle is owned by the host's v-if; target changes within
// a kind are owned by each inspector's own target watcher.
const inspectorKey = computed(() => inspector.kind ?? "none");

// Expose shell state to registered inspectors via provide in the parent is
// unnecessary: inspectors import the stores directly.
void shell;
</script>
