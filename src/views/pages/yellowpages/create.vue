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
            <v-icon class="mr-2">
              {{ (isEditMode || isDetailMode) ? 'mdi-pencil' : 'mdi-plus-circle' }}
            </v-icon>
            {{ (isEditMode || isDetailMode) ? $t('home.edit_yellow_pages_task') : $t('home.create_yellow_pages_task') }}
          </h2>
        </div>
        <p class="text-subtitle-1 text-medium-emphasis">
          {{ (isEditMode || isDetailMode) ? $t('home.modify_yellow_pages_task') : $t('home.configure_yellow_pages_task') }}
        </p>
      </v-col>
    </v-row>

    <!-- Loading State -->
    <v-row v-if="loading && (isEditMode || isDetailMode)">
      <v-col cols="12" class="text-center">
        <v-progress-circular
          indeterminate
          color="primary"
          size="64"
        ></v-progress-circular>
        <p class="mt-4">{{ $t('home.loading_task_data') }}</p>
      </v-col>
    </v-row>

    <!-- Main Form -->
    <v-row v-else>
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
                    :label="$t('home.location')"
                    :placeholder="$t('home.location_placeholder')"
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

              <!-- Browser Settings -->
              <v-row>
                <v-col cols="12" md="6">
                  <v-switch
                    v-model="taskForm.headless"
                    :label="$t('home.headless_mode')"
                    color="primary"
                    hide-details
                    :hint="$t('home.headless_mode_hint')"
                    persistent-hint
                  />
                </v-col>
              </v-row>

              <!-- Account Selection -->
              <v-row>
                <v-col cols="12" md="6">
                  <p class="mb-2">Use account</p>
                  <v-btn-toggle 
                    v-model="useAccount" 
                    mandatory
                    :disabled="selectedPlatform?.authentication?.requiresCookies"
                  >
                    <v-btn :value="false" color="primary" :disabled="selectedPlatform?.authentication?.requiresCookies">No</v-btn>
                    <v-btn :value="true" color="success">Yes</v-btn>
                  </v-btn-toggle>
                  <div v-if="selectedPlatform?.authentication?.requiresCookies" class="mt-2">
                    <v-alert
                      type="warning"
                      variant="tonal"
                      density="compact"
                      class="mb-0"
                    >
                      <template v-slot:prepend>
                        <v-icon size="small">mdi-alert</v-icon>
                      </template>
                      <span class="text-caption">
                        Account required for platform: {{ selectedPlatform.display_name }}
                      </span>
                    </v-alert>
                  </div>
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
              <v-row v-if="useAccount === true || selectedPlatform?.authentication?.requiresCookies">
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
                    <v-card-title class="text-subtitle-1 pa-0 mb-3 d-flex align-center">
                      <v-icon class="mr-2">mdi-clock-outline</v-icon>
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
                        <v-select
                          v-model="scheduleType"
                          :items="scheduleTypeOptions"
                          :label="$t('home.schedule_type')"
                          @update:model-value="handleScheduleTypeChange"
                        />
                      </v-col>
                    </v-row>

                    <!-- One-time scheduling -->
                    <v-row v-if="scheduleTask && scheduleType === 'one-time'">
                      <v-col cols="12" md="6">
                        <v-text-field
                          v-model="scheduledTime"
                          :label="$t('home.scheduled_time')"
                          type="datetime-local"
                          :min="minDateTime"
                          clearable
                        />
                      </v-col>
                      <v-col cols="12" md="6">
                        <v-text-field
                          v-model="scheduleName"
                          :label="$t('home.schedule_name')"
                          :placeholder="$t('home.schedule_name_placeholder')"
                          clearable
                        />
                      </v-col>
                    </v-row>

                    <!-- Recurring scheduling -->
                    <v-row v-if="scheduleTask && scheduleType === 'recurring'">
                      <v-col cols="12" md="8">
                        <v-text-field
                          v-model="cronExpression"
                          :label="$t('home.cron_expression')"
                          :placeholder="$t('home.cron_expression_placeholder')"
                          :error-messages="cronValidationError"
                          @update:model-value="validateCronExpression"
                          clearable
                        />
                      </v-col>
                      <v-col cols="12" md="4" class="d-flex align-center">
                        <CronExpressionBuilder @expression-change="handleCronExpressionChange" />
                      </v-col>
                    </v-row>

                    <!-- Quick presets for recurring schedules -->
                    <v-row v-if="scheduleTask && scheduleType === 'recurring'">
                      <v-col cols="12">
                        <v-chip-group>
                          <v-chip
                            v-for="preset in cronPresets"
                            :key="preset.name"
                            :variant="preset.variant"
                            @click="applyCronPreset(preset.expression)"
                            class="ma-1"
                            size="small"
                          >
                            {{ preset.name }}
                          </v-chip>
                        </v-chip-group>
                      </v-col>
                    </v-row>

                    <!-- Next run preview for recurring schedules -->
                    <v-row v-if="scheduleTask && scheduleType === 'recurring' && cronExpression && !cronValidationError">
                      <v-col cols="12">
                        <v-alert
                          type="info"
                          variant="tonal"
                          class="mb-4"
                        >
                          <template v-slot:prepend>
                            <v-icon>mdi-clock</v-icon>
                          </template>
                          <div class="d-flex justify-space-between align-center">
                            <span>{{ $t('home.next_run_time', { time: nextRunTime }) }}</span>
                            <v-btn
                              size="small"
                              variant="outlined"
                              @click="calculateNextRunTime"
                            >
                              {{ $t('home.refresh') }}
                            </v-btn>
                          </div>
                        </v-alert>
                      </v-col>
                    </v-row>

                    <!-- Schedule options -->
                    <v-row v-if="scheduleTask">
                      <v-col cols="12" md="6">
                        <v-textarea
                          v-model="scheduleDescription"
                          :label="$t('home.schedule_description')"
                          :placeholder="$t('home.schedule_description_placeholder')"
                          rows="2"
                          clearable
                        />
                      </v-col>
                      <v-col cols="12" md="6">
                        <v-switch
                          v-model="scheduleActive"
                          :label="$t('home.schedule_active')"
                          color="success"
                          hide-details
                        />
                      </v-col>
                    </v-row>

                    <!-- Schedule preview -->
                    <v-row v-if="scheduleTask">
                      <v-col cols="12">
                        <v-alert
                          type="info"
                          variant="tonal"
                          class="mb-4"
                        >
                          <template v-slot:prepend>
                            <v-icon>mdi-information</v-icon>
                          </template>
                          <div class="text-body-2">
                            <div class="d-flex justify-space-between mb-2">
                              <span class="font-weight-medium">{{ $t('home.schedule_type') }}:</span>
                              <span>{{ scheduleType === 'one-time' ? $t('home.one_time') : $t('home.recurring') }}</span>
                            </div>
                            <div v-if="scheduleType === 'one-time'" class="d-flex justify-space-between mb-2">
                              <span class="font-weight-medium">{{ $t('home.run_at') }}:</span>
                              <span>{{ scheduledTime ? new Date(scheduledTime).toLocaleString() : 'Not set' }}</span>
                            </div>
                            <div v-if="scheduleType === 'recurring'" class="d-flex justify-space-between mb-2">
                              <span class="font-weight-medium">{{ $t('home.cron_expression') }}:</span>
                              <span class="font-family-mono">{{ cronExpression || 'Not set' }}</span>
                            </div>
                            <div class="d-flex justify-space-between mb-2">
                              <span class="font-weight-medium">{{ $t('home.schedule_name') }}:</span>
                              <span>{{ scheduleName || 'Not set' }}</span>
                            </div>
                            <div class="d-flex justify-space-between mb-2">
                              <span class="font-weight-medium">{{ $t('home.schedule_status') }}:</span>
                              <v-chip
                                :color="scheduleActive ? 'success' : 'warning'"
                                size="small"
                              >
                                {{ scheduleActive ? $t('home.active') : $t('home.inactive') }}
                              </v-chip>
                            </div>
                          </div>
                        </v-alert>
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
              <div class="d-flex justify-space-between mb-2">
                <span class="font-weight-medium">{{ $t('home.headless_mode') }}:</span>
                <span>{{ taskForm.headless ? 'Enabled' : 'Disabled' }}</span>
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
              
              <!-- Authentication Information -->
              <div v-if="selectedPlatform.authentication" class="mt-3 pt-3 border-top">
                <div class="mb-2">
                  <span class="font-weight-medium">Authentication:</span>
                </div>
                <div v-if="selectedPlatform.authentication.requiresCookies" class="mb-2">
                  <v-chip
                    color="warning"
                    size="small"
                    class="mr-2"
                  >
                    <v-icon size="small" class="mr-1">mdi-cookie</v-icon>
                    Requires Cookies
                  </v-chip>
                  <span class="text-caption text-medium-emphasis">
                    Account required for authentication
                  </span>
                </div>
                <div v-if="selectedPlatform.authentication.requiresLogin" class="mb-2">
                  <v-chip
                    color="info"
                    size="small"
                    class="mr-2"
                  >
                    <v-icon size="small" class="mr-1">mdi-login</v-icon>
                    Requires Login
                  </v-chip>
                </div>
                <div v-if="selectedPlatform.authentication.requiresApiKey" class="mb-2">
                  <v-chip
                    color="secondary"
                    size="small"
                    class="mr-2"
                  >
                    <v-icon size="small" class="mr-1">mdi-key</v-icon>
                    Requires API Key
                  </v-chip>
                </div>
                <div v-if="selectedPlatform.authentication.requiresOAuth" class="mb-2">
                  <v-chip
                    color="primary"
                    size="small"
                    class="mr-2"
                  >
                    <v-icon size="small" class="mr-1">mdi-oauth</v-icon>
                    Requires OAuth
                  </v-chip>
                </div>
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
              <v-icon class="mr-2">{{ (isEditMode || isDetailMode) ? 'mdi-content-save' : 'mdi-play' }}</v-icon>
              {{ (isEditMode || isDetailMode) ? $t('home.update_task') : $t('home.create_start_task') }}
            </v-btn>
            <v-btn
              color="secondary"
              block
              size="large"
              @click="createTaskOnly"
              :loading="creating"
              :disabled="!formValid"
              class="mb-3"
              v-if="!(isEditMode || isDetailMode)"
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
          {{ (isEditMode || isDetailMode) ? $t('home.task_updated_successfully') : $t('home.task_created_successfully') }}
        </v-card-title>
        <v-card-text>
          <p class="mb-3">{{ (isEditMode || isDetailMode) ? $t('home.task_updated_message') : $t('home.task_created_message') }}</p>
          <div class="d-flex flex-column">
            <span><strong>Task ID:</strong> {{ successDialog.taskId }}</span>
            <span><strong>Name:</strong> {{ successDialog.taskName }}</span>
            <span v-if="!(isEditMode || isDetailMode)"><strong>Status:</strong> {{ successDialog.status }}</span>
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
        <v-card-title class="d-flex align-center error-dialog-title">
          <v-icon color="error" class="mr-2">mdi-alert-circle</v-icon>
          {{ $t('home.error_creating_task') }}
        </v-card-title>
        <v-card-text>
          <div v-if="errorDialog.message.includes('\n')" class="text-error">
            <p class="mb-2 font-weight-medium">Please fix the following errors:</p>
            <ul class="ma-0 pa-0 error-list">
              <li 
                v-for="(error, index) in errorDialog.message.split('\n')" 
                :key="index"
                class="d-flex align-center mb-1"
              >
                <v-icon size="small" color="error" class="mr-2">mdi-close-circle</v-icon>
                {{ error }}
              </li>
            </ul>
          </div>
          <p v-else class="text-error">{{ errorDialog.message }}</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="primary" @click="errorDialog.show = false">OK</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Success Notification -->
    <SuccessNotification
      v-model="showSuccessNotification"
      :title="(isEditMode || isDetailMode) ? $t('home.task_updated_successfully') : $t('home.task_created_successfully')"
      :message="(isEditMode || isDetailMode) ? $t('home.task_updated_message') : $t('home.task_created_message')"
      color="success"
      icon="mdi-check-circle"
      :timeout="5000"
    />
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { 
  createYellowPagesTask, 
  startYellowPagesTask, 
  getYellowPagesPlatforms,
  getYellowPagesTaskDetail,
  updateYellowPagesTask
} from '@/views/api/yellowpages'
import { PlatformSummary } from '@/interfaces/IPlatformConfig'
import AccountSelectedTable from '@/views/pages/socialaccount/widgets/AccountSelectedTable.vue'
import { SocialAccountListData } from '@/entityTypes/socialaccount-type'
import ProxyTableselected from '@/views/pages/proxy/widgets/ProxySelectedTable.vue'
import { ProxyEntity, ProxyListEntity } from '@/entityTypes/proxyType'
import CronExpressionBuilder from '@/views/pages/schedule/widgets/CronExpressionBuilder.vue'
import { createSchedule } from '@/views/api/schedule'
import { TaskType, TriggerType } from '@/entity/ScheduleTask.entity'
import SuccessNotification from '@/views/components/widgets/SuccessNotification.vue'

