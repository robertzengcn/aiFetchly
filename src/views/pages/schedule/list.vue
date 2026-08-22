<template>
  <AppPageShell
    page-id="schedule-list"
    title-key="schedule.schedule_management"
    description-key="schedule.manage_automated_scheduling"
    content-width="full"
    :busy="loading"
  >
    <!-- One primary action; import/export are rare → overflow (IPR-004/006). -->
    <template #primary-action>
      <v-btn
        color="primary"
        prepend-icon="mdi-plus"
        data-testid="schedule-new-primary"
        @click="createNewSchedule"
      >
        {{ t('schedule.new_schedule') }}
      </v-btn>
    </template>
    <template #overflow>
      <v-menu location="bottom end">
        <template #activator="{ props: menuProps }">
          <v-btn icon v-bind="menuProps" variant="text" data-testid="schedule-overflow">
            <v-icon>mdi-dots-horizontal</v-icon>
          </v-btn>
        </template>
        <v-list density="compact" role="menu">
          <v-list-item
            role="menuitem"
            :title="t('common.import')"
            prepend-icon="mdi-import"
            data-testid="schedule-overflow-import"
            @click="importSchedules"
          />
          <v-list-item
            role="menuitem"
            :title="t('common.export')"
            prepend-icon="mdi-export"
            data-testid="schedule-overflow-export"
            @click="exportSchedules"
          />
        </v-list>
      </v-menu>
    </template>

    <!-- Page-owned summarized status: the scheduler service (IPR-004). -->
    <template #status>
      <button
        type="button"
        class="scheduler-status-chip"
        :class="schedulerStatus.isRunning ? 'running' : 'stopped'"
        :data-testid="`scheduler-status-${schedulerStatus.isRunning ? 'running' : 'stopped'}`"
        @click="toggleScheduler"
      >
        <v-icon
          :icon="schedulerStatus.isRunning ? 'mdi-loading' : 'mdi-stop-circle-outline'"
          size="14"
          :class="{ spinning: schedulerStatus.isRunning }"
          aria-hidden="true"
        />
        {{ schedulerStatus.isRunning ? t('schedule.running') : t('schedule.stopped') }}
        · {{ schedulerStatus.activeSchedules }}/{{ schedulerStatus.totalSchedules }}
      </button>
    </template>

    <!-- Toolbar: search and filters BELOW the header (IPR-005). -->
    <template #toolbar>
      <v-text-field
        v-model="searchQuery"
        class="toolbar-search"
        density="compact"
        variant="outlined"
        hide-details
        :label="t('schedule.search_schedules')"
        prepend-inner-icon="mdi-magnify"
        clearable
        data-testid="schedule-toolbar-search"
        @update:model-value="handleSearch"
      />
      <v-select
        v-model="statusFilter"
        class="toolbar-filter"
        density="compact"
        variant="outlined"
        hide-details
        :items="statusOptions"
        :label="t('common.status')"
        clearable
        @update:model-value="handleFilter"
      />
      <v-select
        v-model="taskTypeFilter"
        class="toolbar-filter"
        density="compact"
        variant="outlined"
        hide-details
        :items="taskTypeOptions"
        :label="t('schedule.task_type')"
        clearable
        @update:model-value="handleFilter"
      />
      <v-select
        v-model="triggerTypeFilter"
        class="toolbar-filter"
        density="compact"
        variant="outlined"
        hide-details
        :items="triggerTypeOptions"
        :label="t('schedule.trigger_type')"
        clearable
        @update:model-value="handleFilter"
      />
      <v-spacer />
      <v-btn
        variant="text"
        icon="mdi-refresh"
        :loading="loading"
        :aria-label="t('common.refresh')"
        data-testid="schedule-toolbar-refresh"
        @click="loadSchedules"
      />
      <v-btn
        variant="text"
        data-testid="schedule-toolbar-clear"
        @click="clearFilters"
      >
        {{ t('common.clear_filters') }}
      </v-btn>
    </template>

    <!-- Shared load states (IPR-043). -->
    <PageStateView
      :load-state="pageLoad"
      :skeleton-rows="6"
      empty-title-key="schedule.empty_title"
      empty-body-key="schedule.empty_body"
      @retry="loadSchedules"
      @clear-filters="clearFilters"
      @empty-action="createNewSchedule"
    >
      <template #empty-action>{{ t('schedule.new_schedule') }}</template>
    </PageStateView>

    <!-- Feature table stays domain-owned (design §13.2). -->
    <section v-if="pageLoad.state === 'ready'" class="schedule-section">
      <header class="section-header">
        <h2>{{ t('schedule.schedules') }} ({{ total }})</h2>
        <span class="section-meta">
          {{ t('common.page') }} {{ currentPage + 1 }} {{ t('common.of') }} {{ Math.max(1, Math.ceil(total / pageSize)) }}
        </span>
      </header>
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
    </section>

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
  </AppPageShell>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import ScheduleTable from './widgets/ScheduleTable.vue'
import AppPageShell from '@/views/components/pageTemplates/AppPageShell.vue'
import PageStateView from '@/views/components/pageTemplates/PageStateView.vue'
import { useAsyncPageState } from '@/views/composables/useAsyncPageState'
import { useAppInspectorStore } from '@/views/store/appInspector'
import { useAppShellStore } from '@/views/store/appShell'
import type { PageLoadState } from '@/views/types/uiConvergenceTypes'
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  importSchedules as importSchedulesApi
} from '@/views/api/schedule'
import { ScheduleListResponse } from '@/entityTypes/schedule-type'
import { TaskType, ScheduleStatus, TriggerType } from '@/entity/ScheduleTask.entity'

const { t } = useI18n()
const router = useRouter()

// Reactive data
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const schedules = ref<any[]>([])

// Convergence state: shared load projection + typed inspector (design §13.5).
const asyncPage = useAsyncPageState();
void asyncPage; // load-error path is owned by loadSchedules; kept for future shared-state adoption
const pageLoad = computed<PageLoadState>(() => {
  if (loading.value) return { state: 'loading' };
  if (loadError.value) return { state: 'error', messageKey: 'ui.state.errorBody', recoverable: true };
  if (schedules.value.length === 0) {
    const filtered = Boolean(
      searchQuery.value ||
      statusFilter.value ||
      taskTypeFilter.value ||
      triggerTypeFilter.value
    );
    return { state: 'empty', kind: filtered ? 'no-results' : 'first-use' };
  }
  return { state: 'ready' };
});
const loadError = ref(false);
const appInspector = useAppInspectorStore();
const appShell = useAppShellStore();
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
  { title: t('schedule.google_maps'), value: TaskType.GOOGLE_MAPS },
  { title: t('schedule.yandex_maps'), value: TaskType.YANDEX_MAPS },
])

const triggerTypeOptions = computed(() => [
  { title: t('schedule.cron_schedule'), value: TriggerType.CRON },
  { title: t('schedule.dependency'), value: TriggerType.DEPENDENCY },
  { title: t('schedule.manual_only'), value: TriggerType.MANUAL }
])

// Methods
const loadSchedules = async () => {
  loadError.value = false
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
    loadError.value = true
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
  // Inspector preserves list context (IPR-016); the canonical detail route
  // remains a deep link (design §15.4).
  appInspector.open(
    { kind: 'schedule', ownerRoute: '/schedule', scheduleId: id },
    { focusOriginId: `schedule-row-${id}` }
  );
  appShell.setInspectorOpen(true);
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
    await exportSchedulesApi(filters)
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