<template>
  <v-data-table
    :headers="headers"
    :items="schedules"
    :loading="loading"
    :items-per-page="10"
    class="elevation-1"
    item-key="id"
  >
    <!-- Name Column -->
    <template v-slot:item.name="{ item }">
      <div class="d-flex align-center">
        <v-icon class="mr-2" :color="getTaskTypeColor(item.task_type)">
          {{ getTaskTypeIcon(item.task_type) }}
        </v-icon>
        <div>
          <div class="font-weight-medium">{{ item.name }}</div>
          <div class="text-caption text-medium-emphasis">{{ item.description }}</div>
        </div>
      </div>
    </template>

    <!-- Task Type Column -->
    <template v-slot:item.task_type="{ item }">
      <v-chip
        :color="getTaskTypeColor(item.task_type)"
        size="small"
        variant="outlined"
      >
        {{ getTaskTypeLabel(item.task_type) }}
      </v-chip>
    </template>

    <!-- Status Column -->
    <template v-slot:item.status="{ item }">
      <ScheduleStatusBadge :status="item.status" />
    </template>

    <!-- Trigger Type Column -->
    <template v-slot:item.trigger_type="{ item }">
      <v-chip
        :color="getTriggerTypeColor(item.trigger_type)"
        size="small"
        variant="outlined"
      >
        {{ getTriggerTypeLabel(item.trigger_type) }}
      </v-chip>
    </template>

    <!-- Cron Expression Column -->
    <template v-slot:item.cron_expression="{ item }">
      <div v-if="item.trigger_type === 'cron'" class="font-family-mono">
        {{ item.cron_expression }}
      </div>
      <div v-else class="text-medium-emphasis">
        {{ getTriggerTypeDescription(item.trigger_type) }}
      </div>
    </template>

    <!-- Next Run Time Column -->
    <template v-slot:item.next_run_time="{ item }">
      <div v-if="item.next_run_time">
        <div class="font-weight-medium">
          {{ formatDateTime(item.next_run_time) }}
        </div>
        <div class="text-caption text-medium-emphasis">
          {{ getTimeUntilNextRun(item.next_run_time) }}
        </div>
      </div>
      <div v-else class="text-medium-emphasis">
        Not scheduled
      </div>
    </template>

    <!-- Last Run Time Column -->
    <template v-slot:item.last_run_time="{ item }">
      <div v-if="item.last_run_time">
        <div class="font-weight-medium">
          {{ formatDateTime(item.last_run_time) }}
        </div>
        <div class="text-caption text-medium-emphasis">
          {{ getTimeSinceLastRun(item.last_run_time) }}
        </div>
      </div>
      <div v-else class="text-medium-emphasis">
        Never run
      </div>
    </template>

    <!-- Execution Count Column -->
    <template v-slot:item.execution_count="{ item }">
      <div class="d-flex align-center">
        <v-icon class="mr-1" color="success" size="small">mdi-check-circle</v-icon>
        <span class="font-weight-medium">{{ item.execution_count }}</span>
        <v-divider vertical class="mx-2"></v-divider>
        <v-icon class="mr-1" color="error" size="small">mdi-close-circle</v-icon>
        <span class="font-weight-medium">{{ item.failure_count }}</span>
      </div>
    </template>

    <!-- Actions Column -->
    <template v-slot:item.actions="{ item }">
      <div class="d-flex align-center">
        <!-- View Details -->
        <v-btn
          icon="mdi-eye"
          size="small"
          color="primary"
          variant="text"
          @click="$emit('view-details', item.id)"
          title="View Details"
        />

        <!-- Edit -->
        <v-btn
          icon="mdi-pencil"
          size="small"
          color="secondary"
          variant="text"
          @click="$emit('edit', item.id)"
          title="Edit Schedule"
        />

        <!-- Run Now -->
        <v-btn
          icon="mdi-play"
          size="small"
          color="success"
          variant="text"
          @click="$emit('run-now', item.id)"
          title="Run Now"
          :disabled="!item.is_active"
        />

        <!-- Status Actions -->
        <v-menu>
          <template v-slot:activator="{ props }">
            <v-btn
              icon="mdi-dots-vertical"
              size="small"
              color="grey"
              variant="text"
              v-bind="props"
              title="More Actions"
            />
          </template>
          <v-list>
            <!-- Enable/Disable -->
            <v-list-item
              v-if="item.is_active"
              @click="$emit('disable', item.id)"
              prepend-icon="mdi-pause"
            >
              <v-list-item-title>Disable</v-list-item-title>
            </v-list-item>
            <v-list-item
              v-else
              @click="$emit('enable', item.id)"
              prepend-icon="mdi-play"
            >
              <v-list-item-title>Enable</v-list-item-title>
            </v-list-item>

            <!-- Pause/Resume -->
            <v-list-item
              v-if="item.status === 'active'"
              @click="$emit('pause', item.id)"
              prepend-icon="mdi-pause-circle"
            >
              <v-list-item-title>Pause</v-list-item-title>
            </v-list-item>
            <v-list-item
              v-else-if="item.status === 'paused'"
              @click="$emit('resume', item.id)"
              prepend-icon="mdi-play-circle"
            >
              <v-list-item-title>Resume</v-list-item-title>
            </v-list-item>

            <v-divider></v-divider>

            <!-- Delete -->
            <v-list-item
              @click="$emit('delete', item.id)"
              prepend-icon="mdi-delete"
              color="error"
            >
              <v-list-item-title>Delete</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>
    </template>

    <!-- Loading State -->
    <template v-slot:loading>
      <v-skeleton-loader type="table-row@10"></v-skeleton-loader>
    </template>

    <!-- No Data State -->
    <template v-slot:no-data>
      <div class="text-center py-8">
        <v-icon size="64" color="grey-lighten-1">mdi-clock-outline</v-icon>
        <div class="text-h6 text-grey-lighten-1 mt-4">No schedules found</div>
        <div class="text-body-2 text-grey-lighten-1">
          Create your first schedule to get started
        </div>
      </div>
    </template>
  </v-data-table>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ScheduleStatusBadge from './ScheduleStatusBadge.vue'
