<template>
  <!--
    Workspace chooser badge (FR-WS-002/003, design §9.2): name, icon-plus-text
    approval state, shortened path, and a Change/Choose action. Status is never
    conveyed by color alone (icon + text). While a run is active the
    Choose/Change action is disabled with a visible, localized reason
    (FR-WS-007 / acceptance criterion 13).
  -->
  <div
    v-if="loading"
    class="workspace-badge workspace-badge--loading"
    role="status"
    data-testid="workspace-badge-loading"
  >
    <v-icon size="small" start>mdi-folder-outline</v-icon>
    <span>{{ loadingText }}</span>
  </div>

  <div
    v-else-if="workspace"
    class="workspace-badge"
    :title="workspace.rootPath"
    role="status"
    data-testid="workspace-badge"
  >
    <v-icon size="small" start>mdi-folder</v-icon>
    <span class="workspace-badge__name">{{ displayName }}</span>
    <span
      class="workspace-badge__status"
      :data-approval-state="workspace.approvalState"
    >
      <v-icon size="x-small">{{ statusIcon }}</v-icon>
      <span>{{ statusText }}</span>
    </span>
    <span class="workspace-badge__path">{{ displayPath }}</span>
    <button
      type="button"
      class="workspace-badge__change"
      :title="busy ? busyReasonText : changeFolderText"
      :aria-label="busy ? busyReasonText : changeFolderText"
      :disabled="busy"
      data-testid="workspace-badge-change"
      @click.stop="requestSetWorkspace"
    >
      <v-icon size="small" start>mdi-folder-swap-outline</v-icon>
      <span>{{ changeFolderText }}</span>
    </button>
    <span
      v-if="busy"
      class="workspace-badge__busy-reason"
      role="status"
      data-testid="workspace-badge-busy-reason"
    >
      {{ busyReasonText }}
    </span>
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
    data-testid="workspace-badge-unset"
  >
    <v-icon size="small" start>mdi-folder-off</v-icon>
    <span class="workspace-badge__unset-text">{{ notSetText }}</span>
    <span class="workspace-badge__unset-hint">{{ chooseHintText }}</span>
    <button
      type="button"
      class="workspace-badge__choose"
      :title="busy ? busyReasonText : chooseActionText"
      :aria-label="busy ? busyReasonText : chooseActionText"
      :disabled="busy"
      data-testid="workspace-badge-choose"
      @click.stop="requestSetWorkspace"
    >
      <v-icon size="small" start>mdi-folder-plus-outline</v-icon>
      <span>{{ chooseActionText }}</span>
    </button>
    <span
      v-if="busy"
      class="workspace-badge__busy-reason"
      role="status"
      data-testid="workspace-badge-busy-reason"
    >
      {{ busyReasonText }}
    </span>
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
    /** Chooser refresh in flight (FR-WS-002 loading state). */
    loading?: boolean;
    /** A run is active: workspace changes are unsafe (FR-WS-007). */
    busy?: boolean;
  }>(),
  { memoryCount: 0, loading: false, busy: false }
);

const emit = defineEmits<{
  (e: "request-set-workspace"): void;
  (e: "request-open-memory"): void;
}>();

const { t } = useI18n();

const loadingText = computed(
  () => t("workspace.loading") || "Loading workspace…"
);
const notSetText = computed(
  () => t("workspace.notSet") || "No workspace set"
);
const chooseActionText = computed(
  () => t("workspace.chooseAction") || "Choose workspace"
);
const chooseHintText = computed(
  () =>
    t("workspace.chooseHint") ||
    "Pick a folder so AI file tools can read and write files."
);
const memoryLabel = computed(
  () => t("workspaceMemory.memoryAction") || "Memory"
);
const changeFolderText = computed(
  () => t("workspace.changeFolder") || "Change folder"
);
const busyReasonText = computed(
  () => t("workspace.busyReason") || "Available after current run"
);
const statusText = computed(() => {
  switch (props.workspace?.approvalState) {
    case "approved":
      return t("workspace.statusApproved") || "Approved";
    case "pending":
      return t("workspace.statusPending") || "Pending approval";
    case "revoked":
      return t("workspace.statusRevoked") || "Access revoked";
    default:
      return "";
  }
});
const statusIcon = computed(() => {
  switch (props.workspace?.approvalState) {
    case "approved":
      return "mdi-check-circle-outline";
    case "pending":
      return "mdi-clock-outline";
    case "revoked":
      return "mdi-alert-outline";
    default:
      return "mdi-help-circle-outline";
  }
});

/** Human-friendly name: label, else the path's final segment. */
const displayName = computed(() => {
  const ws = props.workspace;
  if (!ws) return "";
  if (ws.label && ws.label.trim().length > 0) return ws.label;
  const sep = ws.rootPath.includes("/") ? "/" : "\\";
  const parts = ws.rootPath.split(sep).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? ws.rootPath;
});

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
  if (props.busy) return; // FR-WS-007: blocked while a run is active
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
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-on-surface));
}
.workspace-badge--loading,
.workspace-badge--unset {
  background: rgba(var(--v-theme-warning), 0.12);
}
.workspace-badge--unset {
  color: rgb(var(--v-theme-warning));
}
.workspace-badge__name {
  font-weight: 500;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workspace-badge__status {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  opacity: 0.85;
  white-space: nowrap;
}
.workspace-badge__path {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.8;
}
.workspace-badge__change,
.workspace-badge__choose,
.workspace-badge__memory {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  min-height: 24px;
  padding: 0 6px;
  border: none;
  border-left: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  background: transparent;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
  border-radius: 0;
}
.workspace-badge__change:hover:not(:disabled),
.workspace-badge__choose:hover:not(:disabled),
.workspace-badge__memory:hover {
  background: rgba(var(--v-theme-primary), 0.12);
}
.workspace-badge__change:focus-visible,
.workspace-badge__choose:focus-visible,
.workspace-badge__memory:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}
.workspace-badge__change:disabled,
.workspace-badge__choose:disabled {
  opacity: 0.5;
  cursor: default;
}
.workspace-badge__choose {
  color: rgb(var(--v-theme-primary));
  font-weight: 500;
}
.workspace-badge__unset-text {
  font-weight: 500;
}
.workspace-badge__unset-hint {
  color: rgba(var(--v-theme-on-surface), 0.7);
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workspace-badge__busy-reason {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 11px;
  white-space: nowrap;
  background: rgba(var(--v-theme-warning), 0.15);
  color: rgb(var(--v-theme-on-surface), 0.9);
}
.workspace-badge__memory {
  border-radius: 0 4px 4px 0;
}
.workspace-badge__memory-count {
  margin-left: 4px;
  padding: 0 4px;
  border-radius: 8px;
  font-size: 11px;
  background: rgba(var(--v-theme-primary), 0.2);
}
</style>
