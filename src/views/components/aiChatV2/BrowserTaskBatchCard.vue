<template>
  <v-card class="browser-task-batch-card" data-testid="browser-task-batch" density="compact">
    <v-card-title class="text-subtitle-1 d-flex align-center">
      {{ t('browserTasks.batchTitle') || 'Parallel browser tasks' }}
      <v-spacer />
      <v-btn
        variant="text"
        size="small"
        data-testid="batch-return-now"
        @click="emit('returnNow', batchId)"
      >
        {{ t('browserTasks.returnResultsNow') || 'Return results now' }}
      </v-btn>
    </v-card-title>
    <v-card-text>
      <v-list density="compact" data-testid="batch-tasks">
        <v-list-item v-for="task in tasks" :key="task.taskId">
          <template #prepend>
            <v-chip
              size="small"
              :data-testid="`task-state-${task.taskId}`"
              :color="stateColor(task.state)"
            >
              {{ stateLabel(task.state) }}
            </v-chip>
          </template>
          <v-list-item-title>{{ task.label }}</v-list-item-title>
          <template #append>
            <v-btn
              icon
              size="x-small"
              variant="text"
              :data-testid="`task-pause-${task.taskId}`"
              @click="emit('pause', { taskId: task.taskId, sessionId: task.sessionId })"
            >
              {{ t('browserTasks.pause') || 'Pause' }}
            </v-btn>
            <v-btn
              icon
              size="x-small"
              variant="text"
              :data-testid="`task-take-control-${task.taskId}`"
              @click="emit('takeControl', { taskId: task.taskId, sessionId: task.sessionId })"
            >
              {{ t('browserTasks.takeControl') || 'Take control' }}
            </v-btn>
            <v-btn
              icon
              size="x-small"
              variant="text"
              :data-testid="`task-resume-${task.taskId}`"
              @click="emit('resume', { taskId: task.taskId, sessionId: task.sessionId })"
            >
              {{ t('browserTasks.resume') || 'Resume' }}
            </v-btn>
            <v-btn
              icon
              size="x-small"
              variant="text"
              :data-testid="`task-stop-${task.taskId}`"
              @click="emit('stop', { taskId: task.taskId, sessionId: task.sessionId })"
            >
              {{ t('browserTasks.stop') || 'Stop' }}
            </v-btn>
          </template>
        </v-list-item>
      </v-list>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

export interface BrowserBatchTaskRow {
  taskId: string;
  sessionId?: string;
  label: string;
  state: "running" | "waiting_for_user" | "paused" | "cancelling" | "completed" | "failed" | "cancelled" | "interrupted";
}

defineProps<{
  batchId: string;
  tasks: ReadonlyArray<BrowserBatchTaskRow>;
}>();

const emit = defineEmits<{
  (event: "returnNow", batchId: string): void;
  (event: "pause", payload: { taskId: string; sessionId?: string }): void;
  (event: "takeControl", payload: { taskId: string; sessionId?: string }): void;
  (event: "resume", payload: { taskId: string; sessionId?: string }): void;
  (event: "stop", payload: { taskId: string; sessionId?: string }): void;
}>();

const { t } = useI18n();

function stateLabel(state: BrowserBatchTaskRow["state"]): string {
  const map: Record<BrowserBatchTaskRow["state"], string> = {
    running: t('browserTasks.taskRunning') || "Running",
    waiting_for_user: t('browserTasks.taskWaitingForYou') || "Waiting for you",
    paused: t('browserTasks.taskPaused') || "Paused by you",
    cancelling: t('browserTasks.taskCancelled') || "Stopping",
    completed: t('browserTasks.taskCompleted') || "Completed",
    failed: t('browserTasks.taskFailed') || "Failed",
    cancelled: t('browserTasks.taskCancelled') || "Stopped",
    interrupted: t('browserTasks.taskFailed') || "Failed",
  };
  return map[state];
}

function stateColor(state: BrowserBatchTaskRow["state"]): string {
  if (state === "completed") return "success";
  if (state === "failed" || state === "interrupted" || state === "cancelled") return "error";
  if (state === "waiting_for_user") return "warning";
  if (state === "paused") return "info";
  return "primary";
}
</script>