import { TaskType, ScheduleStatus, TriggerType } from '@/entity/ScheduleTask.entity'

// Props
interface Props {
  schedules: any[]
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  loading: false
})

// Emits
const emit = defineEmits<{
  edit: [id: number]
  delete: [id: number]
  enable: [id: number]
  disable: [id: number]
  pause: [id: number]
  resume: [id: number]
  'run-now': [id: number]
  'view-details': [id: number]
}>()

// Table headers
const headers = computed(() => [
  {
    title: 'Name',
    key: 'name',
    sortable: true,
    width: '250px'
  },
  {
    title: 'Task Type',
    key: 'task_type',
    sortable: true,
    width: '120px'
  },
  {
    title: 'Status',
    key: 'status',
    sortable: true,
    width: '100px'
  },
  {
    title: 'Trigger',
    key: 'trigger_type',
    sortable: true,
    width: '100px'
  },
  {
    title: 'Schedule',
    key: 'cron_expression',
    sortable: false,
    width: '150px'
  },
  {
    title: 'Next Run',
    key: 'next_run_time',
    sortable: true,
    width: '150px'
  },
  {
    title: 'Last Run',
    key: 'last_run_time',
    sortable: true,
    width: '150px'
  },
  {
    title: 'Executions',
    key: 'execution_count',
    sortable: true,
    width: '100px'
  },
  {
    title: 'Actions',
    key: 'actions',
    sortable: false,
    width: '120px'
  }
])

// Utility functions
const getTaskTypeColor = (taskType: TaskType): string => {
  switch (taskType) {
    case TaskType.SEARCH: return 'blue'
    case TaskType.EMAIL_MARKETING: return 'green'
    case TaskType.BULK_EMAIL: return 'orange'
    case TaskType.VIDEO_DOWNLOAD: return 'purple'
    case TaskType.SOCIAL_TASK: return 'pink'
    default: return 'grey'
  }
}

const getTaskTypeIcon = (taskType: TaskType): string => {
  switch (taskType) {
    case TaskType.SEARCH: return 'mdi-magnify'
    case TaskType.EMAIL_MARKETING: return 'mdi-email-multiple'
    case TaskType.BULK_EMAIL: return 'mdi-email-send'
    case TaskType.VIDEO_DOWNLOAD: return 'mdi-download'
    case TaskType.SOCIAL_TASK: return 'mdi-share-variant'
    default: return 'mdi-cog'
  }
}

const getTaskTypeLabel = (taskType: TaskType): string => {
  switch (taskType) {
    case TaskType.SEARCH: return 'Search'
    case TaskType.EMAIL_MARKETING: return 'Email Marketing'
    case TaskType.BULK_EMAIL: return 'Bulk Email'
    case TaskType.VIDEO_DOWNLOAD: return 'Video Download'
    case TaskType.SOCIAL_TASK: return 'Social Task'
    default: return 'Unknown'
  }
}

const getTriggerTypeColor = (triggerType: TriggerType): string => {
  switch (triggerType) {
    case TriggerType.CRON: return 'primary'
    case TriggerType.DEPENDENCY: return 'secondary'
    case TriggerType.MANUAL: return 'grey'
    default: return 'grey'
  }
}

const getTriggerTypeLabel = (triggerType: TriggerType): string => {
  switch (triggerType) {
    case TriggerType.CRON: return 'Cron'
    case TriggerType.DEPENDENCY: return 'Dependency'
    case TriggerType.MANUAL: return 'Manual'
    default: return 'Unknown'
  }
}

const getTriggerTypeDescription = (triggerType: TriggerType): string => {
  switch (triggerType) {
    case TriggerType.DEPENDENCY: return 'Triggered by parent job'
    case TriggerType.MANUAL: return 'Manual execution only'
    default: return ''
  }
}

const formatDateTime = (dateString: string): string => {
  const date = new Date(dateString)
  return date.toLocaleString()
}

const getTimeUntilNextRun = (dateString: string): string => {
  const now = new Date()
  const nextRun = new Date(dateString)
  const diff = nextRun.getTime() - now.getTime()
  
  if (diff <= 0) return 'Overdue'
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  
  if (days > 0) return `in ${days}d ${hours}h`
  if (hours > 0) return `in ${hours}h ${minutes}m`
  return `in ${minutes}m`
}

const getTimeSinceLastRun = (dateString: string): string => {
  const now = new Date()
  const lastRun = new Date(dateString)
  const diff = now.getTime() - lastRun.getTime()
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  
  if (days > 0) return `${days}d ${hours}h ago`
  if (hours > 0) return `${hours}h ${minutes}m ago`
  return `${minutes}m ago`
}
</script>

<style scoped>
.font-family-mono {
  font-family: 'Courier New', monospace;
  font-size: 0.875rem;
}

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