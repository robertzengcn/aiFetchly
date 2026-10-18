<template>
  <div class="plugin-artifact-card" data-testid="plugin-artifact-card">
    <div class="plugin-artifact-card__header">
      <v-icon size="small" color="primary">mdi-file-table-outline</v-icon>
      <strong>{{ t("aiChatV2.pluginArtifact.title") || "Result files" }}</strong>
      <span class="plugin-artifact-card__count">
        {{ t("aiChatV2.pluginArtifact.count_label", { count: visibleArtifacts.length }) || `${visibleArtifacts.length} file(s)` }}
      </span>
    </div>

    <div
      v-for="artifact in visibleArtifacts"
      :key="artifact.id"
      class="plugin-artifact-card__row"
      data-testid="plugin-artifact-row"
    >
      <div class="plugin-artifact-card__icon">
        <v-icon size="small">
          {{ artifact.format === "csv" ? "mdi-file-delimited-outline" : "mdi-code-json" }}
        </v-icon>
      </div>
      <div class="plugin-artifact-card__body">
        <div class="plugin-artifact-card__title" :title="artifactTitle(artifact)">
          {{ artifactTitle(artifact) }}
        </div>
        <div class="plugin-artifact-card__meta" data-testid="plugin-artifact-meta">
          <span>{{ artifact.format.toUpperCase() }}</span>
          <span v-if="recordLabel(artifact)">
            {{ recordLabel(artifact) }}
          </span>
          <span v-if="sizeof(artifact)">
            {{ sizeof(artifact) }}
          </span>
          <span v-if="artifact.createdAt">
            {{ t("aiChatV2.pluginArtifact.saved_at", { time: savedTimeLabel(artifact) }) || artifact.createdAt }}
          </span>
        </div>
        <div
          v-if="row(artifact.id)?.error"
          class="plugin-artifact-card__error"
          role="alert"
          data-testid="plugin-artifact-error"
        >
          {{ row(artifact.id)?.error }}
        </div>
        <pre
          v-if="row(artifact.id)?.preview"
          class="plugin-artifact-card__preview"
          data-testid="plugin-artifact-preview"
        >{{ row(artifact.id)?.preview }}</pre>
      </div>
      <div class="plugin-artifact-card__actions">
        <v-btn
          size="small"
          variant="text"
          :disabled="disabled || row(artifact.id)?.busy"
          data-testid="plugin-artifact-preview-toggle"
          @click="togglePreview(artifact)"
        >
          {{
            row(artifact.id)?.toggled
              ? t("aiChatV2.pluginArtifact.hide_preview") || "Hide preview"
              : t("aiChatV2.pluginArtifact.preview") || "Preview"
          }}
        </v-btn>
        <v-btn
          size="small"
          variant="text"
          :disabled="disabled || row(artifact.id)?.busy"
          data-testid="plugin-artifact-save"
          @click="saveArtifact(artifact)"
        >
          {{ t("aiChatV2.pluginArtifact.save") || "Save file" }}
        </v-btn>
        <v-btn
          size="small"
          variant="text"
          color="error"
          :disabled="disabled || row(artifact.id)?.busy"
          :data-testid="'plugin-artifact-delete-' + artifact.id"
          @click="deleteArtifact(artifact)"
        >
          {{
            row(artifact.id)?.confirmingDelete
              ? t("aiChatV2.pluginArtifact.confirm_delete") || "Confirm delete"
              : t("aiChatV2.pluginArtifact.delete") || "Delete"
          }}
        </v-btn>
      </div>
    </div>

    <div v-if="deletedAll" class="plugin-artifact-card__notice" data-testid="plugin-artifact-deleted-notice">
      {{ t("aiChatV2.pluginArtifact.deleted_all") || "Files deleted" }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  deletePluginArtifact,
  exportPluginArtifact,
  previewPluginArtifact,
  type PluginArtifactView,
} from "@/views/api/pluginArtifact";

/**
 * Card for host-registered plugin result artifacts (design §13.4).
 *
 * Actions are id-scoped only: preview is bounded, "Save file" opens the
 * host's native save dialog (the renderer cannot supply a path), and delete
 * is verified against conversation ownership in the main process. No AI
 * request is involved in any of them. Preview content is rendered as
 * escaped text — never as HTML.
 *
 * Per-row action state is keyed by ARTIFACT ID, not position, because the
 * descriptor list can change independently of the table (deleted rows are
 * hidden locally and history can reload richer rows).
 */
const props = defineProps<{
  conversationId: string;
  artifacts: PluginArtifactView[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "deleted", artifactId: string): void;
}>();

const { t } = useI18n();

const PREVIEW_MAX_ROWS = 5;

interface RowState {
  preview: string | null;
  toggled: boolean;
  error: string | null;
  busy: boolean;
  confirmingDelete: boolean;
}

const rows = ref(new Map<string, RowState>());

function row(id: string): RowState | undefined {
  return rows.value.get(id);
}

function ensureRow(id: string): RowState {
  let state = rows.value.get(id);
  if (!state) {
    state = {
      preview: null,
      toggled: false,
      error: null,
      busy: false,
      confirmingDelete: false,
    };
    rows.value.set(id, state);
  }
  return state;
}

// Rows deleted through this card are hidden locally right away: the persisted
// tool-result row keeps its descriptor (history content is immutable), so
// without local hiding the dead row would stay visible until the next reload.
const hiddenIds = ref(new Set<string>());
const visibleArtifacts = computed(() =>
  props.artifacts.filter((a) => !hiddenIds.value.has(a.id))
);

