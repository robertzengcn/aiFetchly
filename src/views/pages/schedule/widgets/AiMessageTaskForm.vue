<template>
  <v-container fluid>
    <v-row>
      <v-col cols="12">
        <v-select
          v-model="selectedTaskId"
          :items="taskItems"
          item-title="name"
          item-value="id"
          :label="t('schedule.ai_message_task') || 'AI Message Task'"
          density="compact"
          variant="outlined"
          clearable
          @update:model-value="handleTaskSelected"
        />
      </v-col>
    </v-row>
    <v-row v-if="selectedTask">
      <v-col cols="12">
        <v-card variant="outlined" class="pa-3">
          <div class="text-subtitle-2 mb-1">{{ selectedTask.name }}</div>
          <div class="text-body-2 text-medium-emphasis">{{ selectedTask.message }}</div>
          <div v-if="selectedTask.model" class="text-caption mt-1">Model: {{ selectedTask.model }}</div>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useI18n } from "vue-i18n";
import { listAiMessageTasks } from "@/views/api/aiMessageTask";

const { t } = useI18n();
const emit = defineEmits<{
  (e: "change", taskId: number | undefined): void;
}>();

interface TaskItem {
  id: number;
  name: string;
  message: string;
  model: string;
}

const tasks = ref<TaskItem[]>([]);
const selectedTaskId = ref<number | undefined>(undefined);

const taskItems = computed(() =>
  tasks.value.filter((task) => task.id !== undefined)
);

const selectedTask = computed(() =>
  tasks.value.find((task) => task.id === selectedTaskId.value)
);

function handleTaskSelected(taskId: number | undefined): void {
  emit("change", taskId);
}

onMounted(async () => {
  try {
    const result = await listAiMessageTasks(1, 200);
    tasks.value = (result.items as TaskItem[]) ?? [];
  } catch (error) {
    console.error("Failed to load AI message tasks:", error);
  }
});
</script>
