<template>
  <v-container fluid>
    <!-- Header -->
    <v-row class="mb-4">
      <v-col cols="12">
        <div class="d-flex align-center mb-2">
          <v-btn
            icon="mdi-arrow-left"
            variant="text"
            @click="goBack"
            class="mr-2"
          ></v-btn>
          <h2 class="text-h4 font-weight-bold">
            <v-icon class="mr-2">mdi-pencil</v-icon>
            Edit Yellow Pages Scraping Task
          </h2>
        </div>
        <p class="text-subtitle-1 text-medium-emphasis">
          Modify existing task configuration
        </p>
      </v-col>
    </v-row>

    <!-- Loading State -->
    <v-row v-if="loading">
      <v-col cols="12" class="text-center">
        <v-progress-circular
          indeterminate
          color="primary"
          size="64"
        ></v-progress-circular>
        <p class="mt-4">Loading task data...</p>
      </v-col>
    </v-row>

    <!-- Edit Form -->
    <v-row v-else-if="task">
      <v-col cols="12" lg="8">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-cog</v-icon>
            Task Configuration
          </v-card-title>
          <v-card-text>
            <v-form ref="form" v-model="formValid">
              <!-- Basic Information -->
              <v-row>
                <v-col cols="12" md="6">
                  <v-text-field
                    v-model="taskForm.name"
                    label="Task Name *"
                    placeholder="e.g., Restaurant Search - NYC"
                    :rules="[v => !!v || 'Task name is required']"
                    required
                    clearable
                  />
                </v-col>
                <v-col cols="12" md="6">
                  <v-select
                    v-model="taskForm.platform"
                    :items="platformOptions"
                    label="Platform *"
                    placeholder="Select a platform"
                    :rules="[v => !!v || 'Platform is required']"
                    required
                    clearable
                  />
                </v-col>
              </v-row>

              <!-- Keywords -->
              <v-row>
                <v-col cols="12">
                  <v-textarea
                    v-model="keywordsInput"
                    label="Keywords *"
                    placeholder="Enter keywords separated by commas (e.g., restaurant, pizza, italian)"
                    :rules="[v => !!v || 'At least one keyword is required']"
                    required
                    rows="3"
                    clearable
                    @update:model-value="updateKeywords"
                  />
                  <div class="d-flex flex-wrap mt-2">
                    <v-chip
                      v-for="keyword in taskForm.keywords"
                      :key="keyword"
                      closable
                      @click:close="removeKeyword(keyword)"
                      class="ma-1"
                      color="primary"
                      variant="outlined"
                    >
                      {{ keyword }}
                    </v-chip>
                  </div>
                </v-col>
              </v-row>

              <!-- Location -->
              <v-row>
                <v-col cols="12" md="6">
                  <v-text-field
                    v-model="taskForm.location"
                    label="Location *"
                    placeholder="e.g., New York, NY"
                    :rules="[v => !!v || 'Location is required']"
                    required
                    clearable
                  />
                </v-col>
                <v-col cols="12" md="6">
                  <v-text-field
                    v-model="taskForm.max_pages"
                    label="Max Pages"
                    type="number"
                    min="1"
                    max="100"
                    placeholder="10"
                    hint="Maximum number of pages to scrape"
                    persistent-hint
                    clearable
                  />
                </v-col>
              </v-row>

              <!-- Performance Settings -->
              <v-row>
                <v-col cols="12" md="6">
                  <v-text-field
                    v-model="taskForm.concurrency"
                    label="Concurrency"
                    type="number"
                    min="1"
                    max="10"
                    placeholder="2"
                    hint="Number of concurrent scraping processes"
                    persistent-hint
                    clearable
                  />
                </v-col>
                <v-col cols="12" md="6">
                  <v-text-field
                    v-model="taskForm.delay_between_requests"
                    label="Delay Between Requests (ms)"
                    type="number"
                    min="0"
                    max="10000"
                    placeholder="2000"
                    hint="Delay between requests to avoid rate limiting"
                    persistent-hint
                    clearable
                  />
                </v-col>
              </v-row>

              <!-- Account Selection -->
              <v-row>
                <v-col cols="12" md="6">
                  <v-select
                    v-model="taskForm.account_id"
                    :items="accountOptions"
                    label="Account (Optional)"
                    placeholder="Select an account for authentication"
                    clearable
                    hint="Use an account for authenticated scraping"
                    persistent-hint
                  />
                </v-col>
                <v-col cols="12" md="6">
                  <v-switch
                    v-model="useProxy"
                    label="Use Proxy"
                    color="primary"
                    hide-details
                  />
                </v-col>
              </v-row>

              <!-- Proxy Configuration -->
              <v-row v-if="useProxy">
                <v-col cols="12">
                  <v-card variant="outlined" class="pa-4">
                    <v-card-title class="text-subtitle-1 pa-0 mb-3">
                      Proxy Configuration
                    </v-card-title>
                    <v-row>
                      <v-col cols="12" md="6">
                        <v-text-field
                          v-model="proxyConfig.host"
                          label="Proxy Host"
                          placeholder="proxy.example.com"
                          clearable
                        />
                      </v-col>
                      <v-col cols="12" md="6">
                        <v-text-field
                          v-model="proxyConfig.port"
                          label="Proxy Port"
                          type="number"
                          placeholder="8080"
                          clearable
                        />
                      </v-col>
                    </v-row>
                    <v-row>
                      <v-col cols="12" md="6">
                        <v-text-field
                          v-model="proxyConfig.username"
                          label="Username (Optional)"
                          placeholder="username"
                          clearable
                        />
                      </v-col>
                      <v-col cols="12" md="6">
                        <v-text-field
                          v-model="proxyConfig.password"
                          label="Password (Optional)"
                          type="password"
                          placeholder="password"
                          clearable
                        />
                      </v-col>
                    </v-row>
                  </v-card>
                </v-col>
              </v-row>

              <!-- Task Status Warning -->
              <v-row v-if="task && task.status === 'running'">
                <v-col cols="12">
                  <v-alert
                    type="warning"
                    variant="tonal"
                    icon="mdi-alert"
                  >
                    <strong>Warning:</strong> This task is currently running. 
                    Some changes may not take effect until the task is restarted.
                  </v-alert>
                </v-col>
              </v-row>
            </v-form>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Sidebar -->
      <v-col cols="12" lg="4">
        <!-- Task Preview -->
        <v-card class="mb-4">
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-eye</v-icon>
            Task Preview
          </v-card-title>
          <v-card-text>
            <div class="text-body-2">
              <div class="d-flex justify-space-between mb-2">
                <span class="font-weight-medium">Name:</span>
                <span>{{ taskForm.name || 'Not set' }}</span>
              </div>
              <div class="d-flex justify-space-between mb-2">
                <span class="font-weight-medium">Platform:</span>
                <span>{{ taskForm.platform || 'Not set' }}</span>
              </div>
              <div class="d-flex justify-space-between mb-2">
                <span class="font-weight-medium">Keywords:</span>
                <span>{{ taskForm.keywords.length || 0 }} selected</span>
              </div>
              <div class="d-flex justify-space-between mb-2">
                <span class="font-weight-medium">Location:</span>
                <span>{{ taskForm.location || 'Not set' }}</span>
              </div>
              <div class="d-flex justify-space-between mb-2">
                <span class="font-weight-medium">Max Pages:</span>
                <span>{{ taskForm.max_pages || 'Not set' }}</span>
              </div>
              <div class="d-flex justify-space-between mb-2">
                <span class="font-weight-medium">Concurrency:</span>
                <span>{{ taskForm.concurrency || 'Not set' }}</span>
              </div>
            </div>
          </v-card-text>
        </v-card>

        <!-- Platform Information -->
        <v-card class="mb-4" v-if="selectedPlatform">
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-information</v-icon>
            Platform Info
          </v-card-title>
          <v-card-text>
            <div class="text-body-2">
              <div class="mb-2">
                <span class="font-weight-medium">Name:</span>
                <span>{{ selectedPlatform.display_name }}</span>
              </div>
              <div class="mb-2">
                <span class="font-weight-medium">Country:</span>
                <span>{{ selectedPlatform.country }}</span>
              </div>
              <div class="mb-2">
                <span class="font-weight-medium">Language:</span>
                <span>{{ selectedPlatform.language }}</span>
              </div>
              <div class="mb-2">
                <span class="font-weight-medium">Rate Limit:</span>
                <span>{{ selectedPlatform.rate_limit }} requests/hour</span>
              </div>
              <div class="mb-2">
                <span class="font-weight-medium">Status:</span>
                <v-chip
                  :color="selectedPlatform.is_active ? 'success' : 'error'"
                  size="small"
                >
                  {{ selectedPlatform.is_active ? 'Active' : 'Inactive' }}
                </v-chip>
              </div>
            </div>
          </v-card-text>
        </v-card>

        <!-- Action Buttons -->
        <v-card>
          <v-card-text>
            <v-btn
              color="primary"
              block
              size="large"
              @click="updateTask"
              :loading="updating"
              :disabled="!formValid"
              class="mb-3"
            >
              <v-icon class="mr-2">mdi-content-save</v-icon>
              Update Task
            </v-btn>
            <v-btn
              color="secondary"
              block
              variant="outlined"
              @click="goBack"
              class="mb-3"
            >
              Cancel
            </v-btn>
            <v-btn
              color="error"
              block
              variant="outlined"
              @click="deleteTask"
              :loading="deleting"
            >
              <v-icon class="mr-2">mdi-delete</v-icon>
              Delete Task
            </v-btn>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Error State -->
    <v-row v-else-if="error">
      <v-col cols="12">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon color="error" class="mr-2">mdi-alert-circle</v-icon>
            Error Loading Task
          </v-card-title>
          <v-card-text>
            <p class="text-error">{{ error }}</p>
            <v-btn color="primary" @click="loadTask" class="mt-3">
              <v-icon class="mr-2">mdi-refresh</v-icon>
              Try Again
            </v-btn>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Success Dialog -->
    <v-dialog v-model="successDialog.show" max-width="500">
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon color="success" class="mr-2">mdi-check-circle</v-icon>
          Task Updated Successfully
        </v-card-title>
        <v-card-text>
          <p class="mb-3">Your Yellow Pages scraping task has been updated successfully!</p>
          <div class="d-flex flex-column">
            <span><strong>Task ID:</strong> {{ successDialog.taskId }}</span>
            <span><strong>Name:</strong> {{ successDialog.taskName }}</span>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="primary" @click="goToTaskList">View All Tasks</v-btn>
          <v-btn color="secondary" @click="goToTaskDetail">View Task Details</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Error Dialog -->
    <v-dialog v-model="errorDialog.show" max-width="500">
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon color="error" class="mr-2">mdi-alert-circle</v-icon>
          Error Updating Task
        </v-card-title>
        <v-card-text>
          <p class="text-error">{{ errorDialog.message }}</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="primary" @click="errorDialog.show = false">OK</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete Confirmation Dialog -->
    <v-dialog v-model="deleteDialog.show" max-width="400">
      <v-card>
        <v-card-title>Confirm Delete</v-card-title>
        <v-card-text>
          <p>Are you sure you want to delete task "{{ task?.name }}"?</p>
          <p class="text-caption text-medium-emphasis">
            This action cannot be undone and will also delete all associated results.
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="secondary" @click="deleteDialog.show = false">Cancel</v-btn>
          <v-btn color="error" @click="confirmDelete" :loading="deleting">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { PlatformConfig } from '@/interfaces/IPlatformConfig'
