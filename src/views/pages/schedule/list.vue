<template>
  <v-container fluid>
    <!-- Header with title and actions -->
    <v-row class="mb-4">
      <v-col cols="12" md="8">
        <h2 class="text-h4 font-weight-bold">
          <v-icon class="mr-2">mdi-clock-outline</v-icon>
          {{ t('schedule.schedule_management') }}
        </h2>
        <p class="text-subtitle-1 text-medium-emphasis">
          {{ t('schedule.manage_automated_scheduling') }}
        </p>
      </v-col>
      <v-col cols="12" md="4" class="d-flex justify-end align-center">
        <v-btn
          color="primary"
          prepend-icon="mdi-plus"
          @click="createNewSchedule"
          class="mr-2"
        >
          {{ t('schedule.new_schedule') }}
        </v-btn>
        <v-btn
          color="secondary"
          prepend-icon="mdi-import"
          @click="importSchedules"
          class="mr-2"
        >
          {{ t('common.import') }}
        </v-btn>
        <v-btn
          color="secondary"
          prepend-icon="mdi-export"
          @click="exportSchedules"
        >
          {{ t('common.export') }}
        </v-btn>
      </v-col>
    </v-row>

    <!-- Scheduler Status Card -->
    <v-row class="mb-4">
      <v-col cols="12">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-server</v-icon>
            {{ t('schedule.scheduler_status') }}
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
                    {{ schedulerStatus.isRunning ? t('schedule.running') : t('schedule.stopped') }}
                  </v-chip>
                  <div class="text-caption">{{ t('common.status') }}</div>
                </div>
              </v-col>
              <v-col cols="12" md="3">
                <div class="text-center">
                  <div class="text-h6 font-weight-bold">{{ schedulerStatus.activeSchedules }}</div>
                  <div class="text-caption">{{ t('schedule.active_schedules') }}</div>
                </div>
              </v-col>
              <v-col cols="12" md="3">
                <div class="text-center">
                  <div class="text-h6 font-weight-bold">{{ schedulerStatus.totalSchedules }}</div>
                  <div class="text-caption">{{ t('schedule.total_schedules') }}</div>
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
                    {{ schedulerStatus.isRunning ? t('schedule.stop') : t('schedule.start') }} {{ t('schedule.scheduler') }}
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
                  :label="t('schedule.search_schedules')"
                  prepend-inner-icon="mdi-magnify"
                  clearable
                  @update:model-value="handleSearch"
                />
              </v-col>
              <v-col cols="12" md="2">
                <v-select
                  v-model="statusFilter"
                  :items="statusOptions"
                  :label="t('common.status')"
                  clearable
                  @update:model-value="handleFilter"
                />
              </v-col>
              <v-col cols="12" md="2">
                <v-select
                  v-model="taskTypeFilter"
                  :items="taskTypeOptions"
                  :label="t('schedule.task_type')"
                  clearable
                  @update:model-value="handleFilter"
                />
              </v-col>
              <v-col cols="12" md="2">
                <v-select
                  v-model="triggerTypeFilter"
                  :items="triggerTypeOptions"
                  :label="t('schedule.trigger_type')"
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
                  {{ t('common.clear_filters') }}
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
            <span>{{ t('schedule.schedules') }} ({{ total }})</span>
            <v-chip color="info" size="small">
              {{ t('common.page') }} {{ currentPage + 1 }} {{ t('common.of') }} {{ Math.ceil(total / pageSize) }}
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
          <v-btn color="secondary" @click="confirmDialog.show = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="error" @click="confirmAction">{{ t('common.confirm') }}</v-btn>
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
          <v-btn color="primary" @click="alertDialog.show = false">{{ t('common.ok') }}</v-btn>
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
const statusOptions = computed(() => [
  { title: t('schedule.active'), value: ScheduleStatus.ACTIVE },
  { title: t('schedule.inactive'), value: ScheduleStatus.INACTIVE },
  { title: t('schedule.paused'), value: ScheduleStatus.PAUSED },
  // { title: t('schedule.error'), value: ScheduleStatus.ERROR }
])

