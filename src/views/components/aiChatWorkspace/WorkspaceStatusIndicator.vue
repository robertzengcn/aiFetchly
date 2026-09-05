<template>
  <span
    v-if="visual.icon"
    class="status-indicator"
    :class="{ spinning: visual.spinning }"
    role="img"
    :aria-label="label"
    :title="label"
  >
    <v-icon :icon="visual.icon" size="14" aria-hidden="true" />
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ConversationStatusVisual } from "./workspaceStatusUtil";

const props = defineProps<{
  visual: ConversationStatusVisual;
}>();

const { t } = useI18n();

/** Accessible name: never color-only (FR-041). */
const label = computed(
  () => t(props.visual.labelKey) || props.visual.fallback
);
</script>

<style scoped>
.status-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  color: rgba(var(--v-theme-on-surface), 0.65);
}

.spinning :deep(.v-icon) {
  animation: workspace-spin 1s linear infinite;
}

@keyframes workspace-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinning :deep(.v-icon) {
    animation: none;
  }
}
</style>
