<template>
  <v-container fluid>
    <!-- Header -->
    <v-row class="mb-4">
      <v-col cols="12">
        <div class="d-flex align-center justify-space-between">
          <div class="d-flex align-center">
            <v-btn
              icon="mdi-arrow-left"
              variant="text"
              @click="goBack"
              class="mr-4"
            />
            <div>
              <h2 class="text-h4 font-weight-bold">
                <v-icon class="mr-2">mdi-eye</v-icon>
                Schedule Details
              </h2>
              <p class="text-subtitle-1 text-medium-emphasis">
                {{ schedule?.name || 'Loading...' }}
              </p>
            </div>
          </div>
          <div class="d-flex">
            <v-btn
              color="primary"
              prepend-icon="mdi-pencil"
              @click="editSchedule"
              class="mr-2"
            >
              Edit
            </v-btn>
            <v-btn
              color="success"
              prepend-icon="mdi-play"
              @click="runScheduleNow"
              :loading="running"
              :disabled="!schedule?.is_active"
            >
              Run Now
            </v-btn>
          </div>
        </div>
      </v-col>
    </v-row>

    <!-- Loading State -->
    <v-row v-if="loading && !schedule">
      <v-col cols="12">
        <v-card>
          <v-card-text class="text-center py-8">
            <v-progress-circular
              indeterminate
              color="primary"
              size="64"
            />
            <div class="text-h6 mt-4">Loading schedule...</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Error State -->
    <v-row v-else-if="error">
      <v-col cols="12">
        <v-card>
          <v-card-text class="text-center py-8">
            <v-icon size="64" color="error" class="mb-4">mdi-alert-circle</v-icon>
            <div class="text-h6 text-error mb-2">Failed to load schedule</div>
            <div class="text-body-2 text-medium-emphasis mb-4">{{ error }}</div>
            <v-btn
              color="primary"
              @click="loadSchedule"
            >
              Retry
            </v-btn>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Schedule Details -->
    <v-row v-else-if="schedule">
      <!-- Basic Information -->
      <v-col cols="12" md="8">
        <v-card class="mb-4">
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-information</v-icon>
            Basic Information
          </v-card-title>
          <v-card-text>
            <v-row>
              <v-col cols="12" md="6">
                <div class="mb-3">
                  <div class="text-caption text-medium-emphasis">Name</div>
                  <div class="text-body-1 font-weight-medium">{{ schedule.name }}</div>
                </div>
                <div class="mb-3">
                  <div class="text-caption text-medium-emphasis">Description</div>
                  <div class="text-body-1">{{ schedule.description || 'No description' }}</div>
                </div>
                <div class="mb-3">
                  <div class="text-caption text-medium-emphasis">Task Type</div>
                  <v-chip
                    :color="getTaskTypeColor(schedule.task_type)"
                    size="small"
                    variant="outlined"
                  >
                    {{ getTaskTypeLabel(schedule.task_type) }}
                  </v-chip>
                </div>
                <div class="mb-3">
                  <div class="text-caption text-medium-emphasis">Task ID</div>
                  <div class="text-body-1 font-weight-medium">{{ schedule.task_id }}</div>
                </div>
              </v-col>
              <v-col cols="12" md="6">
                <div class="mb-3">
                  <div class="text-caption text-medium-emphasis">Status</div>
                  <ScheduleStatusBadge :status="schedule.status" />
                </div>
                <div class="mb-3">
                  <div class="text-caption text-medium-emphasis">Active</div>
                  <v-switch
                    :model-value="schedule.is_active"
                    :disabled="true"
                    color="success"
                    hide-details
                  />
                </div>
                <div class="mb-3">
                  <div class="text-caption text-medium-emphasis">Trigger Type</div>
                  <v-chip
                    :color="getTriggerTypeColor(schedule.trigger_type)"
                    size="small"
                    variant="outlined"
                  >
                    {{ getTriggerTypeLabel(schedule.trigger_type) }}
                  </v-chip>
                </div>
                <div class="mb-3">
                  <div class="text-caption text-medium-emphasis">Created</div>
                  <div class="text-body-1">{{ formatDateTime(schedule.created_at) }}</div>
                </div>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>

        <!-- Schedule Configuration -->
        <v-card class="mb-4">
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-cog</v-icon>
            Schedule Configuration
          </v-card-title>
          <v-card-text>
            <v-row>
              <v-col cols="12" md="6">
                <div class="mb-3">
                  <div class="text-caption text-medium-emphasis">Cron Expression</div>
                  <div v-if="schedule.trigger_type === 'cron'" class="font-family-mono text-body-1">
                    {{ schedule.cron_expression }}
                  </div>
                  <div v-else class="text-body-1 text-medium-emphasis">
                    Not applicable
                  </div>
                </div>
                <div class="mb-3">
                  <div class="text-caption text-medium-emphasis">Next Run Time</div>
                  <div class="text-body-1 font-weight-medium">
                    {{ schedule.next_run_time ? formatDateTime(schedule.next_run_time) : 'Not scheduled' }}
                  </div>
                </div>
              </v-col>
              <v-col cols="12" md="6">
                <div class="mb-3">
                  <div class="text-caption text-medium-emphasis">Last Run Time</div>
                  <div class="text-body-1">
                    {{ schedule.last_run_time ? formatDateTime(schedule.last_run_time) : 'Never run' }}
                  </div>
                </div>
                <div class="mb-3">
                  <div class="text-caption text-medium-emphasis">Execution Count</div>
                  <div class="d-flex align-center">
                    <v-icon class="mr-1" color="success" size="small">mdi-check-circle</v-icon>
                    <span class="font-weight-medium">{{ schedule.execution_count }}</span>
                    <v-divider vertical class="mx-2"></v-divider>
                    <v-icon class="mr-1" color="error" size="small">mdi-close-circle</v-icon>
                    <span class="font-weight-medium">{{ schedule.failure_count }}</span>
                  </div>
                </div>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>

        <!-- Execution History -->
        <v-card>
          <v-card-title class="d-flex align-center justify-space-between">
            <div class="d-flex align-center">
              <v-icon class="mr-2">mdi-history</v-icon>
              Execution History
            </div>
            <v-btn
              size="small"
              variant="outlined"
              @click="loadExecutionHistory"
              :loading="loadingHistory"
            >
              Refresh
            </v-btn>
          </v-card-title>
          <v-card-text>
            <ExecutionHistoryTable
              :executions="executionHistory"
              :loading="loadingHistory"
            />
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Sidebar -->
      <v-col cols="12" md="4">
        <!-- Dependencies -->
        <v-card class="mb-4">
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-link-variant</v-icon>
            Dependencies
          </v-card-title>
          <v-card-text>
            <div v-if="dependencies.children.length === 0 && dependencies.parents.length === 0">
              <div class="text-center py-4">
                <v-icon size="48" color="grey-lighten-1">mdi-link-off</v-icon>
                <div class="text-body-2 text-grey-lighten-1 mt-2">No dependencies</div>
              </div>
            </div>
            <div v-else>
              <!-- Child Dependencies -->
              <div v-if="dependencies.children.length > 0" class="mb-4">
                <div class="text-caption text-medium-emphasis mb-2">Triggers these schedules:</div>
                <v-list density="compact">
                  <v-list-item
                    v-for="dep in dependencies.children"
                    :key="dep.id"
                    :title="dep.child_schedule_name"
                    :subtitle="`${getDependencyConditionLabel(dep.dependency_condition)}${dep.delay_minutes > 0 ? ` (+${dep.delay_minutes}m)` : ''}`"
                    prepend-icon="mdi-arrow-right"
                  />
                </v-list>
              </div>

              <!-- Parent Dependencies -->
              <div v-if="dependencies.parents.length > 0">
                <div class="text-caption text-medium-emphasis mb-2">Triggered by:</div>
                <v-list density="compact">
                  <v-list-item
                    v-for="dep in dependencies.parents"
                    :key="dep.id"
                    :title="dep.parent_schedule_name"
                    :subtitle="`${getDependencyConditionLabel(dep.dependency_condition)}${dep.delay_minutes > 0 ? ` (+${dep.delay_minutes}m)` : ''}`"
                    prepend-icon="mdi-arrow-left"
                  />
                </v-list>
              </div>
            </div>
          </v-card-text>
        </v-card>

        <!-- Statistics -->
        <v-card class="mb-4">
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-chart-line</v-icon>
            Statistics
          </v-card-title>
          <v-card-text>
            <div class="mb-3">
              <div class="text-caption text-medium-emphasis">Success Rate</div>
              <div class="text-h6 font-weight-bold">
                {{ successRate }}%
              </div>
            </div>
            <div class="mb-3">
              <div class="text-caption text-medium-emphasis">Average Duration</div>
              <div class="text-h6 font-weight-bold">
                {{ averageDuration }}
              </div>
            </div>
            <div class="mb-3">
              <div class="text-caption text-medium-emphasis">Last Error</div>
              <div class="text-body-2">
                {{ schedule.last_error_message || 'No errors' }}
              </div>
            </div>
          </v-card-text>
        </v-card>

        <!-- Quick Actions -->
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-lightning-bolt</v-icon>
            Quick Actions
          </v-card-title>
          <v-card-text>
            <v-btn
              block
              color="primary"
              variant="outlined"
              prepend-icon="mdi-pencil"
              @click="editSchedule"
              class="mb-2"
            >
              Edit Schedule
            </v-btn>
            <v-btn
              block
              color="success"
              variant="outlined"
              prepend-icon="mdi-play"
              @click="runScheduleNow"
              :loading="running"
              :disabled="!schedule.is_active"
              class="mb-2"
            >
              Run Now
            </v-btn>
            <v-btn
              block
              color="warning"
              variant="outlined"
              prepend-icon="mdi-pause"
              @click="pauseSchedule"
              v-if="schedule.status === 'active'"
              class="mb-2"
            >
              Pause
            </v-btn>
            <v-btn
              block
              color="info"
              variant="outlined"
              prepend-icon="mdi-play"
              @click="resumeSchedule"
              v-if="schedule.status === 'paused'"
              class="mb-2"
            >
              Resume
            </v-btn>
            <v-btn
              block
              color="error"
              variant="outlined"
              prepend-icon="mdi-delete"
              @click="deleteSchedule"
            >
              Delete
            </v-btn>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Alert Dialog -->
    <v-dialog v-model="alertDialog.show" max-width="400">
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon :color="alertDialog.type" class="mr-2">
            {{ getAlertIcon(alertDialog.type) }}
          </v-icon>
          {{ alertDialog.title }}
        </v-card-title>
        <v-card-text>{{ alertDialog.message }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            color="primary"
            @click="handleAlertAction"
          >
            {{ alertDialog.actionText }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Confirmation Dialog -->
    <v-dialog v-model="confirmDialog.show" max-width="400">
      <v-card>
        <v-card-title>{{ confirmDialog.title }}</v-card-title>
        <v-card-text>{{ confirmDialog.message }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn color="secondary" @click="confirmDialog.show = false">Cancel</v-btn>
          <v-btn color="error" @click="confirmAction">Confirm</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ScheduleStatusBadge from './widgets/ScheduleStatusBadge.vue'
import ExecutionHistoryTable from './widgets/ExecutionHistoryTable.vue'
import {
  getScheduleById,
  runScheduleNow as runScheduleNowApi,
  pauseSchedule as pauseScheduleApi,
  resumeSchedule as resumeScheduleApi,
  deleteSchedule as deleteScheduleApi,
  getExecutionHistory
} from '@/views/api/schedule'
import { TaskType, TriggerType, DependencyCondition } from '@/entity/ScheduleTask.entity'

const route = useRoute()
const router = useRouter()

// Reactive data
const schedule = ref<any>(null)
const loading = ref(false)
const running = ref(false)
const error = ref('')
const executionHistory = ref<any[]>([])
const loadingHistory = ref(false)
const dependencies = ref({
  children: [],
  parents: []
})

// Dialogs
const alertDialog = ref({
  show: false,
  title: '',
  message: '',
  type: 'info' as 'success' | 'error' | 'warning' | 'info',
  actionText: 'OK',
  action: null as (() => void) | null
})

const confirmDialog = ref({
  show: false,
  title: '',
  message: '',
  action: null as (() => Promise<void>) | null
})

// Computed properties
const successRate = computed(() => {
  if (!schedule.value) return 0
  const total = schedule.value.execution_count + schedule.value.failure_count
  if (total === 0) return 0
  return Math.round((schedule.value.execution_count / total) * 100)
})

const averageDuration = computed(() => {
  // This would come from execution statistics
  return '2m 30s'
})

// Methods
const loadSchedule = async () => {
  const scheduleId = Number(route.params.id)
  
  if (!scheduleId || isNaN(scheduleId)) {
    error.value = 'Invalid schedule ID'
    return
  }

  try {
    loading.value = true
    error.value = ''
    
    const data = await getScheduleById(scheduleId)
    schedule.value = data.schedule
    dependencies.value = data.dependencies
  } catch (err) {
    error.value = `Failed to load schedule: ${err}`
  } finally {
    loading.value = false
  }
}

const loadExecutionHistory = async () => {
  const scheduleId = Number(route.params.id)
  
  try {
    loadingHistory.value = true
    const data = await getExecutionHistory(scheduleId, 0, 10)
    executionHistory.value = data.executions
  } catch (err) {
    console.error('Failed to load execution history:', err)
  } finally {
    loadingHistory.value = false
  }
}

const runScheduleNow = async () => {
  const scheduleId = Number(route.params.id)
  
  try {
    running.value = true
    await runScheduleNowApi(scheduleId)
    showAlert('Success', 'Schedule execution started', 'success')
    await loadSchedule()
  } catch (err) {
    showAlert('Error', `Failed to run schedule: ${err}`, 'error')
  } finally {
    running.value = false
  }
}

const pauseSchedule = async () => {
  const scheduleId = Number(route.params.id)
  
  try {
    await pauseScheduleApi(scheduleId)
    showAlert('Success', 'Schedule paused successfully', 'success')
    await loadSchedule()
  } catch (err) {
    showAlert('Error', `Failed to pause schedule: ${err}`, 'error')
  }
}

const resumeSchedule = async () => {
  const scheduleId = Number(route.params.id)
  
  try {
    await resumeScheduleApi(scheduleId)
    showAlert('Success', 'Schedule resumed successfully', 'success')
    await loadSchedule()
  } catch (err) {
    showAlert('Error', `Failed to resume schedule: ${err}`, 'error')
  }
}

const deleteSchedule = () => {
  confirmDialog.value = {
    show: true,
    title: 'Delete Schedule',
    message: `Are you sure you want to delete "${schedule.value.name}"? This action cannot be undone.`,
    action: async () => {
      const scheduleId = Number(route.params.id)
      try {
        await deleteScheduleApi(scheduleId)
        showAlert('Success', 'Schedule deleted successfully', 'success', 'Go to List', () => router.push('/schedule/list'))
      } catch (err) {
        showAlert('Error', `Failed to delete schedule: ${err}`, 'error')
      }
      confirmDialog.value.show = false
    }
  }
}

const editSchedule = () => {
  router.push(`/schedule/edit/${route.params.id}`)
}

const goBack = () => {
  router.push('/schedule/list')
}

const showAlert = (
  title: string,
  message: string,
  type: 'success' | 'error' | 'warning' | 'info',
  actionText?: string,
  action?: () => void
) => {
  alertDialog.value = {
    show: true,
    title,
    message,
    type,
    actionText: actionText || 'OK',
    action
  }
}

const handleAlertAction = () => {
  if (alertDialog.value.action) {
    alertDialog.value.action()
  }
  alertDialog.value.show = false
}

const confirmAction = async () => {
  if (confirmDialog.value.action) {
    await confirmDialog.value.action()
  }
}

const getAlertIcon = (type: string) => {
  switch (type) {
    case 'success': return 'mdi-check-circle'
    case 'error': return 'mdi-alert-circle'
    case 'warning': return 'mdi-alert'
    case 'info': return 'mdi-information'
    default: return 'mdi-information'
  }
}

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

const getDependencyConditionLabel = (condition: DependencyCondition): string => {
  switch (condition) {
    case DependencyCondition.ON_SUCCESS: return 'On Success'
    case DependencyCondition.ON_COMPLETION: return 'On Completion'
    case DependencyCondition.ON_FAILURE: return 'On Failure'
    default: return 'Unknown'
  }
}

const formatDateTime = (dateString: string): string => {
  const date = new Date(dateString)
  return date.toLocaleString()
}

// Lifecycle
onMounted(() => {
  loadSchedule()
  loadExecutionHistory()
})
</script>

<style scoped>
.v-card {
  border-radius: 8px;
}

.font-family-mono {
  font-family: 'Courier New', monospace;
  font-size: 0.875rem;
}
</style> 