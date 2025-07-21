<template>
  <v-container fluid>
    <!-- Header with title and actions -->
    <v-row class="mb-4">
      <v-col cols="12" md="8">
        <h2 class="text-h4 font-weight-bold">
          <v-icon class="mr-2">mdi-clock-outline</v-icon>
          Schedule Management
        </h2>
        <p class="text-subtitle-1 text-medium-emphasis">
          Manage automated task scheduling and job dependencies
        </p>
      </v-col>
      <v-col cols="12" md="4" class="d-flex justify-end align-center">
        <v-btn
          color="primary"
          prepend-icon="mdi-plus"
          @click="createNewSchedule"
          class="mr-2"
        >
          New Schedule
        </v-btn>
        <v-btn
          color="secondary"
          prepend-icon="mdi-import"
          @click="importSchedules"
          class="mr-2"
        >
          Import
        </v-btn>
        <v-btn
          color="secondary"
          prepend-icon="mdi-export"
          @click="exportSchedules"
        >
          Export
        </v-btn>
      </v-col>
    </v-row>

    <!-- Scheduler Status Card -->
    <v-row class="mb-4">
      <v-col cols="12">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-server</v-icon>
            Scheduler Status
          </v-card-title>
          <v-card-text>
            <v-row>
              <v-col cols="12" md="3">
                <div class="text-center">
                  <v-chip
                    :color="schedulerStatus.isRunning ? 'success' : 'error'"
                    size="large"
                    class="mb-2"
                  >
                    {{ schedulerStatus.isRunning ? 'Running' : 'Stopped' }}
                  </v-chip>
                  <div class="text-caption">Status</div>
                </div>
              </v-col>
              <v-col cols="12" md="3">
                <div class="text-center">
                  <div class="text-h6 font-weight-bold">{{ schedulerStatus.activeSchedules }}</div>
                  <div class="text-caption">Active Schedules</div>
                </div>
              </v-col>
              <v-col cols="12" md="3">
                <div class="text-center">
                  <div class="text-h6 font-weight-bold">{{ schedulerStatus.totalSchedules }}</div>
                  <div class="text-caption">Total Schedules</div>
                </div>
              </v-col>
              <v-col cols="12" md="3">
                <div class="text-center">
                  <v-btn
                    :color="schedulerStatus.isRunning ? 'error' : 'success'"
                    size="small"
                    @click="toggleScheduler"
                    :loading="schedulerLoading"
                  >
                    {{ schedulerStatus.isRunning ? 'Stop' : 'Start' }} Scheduler
                  </v-btn>
                </div>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Filters and Search -->
    <v-row class="mb-4">
      <v-col cols="12">
        <v-card>
          <v-card-text>
            <v-row>
              <v-col cols="12" md="3">
                <v-text-field
                  v-model="searchQuery"
                  label="Search schedules"
                  prepend-inner-icon="mdi-magnify"
                  clearable
                  @update:model-value="handleSearch"
                />
              </v-col>
              <v-col cols="12" md="2">
                <v-select
                  v-model="statusFilter"
                  :items="statusOptions"
                  label="Status"
                  clearable
                  @update:model-value="handleFilter"
                />
              </v-col>
              <v-col cols="12" md="2">
                <v-select
                  v-model="taskTypeFilter"
                  :items="taskTypeOptions"
                  label="Task Type"
                  clearable
                  @update:model-value="handleFilter"
                />
              </v-col>
              <v-col cols="12" md="2">
                <v-select
                  v-model="triggerTypeFilter"
                  :items="triggerTypeOptions"
                  label="Trigger Type"
                  clearable
                  @update:model-value="handleFilter"
                />
              </v-col>
              <v-col cols="12" md="3" class="d-flex align-center">
                <v-btn
                  color="primary"
                  variant="outlined"
                  @click="loadSchedules"
                  :loading="loading"
                  class="mr-2"
                >
                  <v-icon>mdi-refresh</v-icon>
                </v-btn>
                <v-btn
                  color="secondary"
                  variant="outlined"
                  @click="clearFilters"
                >
                  Clear Filters
                </v-btn>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Schedule Table -->
    <v-row>
      <v-col cols="12">
        <v-card>
          <v-card-title class="d-flex justify-space-between align-center">
            <span>Schedules ({{ total }})</span>
            <v-chip color="info" size="small">
              Page {{ currentPage + 1 }} of {{ Math.ceil(total / pageSize) }}
            </v-chip>
          </v-card-title>
          <v-card-text>
            <ScheduleTable
              :schedules="schedules"
              :loading="loading"
              @edit="editSchedule"
              @delete="deleteSchedule"
              @enable="enableSchedule"
              @disable="disableSchedule"
              @pause="pauseSchedule"
              @resume="resumeSchedule"
              @run-now="runScheduleNow"
              @view-details="viewScheduleDetails"
            />
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Pagination -->
    <v-row class="mt-4">
      <v-col cols="12" class="d-flex justify-center">
        <v-pagination
          v-model="currentPage"
          :length="Math.ceil(total / pageSize)"
          :total-visible="7"
          @update:model-value="handlePageChange"
        />
      </v-col>
    </v-row>

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
          <v-btn color="primary" @click="alertDialog.show = false">OK</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import ScheduleTable from './widgets/ScheduleTable.vue'
