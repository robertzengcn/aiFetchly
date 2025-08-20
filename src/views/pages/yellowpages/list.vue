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
        <v-card class="task-status-overview">
          <v-card-title class="d-flex align-center flex-wrap">
            <v-icon class="mr-2 mb-1">mdi-chart-line</v-icon>
            <span class="text-wrap">{{ t('home.task_overview') }}</span>
          </v-card-title>
          <v-card-text>
            <v-row class="task-stats-row">
              <v-col cols="6" sm="4" md="2">
                <div class="text-center task-stat-item">
                  <div class="text-h6 font-weight-bold text-primary">{{ taskStats.total }}</div>
                  <div class="text-caption">{{ t('home.total_tasks') }}</div>
                </div>
              </v-col>
              <v-col cols="6" sm="4" md="2">
                <div class="text-center task-stat-item">
                  <div class="text-h6 font-weight-bold text-success">{{ taskStats.running }}</div>
                  <div class="text-caption">{{ t('home.running') }}</div>
                </div>
              </v-col>
              <v-col cols="6" sm="4" md="2">
                <div class="text-center task-stat-item">
                  <div class="text-h6 font-weight-bold text-warning">{{ taskStats.pending }}</div>
                  <div class="text-caption">{{ t('home.pending') }}</div>
                </div>
              </v-col>
              <v-col cols="6" sm="4" md="2">
                <div class="text-center task-stat-item">
                  <div class="text-h6 font-weight-bold text-info">{{ taskStats.completed }}</div>
                  <div class="text-caption">{{ t('home.completed') }}</div>
                </div>
              </v-col>
              <v-col cols="6" sm="4" md="2">
                <div class="text-center task-stat-item">
                  <div class="text-h6 font-weight-bold text-error">{{ taskStats.failed }}</div>
                  <div class="text-caption">{{ t('home.failed') }}</div>
                </div>
              </v-col>
              <v-col cols="6" sm="4" md="2">
                <div class="text-center task-stat-item">
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
                  placeholder="Search by task name or platform..."
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
                  :disabled="loading"
                >
                  {{ t('home.clear_filters') }}
                </v-btn>
                <v-chip
                  v-if="loading"
                  color="info"
                  size="small"
                  class="ml-2"
                >
                  <v-icon size="small" class="mr-1">mdi-loading</v-icon>
                  Applying filters...
                </v-chip>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
        
        <!-- Active Filters Summary -->
        <div v-if="hasActiveFilters" class="mt-2">
          <v-chip
            v-if="searchQuery"
            color="primary"
            size="small"
            closable
            @click:close="removeFilter('search')"
            class="mr-2 mb-1"
          >
            <v-icon size="small" class="mr-1">mdi-magnify</v-icon>
            Search: "{{ searchQuery }}"
          </v-chip>
          <v-chip
            v-if="statusFilter"
            color="success"
            size="small"
            closable
            @click:close="removeFilter('status')"
            class="mr-2 mb-1"
          >
            <v-icon size="small" class="mr-1">mdi-filter</v-icon>
            Status: {{ statusOptions.find(s => s.value === statusFilter)?.title }}
          </v-chip>
          <v-chip
            v-if="platformFilter"
            color="info"
            size="small"
            closable
            @click:close="removeFilter('platform')"
            class="mr-2 mb-1"
          >
            <v-icon size="small" class="mr-1">mdi-web</v-icon>
            Platform: {{ platformOptions.find(p => p.value === platformFilter)?.title }}
          </v-chip>
          <v-chip
            v-if="priorityFilter"
            color="warning"
            size="small"
            closable
            @click:close="removeFilter('priority')"
            class="mr-2 mb-1"
          >
            <v-icon size="small" class="mr-1">mdi-priority-high</v-icon>
            Priority: {{ priorityOptions.find(p => p.value === priorityFilter)?.title }}
          </v-chip>
        </div>
      </v-col>
    </v-row>

    <!-- Task Table -->
    <v-row>
      <v-col cols="12">
        <v-card>
          <v-card-title class="d-flex justify-space-between align-center">
            <div>
              <span>{{ t('home.tasks') }} ({{ total }})</span>
              <v-chip
                v-if="hasActiveFilters"
                color="info"
                size="small"
                class="ml-2"
              >
                {{ total }} of {{ totalUnfiltered }} tasks match filters
              </v-chip>
            </div>
            <v-chip color="info" size="small">
              {{ t('home.page') }} {{ currentPage + 1 }} {{ t('home.of') }} {{ Math.ceil(total / pageSize) }}
            </v-chip>
          </v-card-title>
          <v-card-text>
            <div v-if="!loading && hasActiveFilters && total === 0" class="text-center py-8">
              <v-icon size="64" color="grey-lighten-1" class="mb-4">mdi-filter-off</v-icon>
              <h3 class="text-h6 text-grey-darken-1 mb-2">No tasks match your filters</h3>
              <p class="text-body-2 text-grey-darken-1 mb-4">
                Try adjusting your search criteria or clearing some filters
              </p>
              <v-btn
                color="primary"
                variant="outlined"
                @click="clearFilters"
              >
                Clear All Filters
              </v-btn>
            </div>
            <YellowPagesTaskTable
              v-else
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
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import YellowPagesTaskTable from './components/YellowPagesTaskTable.vue'
import TaskDetailsView from './components/TaskDetailsView.vue'
import { getYellowPagesTaskList, getYellowPagesPlatforms, killProcessByPID, startYellowPagesTask, pauseYellowPagesTask, resumeYellowPagesTask } from '@/views/api/yellowpages'
import { TaskStatus, TaskSummary } from '@/interfaces/ITaskManager'
import { PlatformSummary } from '@/interfaces/IPlatformConfig'

