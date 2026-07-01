<template>
  <v-menu
    :close-on-content-click="false"
    location="bottom end"
    offset="4"
    @update:model-value="onToggle"
  >
    <template v-slot:activator="{ props: menuProps }">
      <v-btn
        v-bind="menuProps"
        icon
        size="small"
        variant="text"
        :title="t('aiChatV2.agent_task_list') || 'Background Agents'"
      >
        <v-icon size="small">mdi-account-group</v-icon>
      </v-btn>
    </template>

    <v-card min-width="380" max-width="500" max-height="520">
      <v-card-title class="d-flex align-center text-body-2 font-weight-bold pa-3">
        <v-icon class="mr-2" size="small">mdi-account-group</v-icon>
        {{ t("agentTaskList.title") || "Background Agents" }}
        <v-spacer />
        <v-btn
          icon
          size="x-small"
          variant="text"
          :loading="loading"
          @click="refresh"
          :title="t('agentTaskList.refresh') || 'Refresh'"
        >
          <v-icon size="small">mdi-refresh</v-icon>
        </v-btn>
      </v-card-title>
      <v-divider />
      <div style="max-height: 400px; overflow-y: auto">
        <v-progress-linear
          v-if="loading"
          indeterminate
          color="primary"
          height="2"
        />
        <div v-else-if="tasks.length === 0" class="pa-6 text-center text-grey">
          <v-icon size="40" color="grey-lighten-2">mdi-robot-off</v-icon>
          <p class="mt-2 text-caption">
            {{ t("agentTaskList.no_tasks") || "No agent tasks yet" }}
          </p>
        </div>
        <v-list v-else density="compact">
          <v-list-item
            v-for="task in sortedTasks"
            :key="task.agentTaskId"
            class="agent-task-item"
          >
            <template v-slot:prepend>
              <v-icon :color="statusColor(task.status)" size="x-small">
                {{ statusIcon(task.status) }}
              </v-icon>
            </template>
            <v-list-item-title class="text-caption font-weight-medium">
              {{ agentName(task.agentId) }}
            </v-list-item-title>
            <v-list-item-subtitle class="d-flex align-center ga-1 text-caption">
              <v-chip
                :color="statusColor(task.status)"
                size="x-small"
                variant="tonal"
                label
              >
                {{ statusLabel(task.status) }}
              </v-chip>
              <span v-if="task.startedAt" class="text-grey">
                {{ formatTime(task.startedAt) }}
              </span>
              <span
                v-if="task.toolCallsCount > 0"
                class="text-grey"
              >
                <v-icon size="10" class="mr-1">mdi-toolbox</v-icon>
                {{ task.toolCallsCount }}
              </span>
            </v-list-item-subtitle>
            <template v-slot:append>
              <v-btn
                v-if="task.status === 'running'"
                icon
                size="x-small"
                variant="text"
                color="warning"
                :title="t('agentTaskList.cancel') || 'Cancel'"
                @click.stop="emit('cancel-task', task.agentTaskId)"
              >
                <v-icon size="x-small">mdi-stop-circle-outline</v-icon>
              </v-btn>
            </template>
          </v-list-item>
        </v-list>
      </div>
    </v-card>
  </v-menu>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import type { AgentTaskSnapshot, AgentDefinitionView } from "@/entityTypes/agentTypes";
import { listAgentTasks, listAgentDefinitions } from "@/views/api/agentRuntime";

const emit = defineEmits<{
  (e: "cancel-task", agentTaskId: string): void;
}>();

const { t } = useI18n();

const loading = ref(false);
const tasks = ref<AgentTaskSnapshot[]>([]);
const definitions = ref<AgentDefinitionView[]>([]);
let pollTimer: ReturnType<typeof setInterval> | null = null;

const agentNameMap = computed(() => {
  const map = new Map<string, string>();
  for (const d of definitions.value) {
    map.set(d.id, d.name);
  }
  return map;
});

function agentName(agentId: string): string {
  return agentNameMap.value.get(agentId) ?? agentId;
}

const statusLabels: Record<string, string> = {
  queued: t("agentTaskList.status_queued") || "Queued",
  running: t("agentTaskList.status_running") || "Running",
  waiting_policy: t("agentTaskList.status_waiting_policy") || "Waiting Policy",
  waiting_user: t("agentTaskList.status_waiting_user") || "Waiting User",
  completed: t("agentTaskList.status_completed") || "Completed",
  failed: t("agentTaskList.status_failed") || "Failed",
  cancelled: t("agentTaskList.status_cancelled") || "Cancelled",
  timeout: t("agentTaskList.status_timeout") || "Timeout",
};

function statusLabel(status: string): string {
  return statusLabels[status] ?? status;
}

function statusColor(status: string): string {
  switch (status) {
    case "running":
    case "queued":
      return "primary";
    case "waiting_policy":
    case "waiting_user":
      return "warning";
    case "completed":
      return "success";
    case "failed":
    case "timeout":
      return "error";
    case "cancelled":
      return "grey";
    default:
      return "grey";
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case "queued":
      return "mdi-clock-outline";
    case "running":
      return "mdi-loading mdi-spin";
    case "waiting_policy":
    case "waiting_user":
      return "mdi-pause-circle-outline";
    case "completed":
      return "mdi-check-circle-outline";
    case "failed":
      return "mdi-alert-circle-outline";
    case "cancelled":
      return "mdi-cancel";
    case "timeout":
      return "mdi-timer-off-outline";
    default:
      return "mdi-help-circle-outline";
  }
}

const sortedTasks = computed(() => {
  const priority: Record<string, number> = {
    running: 0,
    queued: 1,
    waiting_policy: 2,
    waiting_user: 3,
    completed: 10,
    failed: 11,
    cancelled: 12,
    timeout: 13,
  };
  return [...tasks.value].sort((a, b) => {
    const pa = priority[a.status] ?? 99;
    const pb = priority[b.status] ?? 99;
    if (pa !== pb) return pa - pb;
    const ta = a.startedAt ? new Date(a.startedAt).getTime() : 0;
    const tb = b.startedAt ? new Date(b.startedAt).getTime() : 0;
    return tb - ta;
  });
});

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    if (diffMs < 60000) return t("agentTaskList.just_now") || "just now";
    if (diffMs < 3600000) {
      const min = Math.floor(diffMs / 60000);
      return `${min}m ago`;
    }
    if (diffMs < 86400000) {
      const hr = Math.floor(diffMs / 3600000);
      return `${hr}h ago`;
    }
    return d.toLocaleDateString();
  } catch {
    return "";
  }
}

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const [taskList, defList] = await Promise.all([
      listAgentTasks(50),
      listAgentDefinitions(),
    ]);
    tasks.value = taskList;
    definitions.value = defList;
  } catch {
    // silent
  } finally {
    loading.value = false;
  }
}

function onToggle(open: boolean): void {
  if (open) {
    void refresh();
    pollTimer = setInterval(() => void refresh(), 5000);
  } else {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }
}

onBeforeUnmount(() => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
});
</script>

<style scoped>
.agent-task-item + .agent-task-item {
  border-top: 1px solid rgba(var(--v-border-color), 0.06);
}
</style>
