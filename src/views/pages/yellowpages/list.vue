<template>
  <v-container fluid>
    <!-- Header with title and actions -->
    <v-row class="mb-4">
      <v-col cols="12" md="8">
        <h2 class="text-h4 font-weight-bold">
          <v-icon class="mr-2">mdi-phone-book</v-icon>
          {{ t('home.yellow_pages_task_management') }}
        </h2>
        <p class="text-subtitle-1 text-medium-emphasis">
          {{ t('home.yellow_pages_task_management_description') }}
        </p>
      </v-col>
      <v-col cols="12" md="4" class="d-flex justify-end align-center">
        <v-btn
          color="primary"
          prepend-icon="mdi-plus"
          @click="createNewTask"
          class="mr-2"
        >
          {{ t('home.new_task') }}
        </v-btn>
        <!-- <v-btn
          color="secondary"
          prepend-icon="mdi-import"
          @click="importTasks"
          class="mr-2"
        >
          {{ t('home.import') }}
        </v-btn> -->
        <!-- <v-btn
          color="secondary"
          prepend-icon="mdi-export"
          @click="exportTasks"
        >
          {{ t('home.export') }}
        </v-btn> -->
      </v-col>
    </v-row>

    <!-- Task Status Overview -->
    <v-row class="mb-4">
      <v-col cols="12">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-chart-line</v-icon>
            {{ t('home.task_overview') }}
          </v-card-title>
          <v-card-text>
            <v-row>
              <v-col cols="12" md="2">
                <div class="text-center">
                  <div class="text-h6 font-weight-bold text-primary">{{ taskStats.total }}</div>
                  <div class="text-caption">{{ t('home.total_tasks') }}</div>
                </div>
              </v-col>
              <v-col cols="12" md="2">
                <div class="text-center">
                  <div class="text-h6 font-weight-bold text-success">{{ taskStats.running }}</div>
                  <div class="text-caption">{{ t('home.running') }}</div>
                </div>
              </v-col>
              <v-col cols="12" md="2">
                <div class="text-center">
                  <div class="text-h6 font-weight-bold text-warning">{{ taskStats.pending }}</div>
                  <div class="text-caption">{{ t('home.pending') }}</div>
                </div>
              </v-col>
              <v-col cols="12" md="2">
                <div class="text-center">
                  <div class="text-h6 font-weight-bold text-info">{{ taskStats.completed }}</div>
                  <div class="text-caption">{{ t('home.completed') }}</div>
                </div>
              </v-col>
              <v-col cols="12" md="2">
                <div class="text-center">
                  <div class="text-h6 font-weight-bold text-error">{{ taskStats.failed }}</div>
                  <div class="text-caption">{{ t('home.failed') }}</div>
                </div>
              </v-col>
              <v-col cols="12" md="2">
                <div class="text-center">
                  <div class="text-h6 font-weight-bold">{{ taskStats.successRate }}%</div>
                  <div class="text-caption">{{ t('home.success_rate') }}</div>
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
                  :label="t('home.search_tasks')"
                  prepend-inner-icon="mdi-magnify"
                  clearable
                  @update:model-value="handleSearch"
                />
              </v-col>
              <v-col cols="12" md="2">
                <v-select
                  v-model="statusFilter"
                  :items="statusOptions"
                  :label="t('home.status')"
                  clearable
                  @update:model-value="handleFilter"
                />
              </v-col>
              <v-col cols="12" md="2">
                <v-select
                  v-model="platformFilter"
                  :items="platformOptions"
                  :label="t('home.platform')"
                  clearable
                  @update:model-value="handleFilter"
                />
              </v-col>
              <v-col cols="12" md="2">
                <v-select
                  v-model="priorityFilter"
                  :items="priorityOptions"
                  :label="t('home.priority')"
                  clearable
                  @update:model-value="handleFilter"
                />
              </v-col>
              <v-col cols="12" md="3" class="d-flex align-center">
                <v-btn
                  color="primary"
                  variant="outlined"
                  @click="loadTasks"
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
                  {{ t('home.clear_filters') }}
                </v-btn>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Task Table -->
    <v-row>
      <v-col cols="12">
        <v-card>
          <v-card-title class="d-flex justify-space-between align-center">
            <span>{{ t('home.tasks') }} ({{ total }})</span>
            <v-chip color="info" size="small">
              {{ t('home.page') }} {{ currentPage + 1 }} {{ t('home.of') }} {{ Math.ceil(total / pageSize) }}
            </v-chip>
          </v-card-title>
          <v-card-text>
            <YellowPagesTaskTable
              :tasks="tasks"
              :loading="loading"
              @edit="editTask"
              @delete="deleteTask"
              @start="startTask"
              @stop="stopTask"
              @pause="pauseTask"
              @resume="resumeTask"
              @view-results="viewTaskResults"
              @view-details="viewTaskDetails"
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
          <v-spacer></v-spacer>
          <v-btn color="secondary" @click="confirmDialog.show = false">{{ t('home.cancel') }}</v-btn>
          <v-btn color="error" @click="confirmAction">{{ t('home.confirm') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Task Details Dialog -->
    <v-dialog v-model="taskDetailsDialog.show" max-width="800">
      <v-card>
        <v-card-title class="d-flex justify-space-between align-center">
          <span>{{ t('home.task_details') }}</span>
          <v-btn icon="mdi-close" variant="text" @click="taskDetailsDialog.show = false"></v-btn>
        </v-card-title>
        <v-card-text>
          <TaskDetailsView
            v-if="taskDetailsDialog.show"
            :task="taskDetailsDialog.task"
            @close="taskDetailsDialog.show = false"
          />
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import YellowPagesTaskTable from './components/YellowPagesTaskTable.vue'
import TaskDetailsView from './components/TaskDetailsView.vue'
import { getYellowPagesTaskList, getYellowPagesPlatforms } from '@/views/api/yellowpages'
import { TaskStatus } from '@/interfaces/ITaskManager'
import { PlatformConfig } from '@/interfaces/IPlatformConfig'

// Router and i18n
const router = useRouter()
const { t } = useI18n()

// Define task type - using TaskSummary interface from API
interface Task {
  id: number
  name: string
  platform: string
  status: TaskStatus
  created_at: Date
  completed_at?: Date
  results_count?: number
  progress_percentage?: number
}

// Reactive data
const loading = ref(false)
const searchQuery = ref('')
const statusFilter = ref<TaskStatus | ''>('')
const platformFilter = ref('')
const priorityFilter = ref('')
const currentPage = ref(0)
const pageSize = ref(10)
const total = ref(0)
const tasks = ref<Task[]>([])
const platforms = ref<PlatformConfig[]>([])

// Task statistics
const taskStats = reactive({
  total: 0,
  running: 0,
  pending: 0,
  completed: 0,
  failed: 0,
  successRate: 0
})

// Filter options
const statusOptions = [
  { title: t('home.pending'), value: TaskStatus.Pending },
  { title: t('home.running'), value: TaskStatus.InProgress },
  { title: t('home.completed'), value: TaskStatus.Completed },
  { title: t('home.failed'), value: TaskStatus.Failed },
  { title: t('home.paused'), value: TaskStatus.Paused }
]

const platformOptions = computed(() => {
  return platforms.value
    .filter(platform => platform.is_active)
    .map(platform => ({
      title: platform.display_name || platform.name,
      value: platform.id
    }))
})

const priorityOptions = [
  { title: t('home.high'), value: 'high' },
  { title: t('home.medium'), value: 'medium' },
  { title: t('home.low'), value: 'low' }
]

// Dialog states
const confirmDialog = reactive({
  show: false,
  title: '',
  message: '',
  action: null as any
})

const taskDetailsDialog = reactive({
  show: false,
  task: null as any
})

// Methods
const loadPlatforms = async () => {
  try {
    const platformsData = await getYellowPagesPlatforms()
    if (platformsData) {
      platforms.value = platformsData
    } else {
      platforms.value = []
    }
  } catch (error) {
    console.error('Failed to load platforms:', error)
    // Fallback to empty platforms array
    platforms.value = []
  }
}

const loadTasks = async () => {
  loading.value = true
  try {
    const response = await getYellowPagesTaskList()
    
    if (response && response.length > 0) {
      tasks.value = response
      total.value = response.length
      updateTaskStats()
    } else {
      tasks.value = []
      total.value = 0
      updateTaskStats()
    }
  } catch (error) {
    console.error('Failed to load tasks:', error)
    // Fallback to empty state on error
    tasks.value = []
    total.value = 0
    updateTaskStats()
  } finally {
    loading.value = false
  }
}

const updateTaskStats = () => {
  const stats = {
    total: tasks.value.length,
    running: tasks.value.filter(t => t.status === TaskStatus.InProgress).length,
    pending: tasks.value.filter(t => t.status === TaskStatus.Pending).length,
    completed: tasks.value.filter(t => t.status === TaskStatus.Completed).length,
    failed: tasks.value.filter(t => t.status === TaskStatus.Failed).length,
    successRate: 0
  }
  
  const completedTasks = stats.completed + stats.failed
  if (completedTasks > 0) {
    stats.successRate = Math.round((stats.completed / completedTasks) * 100)
  }
  
  Object.assign(taskStats, stats)
}

const handleSearch = () => {
  // TODO: Implement search functionality
  console.log('Search query:', searchQuery.value)
}

const handleFilter = () => {
  // TODO: Implement filter functionality
  console.log('Filters:', { statusFilter: statusFilter.value, platformFilter: platformFilter.value, priorityFilter: priorityFilter.value })
}

const clearFilters = () => {
  searchQuery.value = ''
  statusFilter.value = ''
  platformFilter.value = ''
  priorityFilter.value = ''
  loadTasks()
}

const handlePageChange = (page: number) => {
  currentPage.value = page
  loadTasks()
}

const createNewTask = () => {
  router.push('/yellowpages/create')
}

const editTask = (task: any) => {
  router.push(`/yellowpages/edit/${task.id}`)
}

const deleteTask = (task: any) => {
  confirmDialog.title = t('home.delete_task')
  confirmDialog.message = t('home.delete_task_confirm', { name: task.name })
  confirmDialog.action = () => performDeleteTask(task.id)
  confirmDialog.show = true
}

const performDeleteTask = async (taskId: number) => {
  try {
    // TODO: Replace with actual API call when deleteYellowPagesTask is implemented
    await fetch(`/api/yellow-pages/tasks/${taskId}`, {
      method: 'DELETE'
    })
    await loadTasks()
  } catch (error) {
    console.error('Failed to delete task:', error)
  } finally {
    confirmDialog.show = false
  }
}

const startTask = async (task: any) => {
  try {
    // TODO: Replace with actual API call
    await fetch(`/api/yellow-pages/tasks/${task.id}/start`, {
      method: 'POST'
    })
    await loadTasks()
  } catch (error) {
    console.error('Failed to start task:', error)
  }
}

const stopTask = async (task: any) => {
  try {
    // TODO: Replace with actual API call
    await fetch(`/api/yellow-pages/tasks/${task.id}/stop`, {
      method: 'POST'
    })
    await loadTasks()
  } catch (error) {
    console.error('Failed to stop task:', error)
  }
}

const pauseTask = async (task: any) => {
  try {
    // TODO: Replace with actual API call
    await fetch(`/api/yellow-pages/tasks/${task.id}/pause`, {
      method: 'POST'
    })
    await loadTasks()
  } catch (error) {
    console.error('Failed to pause task:', error)
  }
}

const resumeTask = async (task: any) => {
  try {
    // TODO: Replace with actual API call
    await fetch(`/api/yellow-pages/tasks/${task.id}/resume`, {
      method: 'POST'
    })
    await loadTasks()
  } catch (error) {
    console.error('Failed to resume task:', error)
  }
}

const viewTaskResults = (task: any) => {
  router.push(`/yellowpages/results/${task.id}`)
}

const viewTaskDetails = (task: any) => {
  taskDetailsDialog.task = task
  taskDetailsDialog.show = true
}

const importTasks = () => {
  // TODO: Implement import functionality
  console.log('Import tasks')
}

const exportTasks = () => {
  // TODO: Implement export functionality
  console.log('Export tasks')
}

const confirmAction = () => {
  if (confirmDialog.action) {
    confirmDialog.action()
  }
}

// Lifecycle
onMounted(() => {
  loadPlatforms()
  loadTasks()
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