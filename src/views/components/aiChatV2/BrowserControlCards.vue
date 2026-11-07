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
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
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
  conversationId: string;
  tasks: BrowserBatchTaskRow[];
  finishedAt: number | null;
}

// P1/M-FR-08: MULTIPLE batches are retained — starting batch B never
// discards running batch A. The card shows the newest UNFINISHED batch of
// the ACTIVE conversation only (never another chat's rows).
const props = defineProps<{ conversationId: string | null }>();
const batches = ref(new Map<string, BatchState>());

const activeBatch = computed<BatchState | null>(() => {
  let newest: BatchState | null = null;
  for (const batch of batches.value.values()) {
    // A missing conversation prop (null/undefined) disables the filter.
    if (props.conversationId != null && batch.conversationId !== props.conversationId) {
      continue;
    }
    if (batch.finishedAt !== null) {
      continue;
    }
    if (newest === null) {
      newest = batch;
    }
  }
  return newest;
});
const finishedBatches = new Map<string, number>();

const LABEL_FALLBACK = "Browser task";

function applyEvent(event: BrowserBatchEvent): void {
  if (event.phase === "started") {
    finishedBatches.delete(event.batchId);
    batches.value.set(event.batchId, {
      batchId: event.batchId,
      conversationId: event.conversationId,
      tasks: [],
      finishedAt: null,
    });
    return;
  }
  if (event.phase === "task") {
    const batch = batches.value.get(event.batchId);
    if (!batch || !event.taskId) {
      return;
    }
    const tasks = batch.tasks;
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
  if (event.phase === "finished" && batches.value.has(event.batchId)) {
    const batch = batches.value.get(event.batchId)!;
    batch.finishedAt = Date.now();
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
        batches.value.delete(batchId);
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
