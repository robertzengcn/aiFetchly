<template>
  <!--
    Static-registry inspector dispatch (design §9.3): the target's kind maps
    to an ALLOWLISTED component through a static record — never a component
    path from route data, IPC, or user input. The inspector is optional and
    scoped to the active page/selection (IPR-007/008).
  -->
  <Teleport to="body">
    <component :is="inspectorComponent" v-if="inspectorComponent && inspector.target" :key="inspectorKey" />
  </Teleport>
</template>

<script setup lang="ts">
import { computed, type Component } from "vue";
import { useAppInspectorStore } from "@/views/store/appInspector";
import type { AppInspectorKind } from "@/views/types/uiConvergenceTypes";
import { useAppShellStore } from "@/views/store/appShell";
import ScheduleInspector from "@/views/components/appShell/inspectors/ScheduleInspector.vue";

/**
 * Kind → component allowlist. Adding a domain inspector requires extending
 * AppInspectorTarget AND registering here — both reviewed changes.
 */
const INSPECTOR_REGISTRY: Partial<Record<AppInspectorKind, Component>> = {
  schedule: ScheduleInspector,
};

const inspector = useAppInspectorStore();
const shell = useAppShellStore();

const inspectorComponent = computed<Component | null>(() => {
  const kind = inspector.kind;
  return kind ? INSPECTOR_REGISTRY[kind] ?? null : null;
});

const inspectorKey = computed(
  () => `${inspector.kind ?? "none"}-${inspector.requestGeneration}`
);

// Expose shell state to registered inspectors via provide in the parent is
// unnecessary: inspectors import the stores directly.
void shell;
</script>