// Router and i18n
const router = useRouter()
const { t } = useI18n()

// Reactive data
const loading = ref(false)
const searchQuery = ref('')
const statusFilter = ref<TaskStatus | ''>('')
const platformFilter = ref('')
const priorityFilter = ref('')
const currentPage = ref(0)
const pageSize = ref(10)
const total = ref(0)
const totalUnfiltered = ref(0) // Track total unfiltered count
const tasks = ref<TaskSummary[]>([])
const platforms = ref<PlatformSummary[]>([])

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

// Computed properties
const hasActiveFilters = computed(() => {
  return !!(searchQuery.value || statusFilter.value || platformFilter.value || priorityFilter.value)
})

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

// Debounced search functionality
let searchTimeout: NodeJS.Timeout | null = null

// Watch for search query changes with debouncing
watch(searchQuery, (newQuery) => {
  // Clear existing timeout
  if (searchTimeout) {
    clearTimeout(searchTimeout)
  }
  
  // Set new timeout for debounced search
  searchTimeout = setTimeout(() => {
    if (newQuery !== undefined) {
      handleSearch()
    }
  }, 300) // 300ms delay
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
      totalUnfiltered.value = response.length
      updateTaskStats()
    } else {
      tasks.value = []
      total.value = 0
      totalUnfiltered.value = 0
      updateTaskStats()
    }
  } catch (error) {
    console.error('Failed to load tasks:', error)
    // Fallback to empty state on error
    tasks.value = []
    total.value = 0
    totalUnfiltered.value = 0
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
  // Reset to first page when searching
  currentPage.value = 0
  // Apply filters and search
  applyFiltersAndSearch()
}

const handleFilter = () => {
  // Reset to first page when filtering
  currentPage.value = 0
  // Apply filters and search
  applyFiltersAndSearch()
}

const applyFiltersAndSearch = () => {
  loading.value = true
  
  // Create filter object for API call
  const filters: any = {
    offset: currentPage.value * pageSize.value,
    limit: pageSize.value
  }
  
  // Add status filter
  if (statusFilter.value) {
    filters.status = statusFilter.value
  }
  
  // Add platform filter
  if (platformFilter.value) {
    filters.platform = platformFilter.value
  }
  
  // Load tasks with filters
  loadTasksWithFilters(filters)
}

const loadTasksWithFilters = async (filters: any) => {
  try {
    const response = await getYellowPagesTaskList(filters)
    
    if (response && response.length > 0) {
      // Apply client-side filtering for search and priority
      let filteredTasks = response
      
      // Apply search query filtering (client-side since TaskSummary doesn't have search field)
      if (searchQuery.value && searchQuery.value.trim()) {
        const searchTerm = searchQuery.value.trim().toLowerCase()
        filteredTasks = filteredTasks.filter(task => {
          // Search in task name
          if (task.name && task.name.toLowerCase().includes(searchTerm)) {
            return true
          }
          // Search in platform
          if (task.platform && task.platform.toLowerCase().includes(searchTerm)) {
            return true
          }
          return false
        })
      }
      
      // Apply priority filter (client-side since TaskSummary doesn't have priority field)
      if (priorityFilter.value) {
        // Note: Priority filtering is not available in the current TaskSummary interface
        // This filter will be applied when the backend supports it
        // For now, we'll show all tasks when priority filter is selected
        console.log('Priority filtering not yet implemented in backend')
      }
      
      tasks.value = filteredTasks
      total.value = filteredTasks.length
      // Keep totalUnfiltered as the original count
      updateTaskStats()
    } else {
      tasks.value = []
      total.value = 0
      // Keep totalUnfiltered as the original count
      updateTaskStats()
    }
  } catch (error) {
    console.error('Failed to load tasks with filters:', error)
    // Fallback to empty state on error
    tasks.value = []
    total.value = 0
    updateTaskStats()
  } finally {
    loading.value = false
  }
}

const clearFilters = () => {
  searchQuery.value = ''
  statusFilter.value = ''
  platformFilter.value = ''
  priorityFilter.value = ''
  // Reset to first page
  currentPage.value = 0
  // Load tasks without filters
  loadTasks()
}

