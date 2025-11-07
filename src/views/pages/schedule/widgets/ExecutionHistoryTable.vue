<template>
  <v-data-table
    :headers="headers"
    :items="executions"
    :loading="loading"
    :items-per-page="5"
    class="elevation-0"
    item-key="id"
  >
    <!-- Start Time Column -->
    <template v-slot:item.start_time="{ item }">
      <div class="font-weight-medium">
        {{ formatDateTime(item.start_time) }}
      </div>
    </template>

    <!-- End Time Column -->
    <template v-slot:item.end_time="{ item }">
      <div v-if="item.end_time" class="font-weight-medium">
        {{ formatDateTime(item.end_time) }}
      </div>
      <div v-else class="text-medium-emphasis">
        Running...
      </div>
    </template>

    <!-- Duration Column -->
    <template v-slot:item.duration="{ item }">
      <div v-if="item.duration" class="font-weight-medium">
        {{ formatDuration(item.duration) }}
      </div>
      <div v-else-if="item.start_time && !item.end_time" class="text-medium-emphasis">
        {{ getRunningDuration(item.start_time) }}
      </div>
      <div v-else class="text-medium-emphasis">
        -
      </div>
    </template>

    <!-- Status Column -->
    <template v-slot:item.status="{ item }">
      <ExecutionStatusBadge :status="item.status" />
    </template>

    <!-- Result Column -->
    <template v-slot:item.result="{ item }">
      <div v-if="item.result" class="text-body-2">
        {{ item.result }}
      </div>
      <div v-else class="text-medium-emphasis">
        -
      </div>
    </template>

    <!-- Error Message Column -->
    <template v-slot:item.error_message="{ item }">
      <div v-if="item.error_message" class="text-body-2 text-error">
        {{ item.error_message }}
      </div>
      <div v-else class="text-medium-emphasis">
        -
      </div>
    </template>

    <!-- Actions Column -->
    <template v-slot:item.actions="{ item }">
      <div class="d-flex align-center">
        <v-btn
          icon="mdi-eye"
          size="small"
          color="primary"
          variant="text"
          @click="viewDetails(item)"
          :title="t('home.view_details')"
        />
        <v-btn
          v-if="item.status === 'running'"
          icon="mdi-stop"
          size="small"
          color="error"
          variant="text"
          @click="cancelExecution(item)"
          :title="t('common.cancel')"
        />
      </div>
    </template>

    <!-- Loading State -->
    <template v-slot:loading>
      <v-skeleton-loader type="table-row@5"></v-skeleton-loader>
    </template>

    <!-- No Data State -->
    <template v-slot:no-data>
      <div class="text-center py-4">
        <v-icon size="48" color="grey-lighten-1">mdi-history</v-icon>
        <div class="text-h6 text-grey-lighten-1 mt-4">{{ t('schedule.execution_no_history') }}</div>
        <div class="text-body-2 text-grey-lighten-1">
          {{ t('schedule.execution_never_executed') }}
        </div>
      </div>
    </template>
  </v-data-table>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ExecutionStatusBadge from './ExecutionStatusBadge.vue'
import { ExecutionStatus } from '@/entity/ScheduleExecutionLog.entity'

// Props
interface Props {
  executions: any[]
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  loading: false
})

// Emits
const emit = defineEmits<{
  'view-details': [execution: any]
  'cancel-execution': [execution: any]
}>()

// i18n
const { t } = useI18n()

// Table headers
const headers = computed(() => [
  {
    title: t('schedule.execution_start_time'),
    key: 'start_time',
    sortable: true,
    width: '150px'
  },
  {
    title: t('schedule.execution_end_time'),
    key: 'end_time',
    sortable: true,
    width: '150px'
  },
  {
    title: t('schedule.execution_duration'),
    key: 'duration',
    sortable: true,
    width: '100px'
  },
  {
    title: t('common.status'),
    key: 'status',
    sortable: true,
    width: '100px'
  },
  {
    title: t('schedule.execution_result'),
    key: 'result',
    sortable: false,
    width: '200px'
  },
  {
    title: t('schedule.execution_error'),
    key: 'error_message',
    sortable: false,
    width: '200px'
  },
  {
    title: t('common.actions'),
    key: 'actions',
    sortable: false,
    width: '80px'
  }
])

// Methods
const formatDateTime = (dateString: string): string => {
  const date = new Date(dateString)
  return date.toLocaleString()
}

const formatDuration = (durationMs: number): string => {
  const seconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  } else {
    return `${seconds}s`
  }
}

const getRunningDuration = (startTime: string): string => {
  const start = new Date(startTime)
  const now = new Date()
  const duration = now.getTime() - start.getTime()
  return formatDuration(duration)
}

const viewDetails = (execution: any) => {
  emit('view-details', execution)
}

const cancelExecution = (execution: any) => {
  emit('cancel-execution', execution)
}
</script>

<style scoped>
.v-data-table {
  border-radius: 8px;
}

.v-data-table :deep(.v-data-table-header) {
  background-color: #f5f5f5;
}

.v-data-table :deep(.v-data-table-header th) {
  font-weight: 600;
  color: #424242;
}
</style> 