import { 
  getYellowPagesTaskDetail, 
  updateYellowPagesTask, 
  deleteYellowPagesTask, 
  getYellowPagesPlatforms 
} from '@/views/api/yellowpages'

// Task interface for form data
interface YellowPagesTaskForm {
  name: string
  platform: string
  keywords: string[]
  location: string
  max_pages: number
  concurrency: number
  delay_between_requests: number
  account_id: number | null
  proxy_config: {
    host: string
    port: number
    username?: string
    password?: string
  } | null
}

// Task data interface from API
interface YellowPagesTaskData {
  name: string
  platform: string
  keywords: string[]
  location: string
  max_pages: number
  concurrency: number
  delay_between_requests: number
  account_id: number | null
  status?: string
  proxy_config?: {
    host: string
    port: number
    username?: string
    password?: string
  } | null
}

// Router
const router = useRouter()
const route = useRoute()

// Form validation
const form = ref()
const formValid = ref(false)

// Task data
const task = ref<YellowPagesTaskData | null>(null)
const loading = ref(true)
const error = ref('')
const updating = ref(false)
const deleting = ref(false)

// Form data
const taskForm = reactive({
  name: '',
  platform: '',
  keywords: [] as string[],
  location: '',
  max_pages: 10,
  concurrency: 2,
  delay_between_requests: 2000,
  account_id: null as number | null,
  proxy_config: null as any
})