// Router
const router = useRouter()
const route = useRoute()

// Check if we're in edit mode or detail mode
const isEditMode = computed(() => route.name === 'EditYellowPagesTask')
const isDetailMode = computed(() => route.name === 'YellowPagesTaskDetail')
const isCreateMode = computed(() => route.name === 'CreateYellowPagesTask')
const taskId = ref((isEditMode.value || isDetailMode.value) ? Number(route.params.id) : null)

// I18n
const { t: $t } = useI18n()

// Form validation
const form = ref<HTMLFormElement>()
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
  headless: true,
  account_id: undefined as number | undefined,
  proxy_config: undefined as any,
  scheduled_at: undefined as Date | undefined
})

// UI state
const creating = ref(false)
const loading = ref(false)
const useProxy = ref(false)
const scheduleTask = ref(false)
const keywordsInput = ref('')
const scheduledTime = ref('')
const useAccount = ref(false)
const selectedAccounts = ref<SocialAccountListData[]>([])
const proxyValue = ref<Array<ProxyEntity>>([])
const proxytableshow = ref(false)

// Scheduling variables
const scheduleType = ref<'one-time' | 'recurring'>('one-time')
const scheduleName = ref('')
const scheduleDescription = ref('')
const scheduleActive = ref(true)
const cronExpression = ref('')
const cronValidationError = ref('')
const nextRunTime = ref('')

