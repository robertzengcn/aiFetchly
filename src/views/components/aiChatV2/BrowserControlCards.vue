<template>
  <!-- F21: live browser-batch control card. Renders nothing while no
       batch is running (finished batches linger briefly for review). -->
  <BrowserTaskBatchCard
    v-if="activeBatch !== null"
    :batch-id="activeBatch.batchId"
    :tasks="activeBatch.tasks"
    @return-now="onReturnNow"
    @pause="onPause"
    @resume="onResume"
    @stop="onStop"
  />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import BrowserTaskBatchCard from "./BrowserTaskBatchCard.vue";
import {
  browserBatchReturnNow,
  onManagedBrowserBatchEvent,
  pauseBrowserTask,
  resumeBrowserTask,
  stopBrowserTask,
  type BrowserBatchEvent,
} from "@/views/api/managedBrowser";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

interface BrowserBatchTaskRow {
  taskId: string;
  label: string;
  state:
    | "running"
    | "waiting_for_user"
    | "paused"
    | "cancelling"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted";
  summary?: string;
}

interface BatchState {
  batchId: string;
  tasks: BrowserBatchTaskRow[];
  finishedAt: number | null;
}

const activeBatch = ref<BatchState | null>(null);
const finishedBatches = new Map<string, number>();

const LABEL_FALLBACK = "Browser task";

function applyEvent(event: BrowserBatchEvent): void {
  if (event.phase === "started") {
    finishedBatches.delete(event.batchId);
    activeBatch.value = {
      batchId: event.batchId,
      tasks: [],
      finishedAt: null,
    };
    return;
  }
  if (event.phase === "task") {
    if (activeBatch.value?.batchId !== event.batchId || !event.taskId) {
      return;
    }
    const tasks = activeBatch.value.tasks;
    const existing = tasks.find((task) => task.taskId === event.taskId);
    const row: BrowserBatchTaskRow = {
      taskId: event.taskId,
      label:
        event.label ??
        `${t("browserTasks.taskRunning") || LABEL_FALLBACK} ${event.taskId}`,
      state: event.state ?? "running",
      summary: event.summary,
    };
    if (existing) {
      Object.assign(existing, row);
    } else {
      tasks.push(row);
    }
    return;
  }
  if (event.phase === "finished" && activeBatch.value?.batchId === event.batchId) {
    activeBatch.value.finishedAt = Date.now();
    finishedBatches.set(event.batchId, Date.now());
  }
}

let unsubscribe: (() => void) | null = null;
let pruneTimer: number | null = null;

onMounted(() => {
  unsubscribe = onManagedBrowserBatchEvent(applyEvent);
  pruneTimer = window.setInterval(() => {
    // Finished batches linger 30s for review, then the card disappears.
    for (const [batchId, finishedAt] of finishedBatches) {
      if (Date.now() - finishedAt > 30_000) {
        finishedBatches.delete(batchId);
        if (activeBatch.value?.batchId === batchId) {
          activeBatch.value = null;
        }
      }
    }
  }, 5_000);
});

onBeforeUnmount(() => {
  unsubscribe?.();
  if (pruneTimer !== null) {
    window.clearInterval(pruneTimer);
  }
});

async function onReturnNow(batchId: string): Promise<void> {
  await browserBatchReturnNow({ batchId });
}

async function onPause(payload: { taskId: string; sessionId?: string }): Promise<void> {
  await pauseBrowserTask(payload);
}

async function onResume(payload: { taskId: string; sessionId?: string }): Promise<void> {
  await resumeBrowserTask(payload);
}

async function onStop(payload: { taskId: string; sessionId?: string }): Promise<void> {
  await stopBrowserTask(payload);
}
</script>