// UI state
const useProxy = ref(false)
const keywordsInput = ref('')

// Proxy configuration
const proxyConfig = reactive({
  host: '',
  port: '',
  username: '',
  password: ''
})

// Platform data
const platforms = ref<PlatformConfig[]>([])
const selectedPlatform = computed((): PlatformConfig | undefined => {
  return platforms.value.find(p => p.name === taskForm.platform)
})

// Account data
const accounts = ref<Array<{ id: number; name: string; email: string }>>([])

// Dialog states
const successDialog = reactive({
  show: false,
  taskId: 0,
  taskName: ''
})

const errorDialog = reactive({
  show: false,
  message: ''
})

const deleteDialog = reactive({
  show: false
})

// Options
const platformOptions = computed(() => {
  return platforms.value.map((p: PlatformConfig) => ({
    title: p.display_name,
    value: p.name
  }))
})

const accountOptions = computed(() => {
  return accounts.value.map((a: { id: number; name: string; email: string }) => ({
    title: a.name || a.email,
    value: a.id
  }))
})

// Methods
const loadTask = async () => {
  loading.value = true
  error.value = ''
  
  try {
    const taskId = parseInt(route.params.id as string)
    
    // Load task using API
    const response = await getYellowPagesTaskDetail(taskId)
    
    if (response.status) {
      task.value = response.data
      
      // Populate form with task data
      if (task.value) {
        taskForm.name = task.value.name
        taskForm.platform = task.value.platform
        taskForm.keywords = task.value.keywords || []
        taskForm.location = task.value.location
        taskForm.max_pages = task.value.max_pages || 10
        taskForm.concurrency = task.value.concurrency || 2
        taskForm.delay_between_requests = task.value.delay_between_requests || 2000
        taskForm.account_id = task.value.account_id || null
        
        // Update keywords input
        keywordsInput.value = taskForm.keywords.join(', ')
        
        // Handle proxy config
        if (task.value.proxy_config) {
          useProxy.value = true
          proxyConfig.host = task.value.proxy_config.host || ''
          proxyConfig.port = task.value.proxy_config.port?.toString() || ''
          proxyConfig.username = task.value.proxy_config.username || ''
          proxyConfig.password = task.value.proxy_config.password || ''
        }
      }
      
    } else {
      error.value = response.msg || 'Failed to load task'
    }
    
  } catch (err) {
    console.error('Failed to load task:', err)
    error.value = 'Failed to load task data'
  } finally {
    loading.value = false
  }
}

