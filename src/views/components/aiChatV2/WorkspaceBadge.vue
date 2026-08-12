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
    <button
      type="button"
      class="workspace-badge__change"
      :title="changeFolderText"
      :aria-label="changeFolderText"
      @click.stop="requestSetWorkspace"
    >
      <v-icon size="small" start>mdi-folder-swap-outline</v-icon>
      <span>{{ changeFolderText }}</span>
    </button>
    <button
      type="button"
      class="workspace-badge__memory"
      :title="memoryLabel"
      @click.stop="requestOpenMemory"
    >
      <v-icon size="small" start>mdi-brain</v-icon>
      <span>{{ memoryLabel }}</span>
      <span v-if="memoryCount > 0" class="workspace-badge__memory-count">{{
        memoryCount
      }}</span>
    </button>
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

const props = withDefaults(
  defineProps<{
    workspace: WorkspaceSummary | null;
    memoryCount?: number;
  }>(),
  { memoryCount: 0 }
);

const emit = defineEmits<{
  (e: "request-set-workspace"): void;
  (e: "request-open-memory"): void;
}>();

const { t } = useI18n();

const labelText = computed(() => t("workspace.badgeLabel") || "Workspace");
const notSetText = computed(
  () => t("workspace.notSet") || "No workspace set"
);
const memoryLabel = computed(
  () => t("workspaceMemory.memoryAction") || "Memory"
);
const changeFolderText = computed(
  () => t("workspace.changeFolder") || "Change folder"
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
  // Allow re-picking even when a workspace is already set, so the user can
  // change folders. The parent decides whether to prompt for a new folder.
  emit("request-set-workspace");
}

function requestOpenMemory(): void {
  if (!props.workspace) return;
  emit("request-open-memory");
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
.workspace-badge__change {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  padding: 0 6px;
  border: none;
  border-left: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  background: transparent;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
  border-radius: 0;
}
.workspace-badge__change:hover {
  background: rgba(var(--v-theme-primary), 0.12);
}
.workspace-badge__memory {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  padding: 0 6px;
  border: none;
  border-left: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  background: transparent;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
  border-radius: 0 4px 4px 0;
}
.workspace-badge__memory:hover {
  background: rgba(var(--v-theme-primary), 0.12);
}
.workspace-badge__memory-count {
  margin-left: 4px;
  padding: 0 4px;
  border-radius: 8px;
  font-size: 11px;
  background: rgba(var(--v-theme-primary), 0.2);
}
</style>