const taskTypeOptions = computed(() => [
  { title: t('schedule.search_task'), value: TaskType.SEARCH },
  { title: t('schedule.email_extract'), value: TaskType.EMAIL_EXTRACT },
  { title: t('schedule.bulk_email'), value: TaskType.BUCK_EMAIL },
  { title: t('schedule.video_download'), value: TaskType.VIDEO_DOWNLOAD },
  // { title: t('schedule.social_task'), value: TaskType.SOCIAL_TASK }
])

const triggerTypeOptions = computed(() => [
  { title: t('schedule.cron_schedule'), value: TriggerType.CRON },
  { title: t('schedule.dependency'), value: TriggerType.DEPENDENCY },
  { title: t('schedule.manual_only'), value: TriggerType.MANUAL }
])

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
    showAlert(t('common.error'), `${t('schedule.failed_to_load_schedules')}: ${error}`, 'error')
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
      t('common.success'),
      `${t('schedule.scheduler')} ${schedulerStatus.value.isRunning ? t('schedule.started') : t('schedule.stopped')} ${t('common.success')}`,
      'success'
    )
  } catch (error) {
    showAlert(t('common.error'), `${t('schedule.failed_to')} ${schedulerStatus.value.isRunning ? t('schedule.stop') : t('schedule.start')} ${t('schedule.scheduler')}: ${error}`, 'error')
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
      showAlert(t('common.error'), `${t('schedule.action_failed')}: ${error}`, 'error')
    }
  }
}

const deleteSchedule = (id: number) => {
  showConfirmDialog(
    t('schedule.delete_schedule'),
    t('schedule.delete_schedule_confirm'),
    async () => {
      await deleteScheduleApi(id)
      showAlert(t('common.success'), t('schedule.schedule_deleted_successfully'), 'success')
    },
    id
  )
}

const enableSchedule = async (id: number) => {
  try {
    await enableScheduleApi(id)
    showAlert(t('common.success'), t('schedule.schedule_enabled_successfully'), 'success')
    loadSchedules()
  } catch (error) {
    showAlert(t('common.error'), `${t('schedule.failed_to_enable_schedule')}: ${error}`, 'error')
  }
}

const disableSchedule = async (id: number) => {
  try {
    await disableScheduleApi(id)
    showAlert(t('common.success'), t('schedule.schedule_disabled_successfully'), 'success')
    loadSchedules()
  } catch (error) {
    showAlert(t('common.error'), `${t('schedule.failed_to_disable_schedule')}: ${error}`, 'error')
  }
}

const pauseSchedule = async (id: number) => {
  try {
    await pauseScheduleApi(id)
    showAlert(t('common.success'), t('schedule.schedule_paused_successfully'), 'success')
    loadSchedules()
  } catch (error) {
    showAlert(t('common.error'), `${t('schedule.failed_to_pause_schedule')}: ${error}`, 'error')
  }
}

const resumeSchedule = async (id: number) => {
  try {
    await resumeScheduleApi(id)
    showAlert(t('common.success'), t('schedule.schedule_resumed_successfully'), 'success')
    loadSchedules()
  } catch (error) {
    showAlert(t('common.error'), `${t('schedule.failed_to_resume_schedule')}: ${error}`, 'error')
  }
}

const runScheduleNow = async (id: number) => {
  try {
    await runScheduleNowApi(id)
    showAlert(t('common.success'), t('schedule.schedule_execution_started'), 'success')
    loadSchedules()
  } catch (error) {
    showAlert(t('common.error'), `${t('schedule.failed_to_run_schedule')}: ${error}`, 'error')
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
    showAlert(t('common.success'), t('schedule.schedules_exported_successfully'), 'success')
  } catch (error) {
    showAlert(t('common.error'), `${t('schedule.failed_to_export_schedules')}: ${error}`, 'error')
  }
}

const importSchedules = () => {
  // TODO: Implement file upload dialog
  showAlert(t('common.info'), t('schedule.import_functionality_coming_soon'), 'info')
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