function artifactTitle(artifact: PluginArtifactView): string {
  return (
    t("aiChatV2.pluginArtifact.file_title", {
      format: artifact.format.toUpperCase(),
    }) || `Records (${artifact.format.toUpperCase()})`
  );
}

function recordLabel(artifact: PluginArtifactView): string | null {
  if (typeof artifact.recordCount !== "number") return null;
  return (
    t("aiChatV2.pluginArtifact.records_count", {
      count: artifact.recordCount,
    }) || `${artifact.recordCount} records`
  );
}

function sizeof(artifact: PluginArtifactView): string | null {
  if (typeof artifact.sizeBytes !== "number" || artifact.sizeBytes < 0) {
    return null;
  }
  const bytes = artifact.sizeBytes;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function savedTimeLabel(artifact: PluginArtifactView): string {
  const raw = artifact.createdAt ?? "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString();
}

function truncatedPreviewLabel(): string {
  return (
    t("aiChatV2.pluginArtifact.preview_truncated") ||
    "… (preview only shows the first rows)"
  );
}

function boundPreview(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const rowsText = raw.split(/\r?\n/);
  return (
    rowsText.slice(0, PREVIEW_MAX_ROWS).join("\n") +
    (rowsText.length > PREVIEW_MAX_ROWS ? `\n${truncatedPreviewLabel()}` : "")
  );
}

async function togglePreview(artifact: PluginArtifactView): Promise<void> {
  const state = ensureRow(artifact.id);
  state.error = null;
  if (state.toggled) {
    state.toggled = false;
    return;
  }
  state.toggled = true;
  if (state.preview) return;
  state.busy = true;
  try {
    const result = await previewPluginArtifact(
      props.conversationId,
      artifact.id
    );
    if (result && result.ok) {
      state.preview = boundPreview(result.rows) || null;
    } else {
      state.preview = null;
      state.error =
        result?.error ||
        t("aiChatV2.pluginArtifact.preview_failed") ||
        "Could not load the preview";
    }
  } catch {
    state.preview = null;
    state.error =
      t("aiChatV2.pluginArtifact.preview_failed") ||
      "Could not load the preview";
  } finally {
    state.busy = false;
  }
}

async function saveArtifact(artifact: PluginArtifactView): Promise<void> {
  const state = ensureRow(artifact.id);
  state.error = null;
  state.busy = true;
  try {
    const result = await exportPluginArtifact(
      props.conversationId,
      artifact.id
    );
    if (!result.cancelled) {
      state.error = null;
    }
  } catch (err) {
    state.error =
      err instanceof Error && err.message
        ? `${t("aiChatV2.pluginArtifact.export_failed") || "Could not save the file"}: ${err.message}`
        : t("aiChatV2.pluginArtifact.export_failed") ||
          "Could not save the file";
  } finally {
    state.busy = false;
  }
}

async function deleteArtifact(artifact: PluginArtifactView): Promise<void> {
  const state = ensureRow(artifact.id);
  state.error = null;
  // Two-step confirmation replaces a modal so the flow stays keyboardable.
  if (!state.confirmingDelete) {
    state.confirmingDelete = true;
    return;
  }
  state.busy = true;
  try {
    const result = await deletePluginArtifact(
      props.conversationId,
      artifact.id
    );
    const nextHidden = new Set(hiddenIds.value);
    nextHidden.add(artifact.id);
    hiddenIds.value = nextHidden;
    emit("deleted", artifact.id);
    // Wait a tick so the computed drops the row before showing the notice.
    await nextTick();
    if (result.deleted && visibleArtifacts.value.length === 0) {
      deletedAll.value = true;
    }
  } catch (err) {
    state.error =
      err instanceof Error && err.message
        ? `${t("aiChatV2.pluginArtifact.delete_failed") || "Could not delete the file"}: ${err.message}`
        : t("aiChatV2.pluginArtifact.delete_failed") ||
          "Could not delete the file";
  } finally {
    state.busy = false;
    state.confirmingDelete = false;
  }
}

const deletedAll = ref(false);
</script>

<style scoped>
.plugin-artifact-card {
  margin: 6px 0;
  padding: 10px 12px;
  border: 1px solid rgba(var(--v-theme-primary), 0.35);
  border-radius: 10px;
  background: rgba(var(--v-theme-primary), 0.06);
}

.plugin-artifact-card__header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.plugin-artifact-card__count {
  font-size: 11px;
  opacity: 0.7;
}

.plugin-artifact-card__row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 6px 0;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.plugin-artifact-card__icon {
  flex: 0 0 auto;
  padding-top: 2px;
}

.plugin-artifact-card__body {
  flex: 1 1 auto;
  min-width: 0;
}

.plugin-artifact-card__title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.plugin-artifact-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  opacity: 0.7;
  margin-top: 2px;
}

.plugin-artifact-card__actions {
  display: flex;
  gap: 2px;
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.plugin-artifact-card__preview {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 40vh;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.04);
  padding: 8px;
  border-radius: 4px;
  font-size: 12px;
  margin-top: 6px;
}

.plugin-artifact-card__error {
  color: rgb(var(--v-theme-error));
  font-size: 12px;
  margin-top: 4px;
}

.plugin-artifact-card__notice {
  font-size: 12px;
  opacity: 0.75;
  margin-top: 4px;
}
</style>
