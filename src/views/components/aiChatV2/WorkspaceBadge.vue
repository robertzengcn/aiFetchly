<template>
  <div
    v-if="workspace"
    class="workspace-badge"
    :title="workspace.rootPath"
    role="status"
  >
    <v-icon size="small" start>mdi-folder</v-icon>
    <span class="workspace-badge__label">{{ labelText }}:</span>
    <span class="workspace-badge__path">{{ displayPath }}</span>
  </div>
  <div
    v-else
    class="workspace-badge workspace-badge--unset"
    role="button"
    tabindex="0"
    @click="requestSetWorkspace"
    @keydown.enter.prevent="requestSetWorkspace"
    @keydown.space.prevent="requestSetWorkspace"
  >
    <v-icon size="small" start>mdi-folder-off</v-icon>
    <span>{{ notSetText }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { WorkspaceSummary } from "@/entityTypes/workspaceTypes";

const props = defineProps<{
  workspace: WorkspaceSummary | null;
}>();

const emit = defineEmits<{
  (e: "request-set-workspace"): void;
}>();

const { t } = useI18n();

const labelText = computed(() => t("workspace.badgeLabel") || "Workspace");
const notSetText = computed(
  () => t("workspace.notSet") || "No workspace set"
);

const displayPath = computed(() => {
  const p = props.workspace?.rootPath ?? "";
  if (!p) return "";
  if (p.length <= 48) return p;
  const sep = p.includes("/") ? "/" : "\\";
  const parts = p.split(sep);
  if (parts.length <= 3) return p;
  return parts[0] + sep + "..." + sep + parts.slice(-2).join(sep);
});

function requestSetWorkspace(): void {
  if (props.workspace) return;
  emit("request-set-workspace");
}
</script>

<style scoped>
.workspace-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-on-surface));
}
.workspace-badge--unset {
  background: rgba(var(--v-theme-warning), 0.12);
  color: rgb(var(--v-theme-warning));
  cursor: pointer;
}
.workspace-badge--unset:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}
.workspace-badge__label {
  opacity: 0.7;
  margin-right: 4px;
}
.workspace-badge__path {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
