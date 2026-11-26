<template>
  <!-- M-FR-04/W08: batch confirmation card. The parallel browser batch
       does NOT start until the user confirms the listed tasks and sites;
       the confirm grant is consumed by the start and expires with the
       batch. Renders the pending preview of THIS conversation only. -->
  <v-card class="browser-batch-confirm-card" data-testid="browser-batch-confirm" density="compact">
    <v-card-title class="text-subtitle-1">
      {{ t('browserTasks.batchConfirmTitle') || 'Confirm parallel browser tasks' }}
    </v-card-title>
    <v-card-text>
      <p class="text-body-2 mb-2">
        {{ t('browserTasks.batchConfirmHint') || 'The tasks below will each run in their own browser session.' }}
      </p>
      <v-list density="compact" data-testid="batch-confirm-tasks">
        <v-list-item v-for="task in tasks" :key="task.index">
          <v-list-item-title>{{ task.goal }}</v-list-item-title>
          <v-list-item-subtitle v-if="task.site">
            {{ task.site }}
          </v-list-item-subtitle>
        </v-list-item>
      </v-list>
    </v-card-text>
    <v-card-actions>
      <v-btn
        color="primary"
        variant="flat"
        size="small"
        data-testid="batch-confirm-start"
        @click="emit('confirmed')"
      >
        {{ t('browserTasks.batchConfirmStart') || 'Start tasks' }}
      </v-btn>
      <v-btn
        variant="text"
        size="small"
        data-testid="batch-confirm-deny"
        @click="emit('denied')"
      >
        {{ t('browserTasks.batchConfirmDeny') || 'Cancel' }}
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

export interface BrowserBatchConfirmTaskRow {
  readonly index: number;
  readonly goal: string;
  readonly site: string | null;
}

defineProps<{
  tasks: ReadonlyArray<BrowserBatchConfirmTaskRow>;
}>();

const emit = defineEmits<{
  (event: "confirmed"): void;
  (event: "denied"): void;
}>();

const { t } = useI18n();
</script>
