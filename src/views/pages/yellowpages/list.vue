<template>
  <v-container fluid>
    <!-- Header with title and actions -->
    <v-row class="mb-4">
      <v-col cols="12" md="8">
        <h2 class="text-h4 font-weight-bold">
          <v-icon class="mr-2">mdi-phone-book</v-icon>
          Yellow Pages Task Management
        </h2>
        <p class="text-subtitle-1 text-medium-emphasis">
          Manage scraping tasks for Yellow Pages platforms
        </p>
      </v-col>
      <v-col cols="12" md="4" class="d-flex justify-end align-center">
        <v-btn
          color="primary"
          prepend-icon="mdi-plus"
          @click="createNewTask"
          class="mr-2"
        >
          New Task
        </v-btn>
        <v-btn
          color="secondary"
          prepend-icon="mdi-import"
          @click="importTasks"
          class="mr-2"
        >
          Import
        </v-btn>
        <v-btn
          color="secondary"
          prepend-icon="mdi-export"
          @click="exportTasks"
        >
          Export
        </v-btn>
      </v-col>
    </v-row>

    <!-- Task Status Overview -->
    <v-row class="mb-4">
      <v-col cols="12">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-chart-line</v-icon>
            Task Overview
          </v-card-title>
          <v-card-text>
            <v-row>
              <v-col cols="12" md="2">
                <div class="text-center">
                  <div class="text-h6 font-weight-bold text-primary">{{ taskStats.total }}</div>
                  <div class="text-caption">Total Tasks</div>
                </div>
              </v-col>
              <v-col cols="12" md="2">
                <div class="text-center">
                  <div class="text-h6 font-weight-bold text-success">{{ taskStats.running }}</div>
                  <div class="text-caption">Running</div>
                </div>
              </v-col>
              <v-col cols="12" md="2">
                <div class="text-center">
                  <div class="text-h6 font-weight-bold text-warning">{{ taskStats.pending }}</div>
                  <div class="text-caption">Pending</div>
                </div>
              </v-col>
              <v-col cols="12" md="2">
                <div class="text-center">
                  <div class="text-h6 font-weight-bold text-info">{{ taskStats.completed }}</div>
                  <div class="text-caption">Completed</div>
                </div>
              </v-col>
              <v-col cols="12" md="2">
                <div class="text-center">
                  <div class="text-h6 font-weight-bold text-error">{{ taskStats.failed }}</div>
                  <div class="text-caption">Failed</div>
                </div>
              </v-col>
              <v-col cols="12" md="2">
                <div class="text-center">
                  <div class="text-h6 font-weight-bold">{{ taskStats.successRate }}%</div>
                  <div class="text-caption">Success Rate</div>
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
                  label="Search tasks"
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
                  v-model="platformFilter"
                  :items="platformOptions"
                  label="Platform"
                  clearable
                  @update:model-value="handleFilter"
                />
              </v-col>
              <v-col cols="12" md="2">
                <v-select
                  v-model="priorityFilter"
                  :items="priorityOptions"
                  label="Priority"
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
                  Clear Filters
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
            <span>Tasks ({{ total }})</span>
            <v-chip color="info" size="small">
              Page {{ currentPage + 1 }} of {{ Math.ceil(total / pageSize) }}
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
          <v-btn color="secondary" @click="confirmDialog.show = false">Cancel</v-btn>
          <v-btn color="error" @click="confirmAction">Confirm</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Task Details Dialog -->
    <v-dialog v-model="taskDetailsDialog.show" max-width="800">
      <v-card>
        <v-card-title class="d-flex justify-space-between align-center">
          <span>Task Details</span>
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
import YellowPagesTaskTable from './components/YellowPagesTaskTable.vue'
import TaskDetailsView from './components/TaskDetailsView.vue'

// Router
const router = useRouter()

// Reactive data
const loading = ref(false)
const searchQuery = ref('')
const statusFilter = ref('')
const platformFilter = ref('')
const priorityFilter = ref('')
const currentPage = ref(0)
const pageSize = ref(10)
const total = ref(0)
const tasks = ref([])

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
  { title: 'Pending', value: 'pending' },
  { title: 'Running', value: 'running' },
  { title: 'Completed', value: 'completed' },
  { title: 'Failed', value: 'failed' },
  { title: 'Paused', value: 'paused' }
]

const platformOptions = [
  { title: 'YellowPages.com', value: 'yellowpages.com' },
  { title: 'Yelp.com', value: 'yelp.com' },
  { title: 'YellowPages.ca', value: 'yellowpages.ca' }
]

const priorityOptions = [
  { title: 'High', value: 'high' },
  { title: 'Medium', value: 'medium' },
  { title: 'Low', value: 'low' }
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
const loadTasks = async () => {
  loading.value = true
  try {
    // TODO: Replace with actual API call
    const response = await fetch('/api/yellow-pages/tasks', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    })
    
    if (response.ok) {
      const data = await response.json()
      tasks.value = data.tasks
      total.value = data.total
      updateTaskStats()
    }
  } catch (error) {
    console.error('Failed to load tasks:', error)
    // Mock data for development
    tasks.value = [
      {
        id: 1,
        name: 'Restaurant Search - NYC',
        platform: 'yellowpages.com',
        status: 'running',
        priority: 'high',
        progress: 65,
        created_at: '2024-01-15T10:30:00Z',
        updated_at: '2024-01-15T11:45:00Z',
        keywords: ['restaurant', 'pizza'],
        location: 'New York, NY',
        max_pages: 10,
        results_count: 156
      },
      {
        id: 2,
        name: 'Cafe Search - LA',
        platform: 'yelp.com',
        status: 'completed',
        priority: 'medium',
        progress: 100,
        created_at: '2024-01-14T09:00:00Z',
        updated_at: '2024-01-14T12:30:00Z',
        keywords: ['cafe', 'coffee'],
        location: 'Los Angeles, CA',
        max_pages: 5,
        results_count: 89
      },
      {
        id: 3,
        name: 'Bakery Search - Toronto',
        platform: 'yellowpages.ca',
        status: 'pending',
        priority: 'low',
        progress: 0,
        created_at: '2024-01-15T14:20:00Z',
        updated_at: '2024-01-15T14:20:00Z',
        keywords: ['bakery', 'bread'],
        location: 'Toronto, ON',
        max_pages: 8,
        results_count: 0
      }
    ]
    total.value = tasks.value.length
    updateTaskStats()
  } finally {
    loading.value = false
  }
}

const updateTaskStats = () => {
  const stats = {
    total: tasks.value.length,
    running: tasks.value.filter(t => t.status === 'running').length,
    pending: tasks.value.filter(t => t.status === 'pending').length,
    completed: tasks.value.filter(t => t.status === 'completed').length,
    failed: tasks.value.filter(t => t.status === 'failed').length,
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
  confirmDialog.title = 'Delete Task'
  confirmDialog.message = `Are you sure you want to delete task "${task.name}"?`
  confirmDialog.action = () => performDeleteTask(task.id)
  confirmDialog.show = true
}

const performDeleteTask = async (taskId: number) => {
  try {
    // TODO: Replace with actual API call
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