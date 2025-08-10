<template>
  <v-container fluid>
    <v-row class="mb-4">
      <v-col cols="12">
        <div class="d-flex align-center justify-space-between">
          <div>
            <h2 class="text-h4 font-weight-bold">
              <v-icon class="mr-2">mdi-tasks</v-icon>
              Task Management
            </h2>
            <p class="text-subtitle-1 text-medium-emphasis">
              Create, manage, and monitor your scraping tasks
            </p>
          </div>
          <div class="d-flex">
            <v-btn
              color="secondary"
              prepend-icon="mdi-cog"
              @click="goToPlatforms"
              class="mr-2"
            >
              Platform Management
            </v-btn>
            <v-btn
              color="primary"
              prepend-icon="mdi-plus"
              @click="openCreateTaskDialog"
            >
              Create New Task
            </v-btn>
          </div>
        </div>
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="12">
        <v-card>
          <v-card-title class="d-flex align-center justify-space-between">
            <span>Task List</span>
            <v-text-field
              v-model="searchQuery"
              prepend-inner-icon="mdi-magnify"
              label="Search tasks"
              single-line
              hide-details
              density="compact"
              style="max-width: 300px"
            />
          </v-card-title>
          <v-card-text>
            <TaskTable
              :tasks="filteredTasks"
              :loading="loading"
              @edit-task="editTask"
              @delete-task="deleteTask"
              @run-task="runTask"
              @view-results="viewResults"
            />
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-dialog v-model="createTaskDialog.show" max-width="800" persistent>
      <v-card>
        <v-card-title>Create New Task</v-card-title>
        <v-card-text>
          <TaskCreationForm
            :loading="createTaskDialog.loading"
            @submit="handleCreateTask"
            @cancel="closeCreateTaskDialog"
          />
        </v-card-text>
      </v-card>
    </v-dialog>

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
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import TaskTable from './widgets/TaskTable.vue'
import TaskCreationForm from './widgets/TaskCreationForm.vue'
import { TaskEntity } from '@/entityTypes/task-type'

const router = useRouter()

// Reactive data
const tasks = ref<TaskEntity[]>([])
const loading = ref(false)
const searchQuery = ref('')

// Dialogs
const createTaskDialog = ref({
  show: false,
  loading: false
})

const alertDialog = ref({
  show: false,
  title: '',
  message: '',
  type: 'info' as 'success' | 'error' | 'warning' | 'info'
})

// Computed properties
const filteredTasks = computed(() => {
  if (!searchQuery.value) return tasks.value
  
  const query = searchQuery.value.toLowerCase()
  return tasks.value.filter(task => 
    task.name.toLowerCase().includes(query) ||
    task.description?.toLowerCase().includes(query) ||
    task.platform.toLowerCase().includes(query)
  )
})

// Methods
const loadTasks = async () => {
  try {
    loading.value = true
    // Mock data for now
    tasks.value = [
      {
        id: 1,
        name: 'Google Search - Marketing Tools',
        description: 'Search for marketing tools on Google',
        platform: 'google',
        status: 'completed',
        keywords: ['marketing tools', 'digital marketing'],
        location: 'United States',
        numPages: 5,
        concurrency: 3,
        showBrowser: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        results_count: 45
      },
      {
        id: 2,
        name: 'LinkedIn Company Search',
        description: 'Search for companies on LinkedIn',
        platform: 'linkedin',
        status: 'running',
        keywords: ['tech companies', 'startups'],
        location: 'San Francisco',
        numPages: 10,
        concurrency: 2,
        showBrowser: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ]
  } catch (error) {
    showAlert('Error', `Failed to load tasks: ${error}`, 'error')
  } finally {
    loading.value = false
  }
}

const openCreateTaskDialog = () => {
  createTaskDialog.value.show = true
}

const closeCreateTaskDialog = () => {
  createTaskDialog.value.show = false
}

const handleCreateTask = async (taskData: any) => {
  try {
    createTaskDialog.value.loading = true
    console.log('Creating task:', taskData)
    // TODO: Implement API call to create task
    showAlert('Success', 'Task created successfully', 'success')
    closeCreateTaskDialog()
    await loadTasks() // Reload tasks
  } catch (error) {
    showAlert('Error', `Failed to create task: ${error}`, 'error')
  } finally {
    createTaskDialog.value.loading = false
  }
}

const goToPlatforms = () => {
  router.push({ name: 'PlatformManagement' })
}

const editTask = (task: TaskEntity) => {
  router.push({ name: 'EditTask', params: { id: task.id } })
}

const deleteTask = async (task: TaskEntity) => {
  try {
    // TODO: Implement API call to delete task
    showAlert('Success', 'Task deleted successfully', 'success')
    await loadTasks() // Reload tasks
  } catch (error) {
    showAlert('Error', `Failed to delete task: ${error}`, 'error')
  }
}

const runTask = async (task: TaskEntity) => {
  try {
    // TODO: Implement API call to run task
    showAlert('Success', 'Task started successfully', 'success')
    await loadTasks() // Reload tasks
  } catch (error) {
    showAlert('Error', `Failed to start task: ${error}`, 'error')
  }
}

const viewResults = (task: TaskEntity) => {
  router.push({ name: 'TaskResults', params: { id: task.id } })
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
  loadTasks()
})
</script>

<style scoped>
.v-container {
  max-width: 1200px;
  margin: 0 auto;
}
</style>