const updateKeywords = () => {
  if (keywordsInput.value) {
    const newKeywords = keywordsInput.value
      .split(',')
      .map(k => k.trim())
      .filter(k => k.length > 0)
    
    // Remove duplicates
    const uniqueKeywords = [...new Set([...taskForm.keywords, ...newKeywords])]
    taskForm.keywords = uniqueKeywords
  }
}

const removeKeyword = (keyword: string) => {
  taskForm.keywords = taskForm.keywords.filter(k => k !== keyword)
  // Update the input field
  keywordsInput.value = taskForm.keywords.join(', ')
}

const validateForm = () => {
  if (!form.value) return false
  
  const { valid } = form.value.validate()
  return valid
}

const updateTask = async () => {
  if (!validateForm()) return
  
  updating.value = true
  
  try {
    const taskId = parseInt(route.params.id as string)
    
    // Prepare update data
    const updateData: any = {
      name: taskForm.name,
      platform: taskForm.platform,
      keywords: taskForm.keywords,
      location: taskForm.location,
      max_pages: taskForm.max_pages || 1,
      concurrency: taskForm.concurrency || 1,
      delay_between_requests: taskForm.delay_between_requests || 2000,
      account_id: taskForm.account_id
    }

    // Add proxy config if enabled
    if (useProxy.value && proxyConfig.host && proxyConfig.port) {
      updateData.proxy_config = {
        host: proxyConfig.host,
        port: parseInt(proxyConfig.port),
        username: proxyConfig.username || undefined,
        password: proxyConfig.password || undefined
      }
    } else {
      updateData.proxy_config = null
    }

    // Update task using API
    await updateYellowPagesTask(taskId, updateData).catch((err) => {
      errorDialog.message = err instanceof Error ? err.message : 'An unexpected error occurred'
      errorDialog.show = true
    })

  } catch (err) {
    console.error('Failed to update task:', err)
    errorDialog.message = err instanceof Error ? err.message : 'An unexpected error occurred'
    errorDialog.show = true
  } finally {
    updating.value = false
  }
}