// Schedule options
const scheduleTypeOptions = [
  { title: 'One Time', value: 'one-time' },
  { title: 'Recurring', value: 'recurring' }
]

// Cron presets
const cronPresets = [
  { name: 'Every Hour', expression: '0 * * * *', variant: 'outlined' as const },
  { name: 'Daily', expression: '0 0 * * *', variant: 'outlined' as const },
  { name: 'Weekly', expression: '0 0 * * 0', variant: 'outlined' as const },
  { name: 'Monthly', expression: '0 0 1 * *', variant: 'outlined' as const },
  { name: 'Every 15 Min', expression: '*/15 * * * *', variant: 'outlined' as const },
  { name: 'Every 30 Min', expression: '*/30 * * * *', variant: 'outlined' as const },
  { name: 'Every 2 Hours', expression: '0 */2 * * *', variant: 'outlined' as const },
  { name: 'Weekdays 9 AM', expression: '0 9 * * 1-5', variant: 'outlined' as const },
  { name: 'Weekends 10 AM', expression: '0 10 * * 0,6', variant: 'outlined' as const }
]

// Computed properties
const minDateTime = computed(() => {
  const now = new Date()
  now.setMinutes(now.getMinutes() + 1) // Minimum 1 minute from now
  return now.toISOString().slice(0, 16)
})

