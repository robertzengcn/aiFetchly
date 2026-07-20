<template>
  <button
    type="button"
    class="wm-status-badge"
    :title="tooltipText"
    @click="$emit('request-open')"
  >
    <v-icon size="small" start>mdi-brain</v-icon>
    <span class="wm-status-badge__label">{{ labelText }}</span>
    <span v-if="count > 0" class="wm-status-badge__count">{{ count }}</span>
    <v-progress-circular
      v-if="running"
      indeterminate
      size="12"
      width="2"
      class="wm-status-badge__spinner"
    />
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const props = withDefaults(
  defineProps<{
    count?: number;
    running?: boolean;
    failed?: boolean;
  }>(),
  { count: 0, running: false, failed: false }
);

defineEmits<{
  (e: "request-open"): void;
}>();

const { t } = useI18n();

const labelText = computed(
  () => t("workspaceMemory.memoryAction") || "Memory"
);
const tooltipText = computed(() => {
  if (props.running)
    return t("workspaceMemory.autoDreamRunning") || "Consolidating...";
  if (props.failed)
    return t("workspaceMemory.autoDreamFailed") || "Last run failed";
  return labelText.value;
});
</script>

<style scoped>
.wm-status-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  border: none;
  cursor: pointer;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-on-surface));
}
.wm-status-badge:hover {
  background: rgba(var(--v-theme-primary), 0.16);
}
.wm-status-badge__count {
  margin-left: 4px;
  padding: 0 4px;
  border-radius: 8px;
  font-size: 11px;
  background: rgba(var(--v-theme-primary), 0.2);
}
.wm-status-badge__spinner {
  margin-left: 4px;
}
</style>