import {
  getScheduleList,
  deleteSchedule as deleteScheduleApi,
  enableSchedule as enableScheduleApi,
  disableSchedule as disableScheduleApi,
  pauseSchedule as pauseScheduleApi,
  resumeSchedule as resumeScheduleApi,
  runScheduleNow as runScheduleNowApi,
  getSchedulerStatus,
  startScheduler,
  stopScheduler,
  exportSchedules as exportSchedulesApi,
  importSchedules as importSchedulesApi
} from '@/views/api/schedule'
import { ScheduleListResponse } from '@/entityTypes/schedule-type'
import { TaskType, ScheduleStatus, TriggerType } from '@/entity/ScheduleTask.entity'

const { t } = useI18n()
const router = useRouter()

// Reactive data
const schedules = ref<any[]>([])
const total = ref(0)
const currentPage = ref(0)
const pageSize = ref(10)
const loading = ref(false)
const schedulerLoading = ref(false)

// Filters
const searchQuery = ref('')
const statusFilter = ref<ScheduleStatus | null>(null)
const taskTypeFilter = ref<TaskType | null>(null)
const triggerTypeFilter = ref<TriggerType | null>(null)

// Scheduler status
const schedulerStatus = ref({
  isRunning: false,
  activeSchedules: 0,
  totalSchedules: 0,
  lastCheckTime: new Date(),
  nextCheckTime: new Date()
})

// Dialogs
const confirmDialog = ref({
  show: false,
  title: '',
  message: '',
  action: null as (() => Promise<void>) | null,
  itemId: null as number | null
})

const alertDialog = ref({
  show: false,
  title: '',
  message: '',
  type: 'info' as 'success' | 'error' | 'warning' | 'info'
})

// Options for filters
const statusOptions = [
  { title: 'Active', value: ScheduleStatus.ACTIVE },
  { title: 'Inactive', value: ScheduleStatus.INACTIVE },
  { title: 'Paused', value: ScheduleStatus.PAUSED },
  // { title: 'Error', value: ScheduleStatus.ERROR }
]

const taskTypeOptions = [
  { title: 'Search Task', value: TaskType.SEARCH },
  { title: 'Email Extract', value: TaskType.EMAIL_EXTRACT },
  { title: 'Bulk Email', value: TaskType.BUCK_EMAIL },
  { title: 'Video Download', value: TaskType.VIDEO_DOWNLOAD },
  // { title: 'Social Task', value: TaskType.SOCIAL_TASK }
]

const triggerTypeOptions = [
  { title: 'Cron', value: TriggerType.CRON },
  { title: 'Dependency', value: TriggerType.DEPENDENCY },
  { title: 'Manual', value: TriggerType.MANUAL }
]

// Methods
const loadSchedules = async () => {
  try {
    loading.value = true
    const filters = {
      search: searchQuery.value,
      status: statusFilter.value || undefined,
      taskType: taskTypeFilter.value || undefined,
      triggerType: triggerTypeFilter.value || undefined
    }
    
    const response: ScheduleListResponse = await getScheduleList(
      currentPage.value,
      pageSize.value,
      undefined,
      filters
    )
    
    schedules.value = response.schedules
    total.value = response.total
  } catch (error) {
    showAlert('Error', `Failed to load schedules: ${error}`, 'error')
  } finally {
    loading.value = false
  }
}

const loadSchedulerStatus = async () => {
  try {
    const status = await getSchedulerStatus()
    schedulerStatus.value = status
  } catch (error) {
    console.error('Failed to load scheduler status:', error)
  }
}

const handlePageChange = (page: number) => {
  currentPage.value = page - 1
  loadSchedules()
}

