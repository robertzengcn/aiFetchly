<template>
  <!-- Compact terminal outcome (design §18.2, IPR-041). -->
  <div
    class="run-receipt"
    :class="`outcome-${outcome}`"
    role="status"
    :data-testid="`run-receipt-${outcome}`"
  >
    <v-icon :icon="icon" size="14" aria-hidden="true" />
    <span class="receipt-text">
      {{ text }}
      <button
        v-if="activityAvailable"
        type="button"
        class="receipt-link"
        data-testid="run-receipt-activity"
        @click="emit('view-activity')"
      >
        {{ t('ui.task.viewActivity') || 'View activity' }}
      </button>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const props = withDefaults(
  defineProps<{
    /** Pre-localized summary, e.g. "Extraction completed · 248 records". */
    text: string;
    outcome: "completed" | "failed" | "cancelled" | "interrupted";
    activityAvailable?: boolean;
  }>(),
  { activityAvailable: false }
);

const emit = defineEmits<{
  (e: "view-activity"): void;
}>();

const { t } = useI18n();

const ICONS = {
  completed: "mdi-check",
  failed: "mdi-close",
  cancelled: "mdi-cancel",
  interrupted: "mdi-restore",
} as const;

const icon = computed(() => ICONS[props.outcome]);
</script>

<style scoped>
.run-receipt {
  display: inline-flex;
  align-items: center;
  gap: var(--app-space-2);
  padding: 3px var(--app-space-2);
  border-radius: var(--app-radius-control);
  font-size: 12px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
}

.outcome-completed { color: var(--app-success); }
.outcome-failed,
.outcome-interrupted { color: var(--app-danger); }

.receipt-text {
  color: var(--app-text-soft);
}

.receipt-link {
  border: none;
  background: none;
  padding: 0 4px;
  color: var(--app-accent);
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
}

.receipt-link:focus-visible {
  outline: 2px solid var(--app-focus);
}
</style>
