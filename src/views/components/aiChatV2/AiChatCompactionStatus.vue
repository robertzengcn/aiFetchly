<template>
  <v-chip
    v-if="visible"
    size="x-small"
    variant="tonal"
    :color="color"
    data-testid="ai-compaction-status"
  >
    <v-icon start size="x-small">{{ icon }}</v-icon>
    {{ label }}
  </v-chip>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { CompactionStatusSnapshot } from "@/service/AIChatCompactionCoordinator";

/**
 * Incremental-compaction status badge (technical-design §13).
 *
 * Renders a compact chip reflecting the active or last-known compaction run
 * state. Hidden (v-if="visible") when there is no run at all (null status or
 * queued with no runId) so the header stays uncluttered for conversations that
 * have never compacted.
 */
const props = defineProps<{
  status: CompactionStatusSnapshot | null;
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

/** Visible only when there is a meaningful run state to show. */
const visible = computed(() => {
  if (!props.status) return false;
  if (!props.status.runId && props.status.state === "queued") return false;
  return true;
});
</script>
