<template>
  <!--
    Ongoing task state (design §18.2, IPR-038/042): one authoritative
    surface with at most two actions; text+icon carry meaning without color.
  -->
  <div
    class="task-state-strip"
    :class="`task-${projection.state}`"
    role="status"
    :data-testid="`task-strip-${projection.state}`"
  >
    <v-icon :icon="icon" size="16" :class="{ spinning: spinning }" aria-hidden="true" />
    <span class="strip-text">{{ summary }}</span>
    <div class="strip-actions">
      <button
        v-if="projection.secondaryAction"
        type="button"
        class="strip-action secondary"
        :data-testid="`task-action-${projection.secondaryAction.id}`"
        @click="emit('action', projection.secondaryAction.id)"
      >
        {{ t(projection.secondaryAction.labelKey) || projection.secondaryAction.id }}
      </button>
      <button
        v-if="projection.primaryAction"
        type="button"
        class="strip-action primary"
        :data-testid="`task-action-${projection.primaryAction.id}`"
        @click="emit('action', projection.primaryAction.id)"
      >
        {{ t(projection.primaryAction.labelKey) || projection.primaryAction.id }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { TaskPresentationProjection } from "@/views/types/uiConvergenceTypes";

const props = defineProps<{
  projection: TaskPresentationProjection;
}>();

const emit = defineEmits<{
  (e: "action", actionId: string): void;
}>();

const { t } = useI18n();

const ICONS: Record<string, string> = {
  queued: "mdi-clock-outline",
  running: "mdi-loading",
  paused: "mdi-pause-circle-outline",
  awaiting_permission: "mdi-lock-outline",
  awaiting_user: "mdi-help-circle-outline",
  stopping: "mdi-stop-circle-outline",
  completed: "mdi-check-circle-outline",
  failed: "mdi-close-circle-outline",
  interrupted: "mdi-restore",
  cancelled: "mdi-cancel",
};

const icon = computed(() => ICONS[props.projection.state] ?? "mdi-information-outline");
const spinning = computed(() => props.projection.state === "running");
const summary = computed(
  () => t(props.projection.summaryKey) || props.projection.summaryKey
);
</script>

<style scoped>
.task-state-strip {
  display: flex;
  align-items: center;
  gap: var(--app-space-2);
  padding: var(--app-space-2) var(--app-space-3);
  border: 1px solid var(--app-border);
  border-left: 3px solid var(--app-border-strong);
  border-radius: var(--app-radius-control);
  background: var(--app-surface);
  font-size: 13px;
}

.task-running { border-left-color: var(--app-accent); }
.task-completed { border-left-color: var(--app-success); }
.task-failed,
.task-interrupted { border-left-color: var(--app-danger); }
.task-awaiting_permission,
.task-awaiting_user,
.task-paused { border-left-color: var(--app-warning); }

.strip-text {
  flex: 1;
  min-width: 0;
}

.spinning {
  animation: task-spin 1s linear infinite;
}

@keyframes task-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .spinning { animation: none; }
}

.strip-actions {
  display: flex;
  gap: var(--app-space-2);
}

.strip-action {
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-control);
  background: transparent;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  color: var(--app-text);
}

.strip-action.primary {
  background: var(--app-accent);
  border-color: var(--app-accent);
  color: var(--app-canvas);
  font-weight: 600;
}

.strip-action:focus-visible {
  outline: 2px solid var(--app-focus);
}
</style>