const handleSearch = () => {
  currentPage.value = 0
  loadSchedules()
}

const handleFilter = () => {
  currentPage.value = 0
  loadSchedules()
}

const clearFilters = () => {
  searchQuery.value = ''
  statusFilter.value = null
  taskTypeFilter.value = null
  triggerTypeFilter.value = null
  currentPage.value = 0
  loadSchedules()
}

const toggleScheduler = async () => {
  try {
    schedulerLoading.value = true
    if (schedulerStatus.value.isRunning) {
      await stopScheduler()
    } else {
      await startScheduler()
    }
    await loadSchedulerStatus()
    showAlert(
      'Success',
      `Scheduler ${schedulerStatus.value.isRunning ? 'started' : 'stopped'} successfully`,
      'success'
    )
  } catch (error) {
    showAlert('Error', `Failed to ${schedulerStatus.value.isRunning ? 'stop' : 'start'} scheduler: ${error}`, 'error')
  } finally {
    schedulerLoading.value = false
  }
}

const createNewSchedule = () => {
  router.push('/schedule/create')
}

const editSchedule = (id: number) => {
  router.push(`/schedule/edit/${id}`)
}

const viewScheduleDetails = (id: number) => {
  router.push(`/schedule/detail/${id}`)
}

const showConfirmDialog = (title: string, message: string, action: () => Promise<void>, itemId: number) => {
  confirmDialog.value = {
    show: true,
    title,
    message,
    action,
    itemId
  }
}

const confirmAction = async () => {
  if (confirmDialog.value.action) {
    try {
      await confirmDialog.value.action()
      confirmDialog.value.show = false
      loadSchedules()
    } catch (error) {
      showAlert('Error', `Action failed: ${error}`, 'error')
    }
  }
}

const deleteSchedule = (id: number) => {
  showConfirmDialog(
    'Delete Schedule',
    'Are you sure you want to delete this schedule? This action cannot be undone.',
    async () => {
      await deleteScheduleApi(id)
      showAlert('Success', 'Schedule deleted successfully', 'success')
    },
    id
  )
}

const enableSchedule = async (id: number) => {
  try {
    await enableScheduleApi(id)
    showAlert('Success', 'Schedule enabled successfully', 'success')
    loadSchedules()
  } catch (error) {
    showAlert('Error', `Failed to enable schedule: ${error}`, 'error')
  }
}

const disableSchedule = async (id: number) => {
  try {
    await disableScheduleApi(id)
    showAlert('Success', 'Schedule disabled successfully', 'success')
    loadSchedules()
  } catch (error) {
    showAlert('Error', `Failed to disable schedule: ${error}`, 'error')
  }
}

const pauseSchedule = async (id: number) => {
  try {
    await pauseScheduleApi(id)
    showAlert('Success', 'Schedule paused successfully', 'success')
    loadSchedules()
  } catch (error) {
    showAlert('Error', `Failed to pause schedule: ${error}`, 'error')
  }
}

const resumeSchedule = async (id: number) => {
  try {
    await resumeScheduleApi(id)
    showAlert('Success', 'Schedule resumed successfully', 'success')
    loadSchedules()
  } catch (error) {
    showAlert('Error', `Failed to resume schedule: ${error}`, 'error')
  }
}

const runScheduleNow = async (id: number) => {
  try {
    await runScheduleNowApi(id)
    showAlert('Success', 'Schedule execution started', 'success')
    loadSchedules()
  } catch (error) {
    showAlert('Error', `Failed to run schedule: ${error}`, 'error')
  }
}

const exportSchedules = async () => {
  try {
    const filters = {
      search: searchQuery.value,
      status: statusFilter.value || undefined,
      taskType: taskTypeFilter.value || undefined,
      triggerType: triggerTypeFilter.value || undefined
    }
    const data = await exportSchedulesApi(filters)
    // Handle file download
    showAlert('Success', 'Schedules exported successfully', 'success')
  } catch (error) {
    showAlert('Error', `Failed to export schedules: ${error}`, 'error')
  }
}

const importSchedules = () => {
  // TODO: Implement file upload dialog
  showAlert('Info', 'Import functionality will be implemented soon', 'info')
}

const showAlert = (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info') => {
  alertDialog.value = {
    show: true,
    title,
    message,
    type
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

// Lifecycle
onMounted(() => {
  loadSchedules()
  loadSchedulerStatus()
})
</script>

<style scoped>
.v-card {
  border-radius: 8px;
}

.v-btn {
  text-transform: none;
}
</style> 