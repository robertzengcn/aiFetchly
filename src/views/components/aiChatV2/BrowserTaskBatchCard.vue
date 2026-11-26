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
              @click="openResumeDialog(task)"
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

    <!-- C-FR-04/G05: "Resume with instructions" — the user's text rides
         BROWSER_TASK_RESUME and the runner folds it into the next
         decision subgoal (consume-once). -->
    <v-dialog
      v-model="resumeDialogOpen"
      max-width="420"
      data-testid="mb-resume-dialog"
    >
      <v-card>
        <v-card-title class="text-subtitle-1">
          {{ t('browserTasks.resume_with_instructions') || 'Resume with instructions' }}
        </v-card-title>
        <v-card-text>
          <input
            v-model="resumeInstructions"
            type="text"
            class="managed-browser-settings__account-select"
            data-testid="mb-resume-instructions"
            :placeholder="t('browserTasks.resume_instructions_label') || 'Instructions (optional)'"
            @keyup.enter="submitResume"
          />
        </v-card-text>
        <v-card-actions>
          <v-btn
            color="primary"
            data-testid="mb-resume-confirm"
            @click="submitResume"
          >
            {{ t('common.submit') || 'Resume' }}
          </v-btn>
          <v-btn variant="text" data-testid="mb-resume-cancel" @click="resumeDialogOpen = false">
            {{ t('common.cancel') || 'Cancel' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";

export interface BrowserBatchTaskRow {
  taskId: string;
  sessionId?: string;
  label: string;
  state:
    | "running"
    | "waiting_for_user"
    | "queued"
    | "paused"
    | "cancelling"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted"
    // W02: partial endings are their own state, never failed.
    | "partial";
}

defineProps<{
  batchId: string;
  tasks: ReadonlyArray<BrowserBatchTaskRow>;
}>();

const emit = defineEmits<{
  (event: "returnNow", batchId: string): void;
  (event: "pause", payload: { taskId: string; sessionId?: string }): void;
  (event: "takeControl", payload: { taskId: string; sessionId?: string }): void;
  (
    event: "resume",
    payload: { taskId: string; sessionId?: string; instructions?: string }
  ): void;
  (event: "stop", payload: { taskId: string; sessionId?: string }): void;
}>();

// C-FR-04/G05: the resume-with-instructions dialog.
const resumeDialogOpen = ref(false);
const resumeDialogTaskId = ref<string | null>(null);
const resumeDialogSessionId = ref<string | undefined>(undefined);
const resumeInstructions = ref("");

function openResumeDialog(task: BrowserBatchTaskRow): void {
  resumeDialogTaskId.value = task.taskId;
  resumeDialogSessionId.value = task.sessionId;
  resumeInstructions.value = "";
  resumeDialogOpen.value = true;
}

function submitResume(): void {
  if (resumeDialogTaskId.value === null) {
    return;
  }
  emit("resume", {
    taskId: resumeDialogTaskId.value,
    sessionId: resumeDialogSessionId.value,
    instructions: resumeInstructions.value,
  });
  resumeDialogTaskId.value = null;
  resumeInstructions.value = "";
  resumeDialogOpen.value = false;
}

const { t } = useI18n();

function stateLabel(state: BrowserBatchTaskRow["state"]): string {
  const map: Record<BrowserBatchTaskRow["state"], string> = {
    running: t('browserTasks.taskRunning') || "Running",
    waiting_for_user: t('browserTasks.taskWaitingForYou') || "Waiting for you",
    // W09: queued behind a busy account is a machine wait — not a user wait.
    queued: t('browserTasks.taskQueued') || "Queued",
    paused: t('browserTasks.taskPaused') || "Paused by you",
    cancelling: t('browserTasks.taskCancelled') || "Stopping",
    completed: t('browserTasks.taskCompleted') || "Completed",
    failed: t('browserTasks.taskFailed') || "Failed",
    cancelled: t('browserTasks.taskCancelled') || "Stopped",
    // W02: interrupted/partial endings are NOT failures — they carry
    // partial results (C-FR-11/12, D-FR-09).
    interrupted: t('browserTasks.taskInterrupted') || "Interrupted",
    partial: t('browserTasks.taskPartial') || "Partial",
  };
  return map[state];
}

function stateColor(state: BrowserBatchTaskRow["state"]): string {
  if (state === "completed") return "success";
  if (state === "failed" || state === "cancelled") return "error";
  if (state === "interrupted" || state === "partial") return "warning";
  if (state === "waiting_for_user") return "warning";
  if (state === "paused" || state === "queued") return "info";
  return "primary";
}
</script>
