<template>
  <v-menu v-if="visible" location="bottom end" :close-on-content-click="false">
    <template #activator="{ props: menuProps }">
      <v-chip
        size="x-small"
        variant="tonal"
        :color="color"
        data-testid="ai-compaction-status"
        :aria-label="label"
        v-bind="menuProps"
      >
        <v-icon start size="x-small" aria-hidden="true">{{ icon }}</v-icon>
        {{ label }}
      </v-chip>
    </template>
    <v-card min-width="280" data-testid="ai-compaction-panel">
      <v-card-title class="text-subtitle-2">
        {{ t("aiChatCompaction.panel_title") || "Compaction" }}
      </v-card-title>
      <v-card-text class="text-body-2">
        <div>{{ detail }}</div>
        <div
          v-if="isActive"
          class="mt-1 text-caption text-medium-emphasis"
          data-testid="ai-compaction-progress-note"
        >
          <v-progress-circular
            size="14"
            width="2"
            indeterminate
            aria-hidden="true"
          />
          {{ t("aiChatCompaction.in_progress_note") || "Working in bounded batches — safe to keep chatting." }}
        </div>
      </v-card-text>
      <v-card-actions>
        <v-btn
          v-if="canRetry"
          size="small"
          variant="text"
          :loading="busy"
          data-testid="ai-compaction-retry"
          @click="emitRetry"
        >
          {{ t("aiChatCompaction.compaction_retry") || "Retry" }}
        </v-btn>
        <v-btn
          v-if="canCancel"
          size="small"
          variant="text"
          :loading="busy"
          data-testid="ai-compaction-cancel"
          @click="emitCancel"
        >
          {{ t("aiChatCompaction.compaction_cancel") || "Cancel compaction" }}
        </v-btn>
        <v-btn
          size="small"
          variant="text"
          data-testid="ai-compaction-view-history"
          @click="emitOpenHistory"
        >
          {{ t("aiChatCompaction.view_history") || "View earlier messages" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-menu>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { CompactionStatusSnapshot } from "@/service/AIChatCompactionCoordinator";

/**
 * Incremental-compaction status + recovery actions (§13, FR-09–11).
 *
 * The chip reflects the accurate run state (idle/queued/running/joined/
 * paused/completed/failed/cancelled). The panel exposes bounded retry/cancel
 * controls and a link to earlier messages, and explains that originals remain
 * searchable after completion. Progress uses section counts when known, or an
 * indeterminate indicator — never an invented percentage.
 */
const props = defineProps<{
  status: CompactionStatusSnapshot | null;
  busy?: boolean;
}>();

const emit = defineEmits<{
  (e: "retry"): void;
  (e: "cancel"): void;
  (e: "openHistory"): void;
}>();

const { t } = useI18n();

interface StatusConfig {
  color: string;
  icon: string;
  key: string;
}

const config = computed<StatusConfig>(() => {
  const state = props.status?.state ?? "idle";
  switch (state) {
    case "queued":
      return { color: "info", icon: "mdi-tray-full", key: "status_queued" };
    case "running":
      return { color: "info", icon: "mdi-sync", key: "status_running" };
    case "joined":
      return { color: "info", icon: "mdi-account-multiple-plus", key: "status_joined" };
    case "paused":
      return { color: "warning", icon: "mdi-pause-circle", key: "status_paused" };
    case "completed":
      return { color: "success", icon: "mdi-check-circle", key: "status_completed" };
    case "failed":
      return { color: "error", icon: "mdi-alert-circle", key: "status_failed" };
    case "cancelled":
      return { color: "default", icon: "mdi-cancel", key: "status_cancelled" };
    default:
      return { color: "default", icon: "mdi-circle-outline", key: "status_idle" };
  }
});

const color = computed(() => config.value.color);
const icon = computed(() => config.value.icon);

const label = computed(() => {
  const key = `aiChatCompaction.${config.value.key}`;
  const fallback = config.value.key.replace(/_/g, " ");
  return t(key) || fallback;
});

const detail = computed(() => {
  const state = props.status?.state ?? "idle";
  switch (state) {
    case "completed":
      return (
        t("aiChatCompaction.completed_detail") ||
        "Earlier messages remain searchable. The active view keeps recent turns plus a bounded overview."
      );
    case "failed":
      return (
        t("aiChatCompaction.failed_detail") ||
        "Compaction stopped with an error. Your conversation is intact — retry when ready."
      );
    case "paused":
      return (
        t("aiChatCompaction.compaction_paused") ||
        "Compaction paused. It will resume automatically."
      );
    case "cancelled":
      return (
        t("aiChatCompaction.cancelled_detail") ||
        "Compaction was cancelled. Saved sections are kept for the next run."
      );
    case "joined":
      return (
        t("aiChatCompaction.joined_detail") ||
        "Joined an already-running compaction for this conversation."
      );
    case "running":
    case "queued":
      return (
        t("aiChatCompaction.running_detail") ||
        "Compacting earlier history in bounded sections."
      );
    default:
      return t("aiChatCompaction.idle_detail") || "Compaction is idle.";
  }
});

/** Visible only when there is a meaningful run state to show. */
const visible = computed(() => {
  if (!props.status) return false;
  if (!props.status.runId && props.status.state === "queued") return false;
  return true;
});

const isActive = computed(() => {
  const s = props.status?.state;
  return s === "running" || s === "queued" || s === "joined";
});

const canRetry = computed(() => {
  const s = props.status?.state;
  return s === "failed" || s === "paused" || s === "cancelled";
});

const canCancel = computed(() => isActive.value);

function emitRetry(): void {
  emit("retry");
}

function emitCancel(): void {
  emit("cancel");
}

function emitOpenHistory(): void {
  emit("openHistory");
}
</script>