// Proxy configuration (replaced by ProxyTableselected selection)
// const proxyConfig = reactive({
//   host: '',
//   port: '',
//   username: '',
//   password: ''
// })

// Platform data
const platforms = ref<PlatformSummary[]>([])
const selectedPlatform = computed((): PlatformSummary | undefined => {
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

// Success notification state
const showSuccessNotification = ref(false)

// Options
const platformOptions = computed(() => {
  return platforms.value.map((p: PlatformSummary) => ({
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

const validateForm = async () => {
  if (!form.value) return { valid: false, errors: [$t('common.error')] }
  
  try {
    const { valid } = await form.value.validate()
    console.log("validateForm result:", { valid })
    
    if (!valid) {
      // Get detailed validation errors from form fields
      const fieldErrors: string[] = []
      
      // Check required fields manually for better error messages
      if (!taskForm.name || taskForm.name.trim() === '') {
        fieldErrors.push($t('home.task_name_required'))
      }
      
      if (!taskForm.platform) {
        fieldErrors.push($t('home.platform_required'))
      } else if (selectedPlatform.value && !selectedPlatform.value.is_active) {
        fieldErrors.push($t('home.platform_inactive_error', { platformName: selectedPlatform.value.display_name }))
      }
      
      if (!keywordsInput.value || keywordsInput.value.trim() === '') {
        fieldErrors.push($t('home.keywords_required'))
      } else {
        // Check if keywords are properly formatted (not just commas or spaces)
        const keywords = keywordsInput.value.split(',').map(k => k.trim()).filter(k => k.length > 0)
        if (keywords.length === 0) {
          fieldErrors.push($t('home.keywords_required'))
        }
      }
      

      
      // Check conditional validations
      if (useAccount.value && selectedAccounts.value.length === 0) {
        fieldErrors.push($t('home.account_required_when_enabled'))
      }
      
      // Check if platform requires cookies but no account is selected
      if (selectedPlatform.value?.authentication?.requiresCookies && selectedAccounts.value.length === 0) {
        fieldErrors.push(`Account required for platform: ${selectedPlatform.value.display_name}`)
      }
      
      if (useProxy.value && proxyValue.value.length === 0) {
        fieldErrors.push($t('home.proxy_required_when_enabled'))
      }
      
      // Check scheduling validations
      if (scheduleTask.value) {
        if (scheduleType.value === 'one-time' && !scheduledTime.value) {
          fieldErrors.push($t('home.scheduled_time_required'))
        }
        
        if (scheduleType.value === 'recurring' && (!cronExpression.value || cronValidationError.value)) {
          if (!cronExpression.value) {
            fieldErrors.push($t('home.cron_expression_required'))
          } else {
            fieldErrors.push($t('home.invalid_cron_expression'))
          }
        }
      }
      
      // Check numeric field validations
      if (taskForm.max_pages < 1 || taskForm.max_pages > 100) {
        fieldErrors.push($t('home.max_pages_range_error'))
      }
      
      if (taskForm.concurrency < 1 || taskForm.concurrency > 10) {
        fieldErrors.push($t('home.concurrency_range_error'))
      }
      
      if (taskForm.delay_between_requests < 0 || taskForm.delay_between_requests > 10000) {
        fieldErrors.push($t('home.delay_range_error'))
      }
      
      return { valid: false, errors: fieldErrors.length > 0 ? fieldErrors : [$t('common.fill_require_field')] }
    }
    
    return { valid: true, errors: [] }
  } catch (error) {
    console.error('Validation error:', error)
    return { valid: false, errors: [$t('common.error')] }
  }
}

const loadTaskDetails = async () => {
  if (!taskId.value) return
  
  try {
    loading.value = true // Set loading state
    const response = await getYellowPagesTaskDetail(taskId.value)
    
    if (response) {
      const data = response
      console.log("loadTaskDetails", data)
      // Populate form fields
      taskForm.name = data.task.name || ''
      taskForm.platform = data.task.platform || ''
      taskForm.location = data.task.location || ''
      taskForm.max_pages = data.task.max_pages || 10
      taskForm.concurrency = data.task.concurrency || 2
      taskForm.delay_between_requests = data.task.delay_between_requests || 2000
      taskForm.headless = data.task.headless !== undefined ? data.task.headless : true
      taskForm.account_id = data.task.account_id || undefined
      
      // Set keywords
      if (data.task.keywords && data.task.keywords.length > 0) {
        taskForm.keywords = data.task.keywords
        keywordsInput.value = data.task.keywords.join(', ')
      }
      
      // Set account selection
      if (data.task.account_id) {
        useAccount.value = true
        // Note: Account details will be loaded by AccountSelectedTable component
      }
      
      // Set proxy configuration
      if (data.proxy_config) {
        useProxy.value = true
        proxyValue.value = [{
          id: 0,
          host: data.proxy_config.host,
          port: data.proxy_config.port.toString(),
          user: data.proxy_config.username || '',
          pass: data.proxy_config.password || '',
          protocol: data.proxy_config.protocol || 'http'
        }]
      }
      
      // Set scheduling if exists
      if (data.scheduled_at) {
        scheduleTask.value = true
        scheduledTime.value = new Date(data.scheduled_at).toISOString().slice(0, 16)
        scheduleType.value = 'one-time'
      }
      
    } else {
      console.error('Failed to load task details:', response)
    }
  } catch (error) {
    console.error('Error loading task details:', error)
    errorDialog.message = error instanceof Error ? error.message : 'Failed to load task details'
    errorDialog.show = true
  } finally {
    loading.value = false
  }
}

const createTask = async () => {
  const validationResult = await validateForm()
  if (!validationResult.valid) {
    errorDialog.message = validationResult.errors.join('\n')
    errorDialog.show = true
    console.log("validateForm")
    return
  }
  
  creating.value = true
  
  try {
    // Prepare task data
    const taskData = {
      ...taskForm,
      keywords: keywordsInput.value
        .split(',')
        .map(k => k.trim())
        .filter(k => k.length > 0)
        .filter((k, index, arr) => arr.indexOf(k) === index), // Remove duplicates
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

    if ((isEditMode.value || isDetailMode.value) && taskId.value) {
      // Update existing task
      try {
        await updateYellowPagesTask(taskId.value, taskData)
        successDialog.taskId = taskId.value
        successDialog.taskName = taskData.name
        successDialog.status = 'updated'
        successDialog.show = true
        
        // Show success notification
        showSuccessNotification.value = true
      } catch (error) {
        throw new Error('Failed to update task')
      }
    } else {
      // Create new task
      const response = await createYellowPagesTask(taskData).catch((error) => {
        console.error('Failed to create task:', error)
        errorDialog.message = error instanceof Error ? error.message : 'An unexpected error occurred'
        errorDialog.show = true
        return null
      })
      
      if (response) {
        // Create schedule if scheduling is enabled
        if (scheduleTask.value) {
          try {
            await createScheduleForTask(response, taskData)
          } catch (scheduleError) {
            console.warn('Failed to create schedule, but task was created:', scheduleError)
            // Task was created successfully, so we'll show success but warn about schedule
            errorDialog.message = `Task created successfully, but failed to create schedule: ${scheduleError instanceof Error ? scheduleError.message : 'Unknown error'}`
            errorDialog.show = true
            return
          }
        }

        successDialog.taskId = response
        successDialog.taskName = taskData.name
        successDialog.status = 'pending'
        successDialog.show = true
        
        // Show success notification
        showSuccessNotification.value = true
        
        // Start the task immediately
        await startYellowPagesTask(response)
        successDialog.status = 'running'
      } else {
        throw new Error('Failed to create task')
      }
    }
    
  } catch (error) {
    console.error('Failed to create/update task:', error)
    errorDialog.message = error instanceof Error ? error.message : 'An unexpected error occurred'
    errorDialog.show = true
  } finally {
    creating.value = false
  }
}

const createTaskOnly = async () => {
  const validationResult = await validateForm()
  if (!validationResult.valid) {
    errorDialog.message = validationResult.errors.join('\n')
    errorDialog.show = true
    return
  }
  
  creating.value = true
  
  try {
    // Prepare task data (same as createTask but without starting)
    const taskData = {
      ...taskForm,
      keywords: keywordsInput.value
        .split(',')
        .map(k => k.trim())
        .filter(k => k.length > 0)
        .filter((k, index, arr) => arr.indexOf(k) === index), // Remove duplicates
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

    if ((isEditMode.value || isDetailMode.value) && taskId.value) {
      // Update existing task
      try {
        await updateYellowPagesTask(taskId.value, taskData)
        successDialog.taskId = taskId.value
        successDialog.taskName = taskData.name
        successDialog.status = 'updated'
        successDialog.show = true
        
        // Show success notification
        showSuccessNotification.value = true
      } catch (error) {
        throw new Error('Failed to update task')
      }
    } else {
      // Create task using API
      const response = await createYellowPagesTask(taskData).catch((error) => {
        console.error('Failed to create task:', error)
        errorDialog.message = error instanceof Error ? error.message : 'An unexpected error occurred'
        errorDialog.show = true
        return null
      })
      
      if (response) {
        // Create schedule if scheduling is enabled
        if (scheduleTask.value) {
          try {
            await createScheduleForTask(response, taskData)
          } catch (scheduleError) {
            console.warn('Failed to create schedule, but task was created:', scheduleError)
            // Task was created successfully, so we'll show success but warn about schedule
            errorDialog.message = `Task created successfully, but failed to create schedule: ${scheduleError instanceof Error ? scheduleError.message : 'Unknown error'}`
            errorDialog.show = true
            return
          }
        }

        successDialog.taskId = response
        successDialog.taskName = taskData.name
        successDialog.status = 'pending'
        successDialog.show = true
        
        // Show success notification
        showSuccessNotification.value = true
      } else {
        throw new Error( 'Failed to create task')
      }
    }
    
  } catch (error) {
    console.error('Failed to create/update task:', error)
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

// Scheduling methods
const handleScheduleTypeChange = () => {
  // Reset schedule-specific fields when type changes
  if (scheduleType.value === 'one-time') {
    cronExpression.value = ''
    cronValidationError.value = ''
    nextRunTime.value = ''
  } else {
    scheduledTime.value = ''
  }
}

const handleCronExpressionChange = (expression: string) => {
  cronExpression.value = expression
  validateCronExpression()
}

const validateCronExpression = async () => {
  if (!cronExpression.value) {
    cronValidationError.value = ''
    return
  }

  try {
    // Basic cron validation regex
    const cronRegex = /^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|\*\/([1-9]|1[0-9]|2[0-9]|3[0-1])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6]))$/
    
    if (cronRegex.test(cronExpression.value)) {
      cronValidationError.value = ''
      calculateNextRunTime()
    } else {
      cronValidationError.value = 'Invalid cron expression format'
    }
  } catch (error) {
    cronValidationError.value = 'Failed to validate cron expression'
  }
}

const applyCronPreset = (expression: string) => {
  cronExpression.value = expression
  validateCronExpression()
}

const calculateNextRunTime = async () => {
  if (!cronExpression.value || cronValidationError.value) {
    nextRunTime.value = ''
    return
  }

  try {
    // Simple next run time calculation for common patterns
    const now = new Date()
    let nextRun = new Date(now)
    
    const parts = cronExpression.value.split(' ')
    const [minute, hour, day, month, weekday] = parts
    
    // Basic calculation - this is a simplified version
    // In production, you'd want to use a proper cron library
    if (minute !== '*' && hour !== '*') {
      nextRun.setMinutes(parseInt(minute), 0, 0)
      nextRun.setHours(parseInt(hour))
      
      if (nextRun <= now) {
        nextRun.setDate(nextRun.getDate() + 1)
      }
    } else if (hour !== '*') {
      nextRun.setMinutes(0, 0, 0)
      nextRun.setHours(parseInt(hour))
      
      if (nextRun <= now) {
        nextRun.setDate(nextRun.getDate() + 1)
      }
    } else if (minute !== '*') {
      nextRun.setMinutes(parseInt(minute), 0, 0)
      
      if (nextRun <= now) {
        nextRun.setHours(nextRun.getHours() + 1)
      }
    } else {
      nextRun.setMinutes(now.getMinutes() + 1, 0, 0)
    }
    
    nextRunTime.value = nextRun.toLocaleString()
  } catch (error) {
    nextRunTime.value = 'Unable to calculate'
  }
}

// Create schedule for the yellow pages task
const createScheduleForTask = async (taskId: number, taskData: any) => {
  try {
    if (scheduleType.value === 'one-time' && scheduledTime.value) {
      // For one-time scheduling, we don't create a separate schedule
      // The task already has scheduled_at set
      console.log('One-time scheduled task created with ID:', taskId)
      return
    } else if (scheduleType.value === 'recurring' && cronExpression.value) {
      // Create a recurring schedule using the schedule module
      const scheduleData = {
        name: scheduleName.value || `Schedule for ${taskData.name}`,
        description: scheduleDescription.value || `Recurring schedule for yellow pages task: ${taskData.name}`,
        task_type: TaskType.YELLOW_PAGES,
        task_id: taskId,
        cron_expression: cronExpression.value,
        is_active: scheduleActive.value,
        trigger_type: TriggerType.CRON
      }
      
      const scheduleId = await createSchedule(scheduleData)
      console.log('Recurring schedule created with ID:', scheduleId)
      return scheduleId
    }
  } catch (error) {
    console.error('Failed to create schedule:', error)
    throw error
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

const editTask = () => {
  router.push(`/yellowpages/edit/${taskId.value}`)
}

// Watch for platform changes to update form validation and account requirements
watch(() => taskForm.platform, (newPlatform) => {
  if (newPlatform && selectedPlatform.value) {
    if (!selectedPlatform.value.is_active) {
      errorDialog.message = `Platform "${selectedPlatform.value.display_name}" is currently inactive`
      errorDialog.show = true
    }
    
    // Automatically require account if platform needs cookies
    if (selectedPlatform.value.authentication?.requiresCookies) {
      useAccount.value = true
    }
  }
})

// Lifecycle
onMounted(() => {
  loadPlatforms()
  
  // If in edit mode or detail mode, load task details
  if ((isEditMode.value || isDetailMode.value) && taskId.value) {
    loadTaskDetails()
  }
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

.font-family-mono {
  font-family: 'Courier New', monospace;
  font-size: 0.875rem;
}

/* Error dialog styling */
.error-list {
  max-height: 300px;
  overflow-y: auto;
}

.error-list li {
  padding: 4px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.error-list li:last-child {
  border-bottom: none;
}

.error-dialog-title {
  color: #f44336;
}

.border-top {
  border-top: 1px solid rgba(255, 255, 255, 0.12);
}
</style>
