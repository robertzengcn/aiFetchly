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
            <v-icon class="mr-2">mdi-plus-circle</v-icon>
            {{ $t('home.create_yellow_pages_task') }}
          </h2>
        </div>
        <p class="text-subtitle-1 text-medium-emphasis">
          {{ $t('home.configure_yellow_pages_task') }}
        </p>
      </v-col>
    </v-row>

    <!-- Main Form -->
    <v-row>
      <v-col cols="12" lg="8">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-cog</v-icon>
            {{ $t('home.task_configuration') }}
          </v-card-title>
          <v-card-text>
            <v-form ref="form" v-model="formValid">
              <!-- Basic Information -->
              <v-row>
                <v-col cols="12" md="6">
                  <v-text-field
                    v-model="taskForm.name"
                    :label="$t('home.task_name') + ' *'"
                    :placeholder="$t('home.task_name_placeholder')"
                    :rules="[v => !!v || $t('home.task_name_required')]"
                    required
                    clearable
                  />
                </v-col>
                <v-col cols="12" md="6">
                  <v-select
                    v-model="taskForm.platform"
                    :items="platformOptions"
                    :label="$t('home.platform') + ' *'"
                    :placeholder="$t('home.platform_placeholder')"
                    :rules="[v => !!v || $t('home.platform_required')]"
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
                    :label="$t('home.keywords') + ' *'"
                    :placeholder="$t('home.keywords_placeholder')"
                    :rules="[v => !!v || $t('home.keywords_required')]"
                    required
                    rows="3"
                    clearable
                    
                  />
                  <!-- <div class="d-flex flex-wrap mt-2">
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
                  </div> -->
                </v-col>
              </v-row>

              <!-- Location -->
              <v-row>
                <v-col cols="12" md="6">
                  <v-text-field
                    v-model="taskForm.location"
                    :label="$t('home.location') + ' *'"
                    :placeholder="$t('home.location_placeholder')"
                    :rules="[v => !!v || $t('home.location_required')]"
                    required
                    clearable
                  />
                </v-col>
                <v-col cols="12" md="6">
                  <v-text-field
                    v-model="taskForm.max_pages"
                    :label="$t('home.max_pages')"
                    type="number"
                    min="1"
                    max="100"
                    placeholder="10"
                    :hint="$t('home.max_pages_hint')"
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
                    :label="$t('home.concurrency')"
                    type="number"
                    min="1"
                    max="10"
                    placeholder="2"
                    :hint="$t('home.concurrency_hint')"
                    persistent-hint
                    clearable
                  />
                </v-col>
                <v-col cols="12" md="6">
                  <v-text-field
                    v-model="taskForm.delay_between_requests"
                    :label="$t('home.delay_between_requests')"
                    type="number"
                    min="0"
                    max="10000"
                    placeholder="2000"
                    :hint="$t('home.delay_hint')"
                    persistent-hint
                    clearable
                  />
                </v-col>
              </v-row>

              <!-- Account Selection -->
              <v-row>
                <v-col cols="12" md="6">
                  <p class="mb-2">Use account</p>
                  <v-btn-toggle v-model="useAccount" mandatory>
                    <v-btn :value="false" color="primary">No</v-btn>
                    <v-btn :value="true" color="success">Yes</v-btn>
                  </v-btn-toggle>
                </v-col>
                <v-col cols="12" md="6">
                  <v-switch
                    v-model="useProxy"
                    :label="$t('home.use_proxy')"
                    color="primary"
                    hide-details
                  />
                </v-col>
              </v-row>
              <v-row v-if="useAccount === true">
                <v-col cols="12">
                  <AccountSelectedTable
                    :accountSource="taskForm.platform"
                    :preSelectedAccounts="selectedAccounts"
                    @change="handleAccountChange"
                  />
                </v-col>
              </v-row>

              <!-- Proxy Configuration -->
              <v-row v-if="useProxy">
                <v-col cols="12">
                  <v-card variant="outlined" class="pa-4">
                    <v-card-title class="text-subtitle-1 pa-0 mb-3">
                      {{ $t('home.proxy_configuration') }}
                    </v-card-title>
                    <v-combobox v-model="proxyValue" :items="proxyValue" label="Select proxy" item-title="host" multiple return-object chips clearable></v-combobox>
                    <v-btn color="primary" @click="showProxytable">{{ $t('search.choose_proxy') }}</v-btn>

                    <div v-if="proxytableshow" class="mt-3">
                      <ProxyTableselected @change="handleSelectedChanged" />
                    </div>
                  </v-card>
                </v-col>
              </v-row>

              <!-- Scheduling -->
              <v-row>
                <v-col cols="12">
                  <v-card variant="outlined" class="pa-4">
                    <v-card-title class="text-subtitle-1 pa-0 mb-3">
                      {{ $t('home.scheduling_optional') }}
                    </v-card-title>
                    <v-row>
                      <v-col cols="12" md="6">
                        <v-switch
                          v-model="scheduleTask"
                          :label="$t('home.schedule_task')"
                          color="primary"
                          hide-details
                        />
                      </v-col>
                      <v-col cols="12" md="6" v-if="scheduleTask">
                        <v-text-field
                          v-model="scheduledTime"
                          :label="$t('home.scheduled_time')"
                          type="datetime-local"
                          clearable
                        />
                      </v-col>
                    </v-row>
                  </v-card>
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
            {{ $t('home.task_preview') }}
          </v-card-title>
          <v-card-text>
            <div class="text-body-2">
              <div class="d-flex justify-space-between mb-2">
                <span class="font-weight-medium">{{ $t('home.name') }}:</span>
                <span>{{ taskForm.name || 'Not set' }}</span>
              </div>
              <div class="d-flex justify-space-between mb-2">
                <span class="font-weight-medium">{{ $t('home.platform') }}:</span>
                <span>{{ taskForm.platform || 'Not set' }}</span>
              </div>
              <div class="d-flex justify-space-between mb-2">
                <span class="font-weight-medium">{{ $t('home.keywords') }}:</span>
                <span>{{ taskForm.keywords.length || 0 }} selected</span>
              </div>
              <div class="d-flex justify-space-between mb-2">
                <span class="font-weight-medium">{{ $t('home.location') }}:</span>
                <span>{{ taskForm.location || 'Not set' }}</span>
              </div>
              <div class="d-flex justify-space-between mb-2">
                <span class="font-weight-medium">{{ $t('home.max_pages') }}:</span>
                <span>{{ taskForm.max_pages || 'Not set' }}</span>
              </div>
              <div class="d-flex justify-space-between mb-2">
                <span class="font-weight-medium">{{ $t('home.concurrency') }}:</span>
                <span>{{ taskForm.concurrency || 'Not set' }}</span>
              </div>
            </div>
          </v-card-text>
        </v-card>

        <!-- Platform Information -->
        <v-card class="mb-4" v-if="selectedPlatform">
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-information</v-icon>
            {{ $t('home.platform_info') }}
          </v-card-title>
          <v-card-text>
            <div class="text-body-2">
              <div class="mb-2">
                <span class="font-weight-medium">{{ $t('home.name') }}:</span>
                <span>{{ selectedPlatform.display_name }}</span>
              </div>
              <div class="mb-2">
                <span class="font-weight-medium">{{ $t('home.country') }}:</span>
                <span>{{ selectedPlatform.country }}</span>
              </div>
              <div class="mb-2">
                <span class="font-weight-medium">{{ $t('home.language') }}:</span>
                <span>{{ selectedPlatform.language }}</span>
              </div>
              <div class="mb-2">
                <span class="font-weight-medium">{{ $t('home.rate_limit') }}:</span>
                <span>{{ selectedPlatform.rate_limit }} {{ $t('home.requests_per_hour') }}</span>
              </div>
              <div class="mb-2">
                <span class="font-weight-medium">{{ $t('home.status') }}:</span>
                <v-chip
                  :color="selectedPlatform.is_active ? 'success' : 'error'"
                  size="small"
                >
                  {{ selectedPlatform.is_active ? $t('home.active') : $t('home.inactive') }}
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
              @click="createTask"
              :loading="creating"
              :disabled="!formValid"
              class="mb-3"
            >
              <v-icon class="mr-2">mdi-play</v-icon>
              {{ $t('home.create_start_task') }}
            </v-btn>
            <v-btn
              color="secondary"
              block
              size="large"
              @click="createTaskOnly"
              :loading="creating"
              :disabled="!formValid"
              class="mb-3"
            >
              <v-icon class="mr-2">mdi-content-save</v-icon>
              {{ $t('home.create_task_only') }}
            </v-btn>
            <v-btn
              color="default"
              block
              variant="outlined"
              @click="goBack"
            >
              {{ $t('home.cancel') }}
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
          {{ $t('home.task_created_successfully') }}
        </v-card-title>
        <v-card-text>
          <p class="mb-3">{{ $t('home.task_created_message') }}</p>
          <div class="d-flex flex-column">
            <span><strong>Task ID:</strong> {{ successDialog.taskId }}</span>
            <span><strong>Name:</strong> {{ successDialog.taskName }}</span>
            <span><strong>Status:</strong> {{ successDialog.status }}</span>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="primary" @click="goToTaskList">{{ $t('home.view_all_tasks') }}</v-btn>
          <v-btn color="secondary" @click="goToTaskDetail">{{ $t('home.view_task_details') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Error Dialog -->
    <v-dialog v-model="errorDialog.show" max-width="500">
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon color="error" class="mr-2">mdi-alert-circle</v-icon>
          {{ $t('home.error_creating_task') }}
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
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { 
  createYellowPagesTask, 
  startYellowPagesTask, 
  getYellowPagesPlatforms 
} from '@/views/api/yellowpages'
import { PlatformConfig } from '@/interfaces/IPlatformConfig'
import AccountSelectedTable from '@/views/pages/socialaccount/widgets/AccountSelectedTable.vue'
import { SocialAccountListData } from '@/entityTypes/socialaccount-type'
import ProxyTableselected from '@/views/pages/proxy/widgets/ProxySelectedTable.vue'
import { ProxyEntity, ProxyListEntity } from '@/entityTypes/proxyType'

// Router
const router = useRouter()

// I18n
const { t: $t } = useI18n()

// Form validation
const form = ref()
const formValid = ref(false)

// Form data
const taskForm = reactive({
  name: '',
  platform: '',
  keywords: [] as string[],
  location: '',
  max_pages: 10,
  concurrency: 2,
  delay_between_requests: 2000,
  account_id: undefined as number | undefined,
  proxy_config: undefined as any,
  scheduled_at: undefined as Date | undefined
})

// UI state
const creating = ref(false)
const useProxy = ref(false)
const scheduleTask = ref(false)
const keywordsInput = ref('')
const scheduledTime = ref('')
const useAccount = ref(false)
const selectedAccounts = ref<SocialAccountListData[]>([])
const proxyValue = ref<Array<ProxyEntity>>([])
const proxytableshow = ref(false)

// Proxy configuration (replaced by ProxyTableselected selection)
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

// Dialog states
const successDialog = reactive({
  show: false,
  taskId: 0,
  taskName: '',
  status: ''
})

const errorDialog = reactive({
  show: false,
  message: ''
})

// Options
const platformOptions = computed(() => {
  return platforms.value.map((p: PlatformConfig) => ({
    title: p.display_name,
    value: p.name
  }))
})

// Methods
// const updateKeywords = () => {
//   if (keywordsInput.value) {
//     const newKeywords = keywordsInput.value
//       .split(',')
//       .map(k => k.trim())
//       .filter(k => k.length > 0)
    
//     // Remove duplicates
//     const uniqueKeywords = [...new Set([...taskForm.keywords, ...newKeywords])]
//     taskForm.keywords = uniqueKeywords
//   }
// }

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

const createTask = async () => {
  if (!validateForm()) return
  
  creating.value = true
  
  try {
    // Prepare task data
    const taskData = {
      ...taskForm,
      max_pages: taskForm.max_pages || 1,
      concurrency: taskForm.concurrency || 1,
      delay_between_requests: taskForm.delay_between_requests || 2000
    }

    // Set selected account if enabled
    if (useAccount.value && selectedAccounts.value.length > 0) {
      taskData.account_id = selectedAccounts.value[0].id
    } else {
      taskData.account_id = undefined
    }

    // Add proxy config if enabled
    if (useProxy.value && proxyValue.value.length > 0) {
      const p = proxyValue.value[0]
      taskData.proxy_config = {
        host: p.host,
        port: parseInt(String(p.port)),
        username: p.user || undefined,
        password: p.pass || undefined,
        protocol: p.protocol
      }
    }

    // Add scheduled time if enabled
    if (scheduleTask.value && scheduledTime.value) {
      taskData.scheduled_at = new Date(scheduledTime.value)
    } else {
      taskData.scheduled_at = undefined
    }

    // Create task using API
    const response = await createYellowPagesTask(taskData).catch((error) => {
      console.error('Failed to create task:', error)
      errorDialog.message = error instanceof Error ? error.message : 'An unexpected error occurred'
      errorDialog.show = true
      return null
    })
    
    if (response) {
      successDialog.taskId = response
      successDialog.taskName = taskData.name
      successDialog.status = 'pending'
      successDialog.show = true
      
      // Start the task immediately
      await startYellowPagesTask(response)
      successDialog.status = 'running'
    } else {
      throw new Error('Failed to create task')
    }
    
  } catch (error) {
    console.error('Failed to create task:', error)
    errorDialog.message = error instanceof Error ? error.message : 'An unexpected error occurred'
    errorDialog.show = true
  } finally {
    creating.value = false
  }
}

const createTaskOnly = async () => {
  if (!validateForm()) return
  
  creating.value = true
  
  try {
    // Prepare task data (same as createTask but without starting)
    const taskData = {
      ...taskForm,
      max_pages: taskForm.max_pages || 1,
      concurrency: taskForm.concurrency || 1,
      delay_between_requests: taskForm.delay_between_requests || 2000
    }

    if (useAccount.value && selectedAccounts.value.length > 0) {
      taskData.account_id = selectedAccounts.value[0].id
    } else {
      taskData.account_id = undefined
    }

    if (useProxy.value && proxyValue.value.length > 0) {
      const p = proxyValue.value[0]
      taskData.proxy_config = {
        host: p.host,
        port: parseInt(String(p.port)),
        username: p.user || undefined,
        password: p.pass || undefined,
        protocol: p.protocol
      }
    }

    if (scheduleTask.value && scheduledTime.value) {
      taskData.scheduled_at = new Date(scheduledTime.value)
    } else {
      taskData.scheduled_at = undefined
    }

    // Create task using API
    const response = await createYellowPagesTask(taskData).catch((error) => {
      console.error('Failed to create task:', error)
      errorDialog.message = error instanceof Error ? error.message : 'An unexpected error occurred'
      errorDialog.show = true
      return null
    })
    
    if (response) {
      successDialog.taskId = response
      successDialog.taskName = taskData.name
      successDialog.status = 'pending'
      successDialog.show = true
    } else {
      throw new Error( 'Failed to create task')
    }
    
  } catch (error) {
    console.error('Failed to create task:', error)
    errorDialog.message = error instanceof Error ? error.message : 'An unexpected error occurred'
    errorDialog.show = true
  } finally {
    creating.value = false
  }
}

const loadPlatforms = async () => {
  try {
    const response = await getYellowPagesPlatforms()
    console.log('platforms', response)
    if (response) {
      platforms.value = response || []
    } else {
      console.error('Failed to load platforms:', response)
    }
  } catch (error) {
    console.error('Failed to load platforms:', error)
  }
}

const loadAccounts = async () => {
  // Deprecated: Using AccountSelectedTable to load accounts directly
}

const handleAccountChange = (newValue: SocialAccountListData[]) => {
  selectedAccounts.value = newValue || []
  if (selectedAccounts.value.length > 0) {
    taskForm.account_id = selectedAccounts.value[0].id
  } else {
    taskForm.account_id = undefined
  }
}

const showProxytable = () => {
  proxytableshow.value = !proxytableshow.value
}

const handleSelectedChanged = (newValue: ProxyListEntity[]) => {
  if (newValue && newValue.length > 0) {
    for (let i = 0; i < newValue.length; i++) {
      if (newValue[i] && newValue[i].id) {
        let isexist = false
        for (let is = 0; is < proxyValue.value.length; is++) {
          if (proxyValue.value[is].id == newValue[i].id) {
            isexist = true
          }
        }
        if (!isexist) {
          if ((newValue[i].host) && (newValue[i].port)) {
            proxyValue.value.push({
              id: newValue[i].id,
              host: newValue[i].host!,
              port: newValue[i].port!,
              user: newValue[i].username,
              pass: newValue[i].password,
              protocol: newValue[i].protocol,
            })
          }
        }
      }
    }
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