const removeFilter = (filterType: 'search' | 'status' | 'platform' | 'priority') => {
  switch (filterType) {
    case 'search':
      searchQuery.value = ''
      break
    case 'status':
      statusFilter.value = ''
      break
    case 'platform':
      platformFilter.value = ''
      break
    case 'priority':
      priorityFilter.value = ''
      break
  }
  // Apply remaining filters
  applyFiltersAndSearch()
}

const handlePageChange = (page: number) => {
  currentPage.value = page
  // Check if we have active filters or search
  if (searchQuery.value || statusFilter.value || platformFilter.value || priorityFilter.value) {
    // Apply filters and search for the new page
    applyFiltersAndSearch()
  } else {
    // Load tasks normally for the new page
    loadTasks()
  }
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
    await startYellowPagesTask(task.id)
    await loadTasks()
  } catch (error) {
    console.error('Failed to start task:', error)
  }
}

const stopTask = async (task: any) => {
  try {
    // Check if task has a PID (is currently running)
    if (!task.pid) {
      console.warn(`Task ${task.id} has no PID, cannot stop process`);
      // Show user feedback that task is not running
      alert(`Task "${task.name}" is not currently running`);
      return;
    }

    console.log(`Stopping task ${task.id} with PID ${task.pid}`);
    
    // Show confirmation dialog
    if (!confirm(`Are you sure you want to stop task "${task.name}" (PID: ${task.pid})?`)) {
      return;
    }
    
    // Use the new PID-based process killing
    const result = await killProcessByPID(task.pid);
    
    if (result.success) {
      console.log(`Successfully stopped process for task ${task.id}: ${result.message}`);
      // Show success message
      alert(`Successfully stopped task "${task.name}"`);
      // Refresh the task list to show updated status
      await loadTasks();
    } else {
      console.error(`Failed to stop process for task ${task.id}: ${result.message}`);
      // Show error message to user
      alert(`Failed to stop task "${task.name}": ${result.message}`);
    }
  } catch (error) {
    console.error(`Failed to stop task ${task.id}:`, error);
    // Show error message to user
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    alert(`Error stopping task "${task.name}": ${errorMessage}`);
  }
}

const pauseTask = async (task: any) => {
  try {
    // TODO: Replace with actual API call
    await pauseYellowPagesTask(task.id)
    await loadTasks()
  } catch (error) {
    console.error('Failed to pause task:', error)
  }
}

const resumeTask = async (task: any) => {
  try {
    // TODO: Replace with actual API call
    await resumeYellowPagesTask(task.id)
    await loadTasks()
  } catch (error) {
    console.error('Failed to resume task:', error)
  }
}

const viewTaskResults = (task: any) => {
  // Check if task has results
  if (!task.results_count || task.results_count === 0) {
    // Show a message for tasks with no results
    const message = task.status === TaskStatus.InProgress 
      ? 'Task is still running. Results will be available when scraping completes.'
      : 'This task has no results yet.';
    
    // You could add a toast notification here
    console.log(message);
    
    // Optionally, you could show an alert or use a notification system
    if (confirm(message + '\n\nDo you still want to view the results page?')) {
      router.push(`/yellowpages/results/${task.id}`)
    }
  } else {
    // Task has results, navigate directly
    router.push(`/yellowpages/results/${task.id}`)
  }
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

/* Task Status Overview responsive improvements */
.task-status-overview .v-col {
  padding: 8px;
}

.task-status-overview .v-card-title {
  min-height: auto;
}

.task-status-overview .v-card-title .v-icon {
  flex-shrink: 0;
}

.task-stats-row {
  margin: 0;
}

.task-stat-item {
  padding: 8px 4px;
  min-height: 60px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

@media (max-width: 600px) {
  .task-status-overview .v-col {
    padding: 4px;
  }
  
  .task-status-overview .text-h6 {
    font-size: 1.1rem !important;
    line-height: 1.2;
  }
  
  .task-status-overview .text-caption {
    font-size: 0.75rem !important;
    line-height: 1.1;
  }
  
  .task-status-overview .v-card-title {
    padding: 16px 16px 8px 16px;
  }
  
  .task-status-overview .v-card-title .v-icon {
    margin-right: 8px !important;
    margin-bottom: 4px !important;
  }
  
  .task-stat-item {
    min-height: 50px;
    padding: 4px 2px;
  }
  
  .task-stats-row {
    margin: 0 -4px;
  }
}

@media (max-width: 960px) {
  .task-status-overview .v-card-text {
    padding: 16px;
  }
}

@media (min-width: 960px) {
  .task-status-overview .v-card-text {
    padding: 24px;
  }
}

/* Extra small screens */
@media (max-width: 400px) {
  .task-status-overview .v-col {
    padding: 2px;
  }
  
  .task-stat-item {
    min-height: 45px;
    padding: 2px 1px;
  }
  
  .task-status-overview .text-h6 {
    font-size: 1rem !important;
  }
  
  .task-status-overview .text-caption {
    font-size: 0.7rem !important;
  }
}
</style> 