const deleteTask = () => {
  deleteDialog.show = true
}

const confirmDelete = async () => {
  deleting.value = true
  
  try {
    const taskId = parseInt(route.params.id as string)
    
    // Delete task using API
    await deleteYellowPagesTask(taskId).catch((err) => {
      errorDialog.message = err instanceof Error ? err.message : 'An unexpected error occurred'
      errorDialog.show = true
    })
    
    //deleteDialog.show = false
    goToTaskList()
    
  } catch (err) {
    console.error('Failed to delete task:', err)
    errorDialog.message = err instanceof Error ? err.message : 'An unexpected error occurred'
    errorDialog.show = true
  } finally {
    deleting.value = false
  }
}

const loadPlatforms = async () => {
  try {
    const response = await getYellowPagesPlatforms()
    
    if (response) {
      platforms.value = response || []
    } else {
      console.error('Failed to load platforms')
    }
  } catch (error) {
    console.error('Failed to load platforms:', error)
  }
}

const loadAccounts = async () => {
  try {
    // TODO: Replace with actual account loading
    accounts.value = [
      { id: 1, name: 'Default Account', email: 'default@example.com' },
      { id: 2, name: 'Premium Account', email: 'premium@example.com' }
    ]
  } catch (error) {
    console.error('Failed to load accounts:', error)
  }
}

const goBack = () => {
  router.push('/yellowpages/list')
}

const goToTaskList = () => {
  successDialog.show = false
  router.push('/yellowpages/list')
}

const goToTaskDetail = () => {
  successDialog.show = false
  router.push(`/yellowpages/detail/${successDialog.taskId}`)
}

// Watch for platform changes to update form validation
watch(() => taskForm.platform, (newPlatform) => {
  if (newPlatform && selectedPlatform.value && !selectedPlatform.value.is_active) {
    errorDialog.message = `Platform "${selectedPlatform.value.display_name}" is currently inactive`
    errorDialog.show = true
  }
})

// Lifecycle
onMounted(() => {
  loadPlatforms()
  loadAccounts()
  loadTask()
})
</script>

<style scoped>
.v-card {
  border-radius: 8px;
}

.v-btn {
  text-transform: none;
}

.v-chip {
  cursor: pointer;
}
</style>
