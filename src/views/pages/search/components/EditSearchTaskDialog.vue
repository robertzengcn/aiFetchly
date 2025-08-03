<template>
  <v-dialog v-model="dialog" max-width="800px" persistent>
    <v-card>
      <v-card-title class="text-h5">
        {{ $t('search.edit_task') }}
      </v-card-title>
      
      <v-card-text>
        <v-form ref="form" v-model="valid">
          <v-row>
            <!-- Search Engine Selection -->
            <v-col cols="12" md="6">
              <v-select
                v-model="formData.engine"
                :items="searchEngines"
                :label="$t('search.search_enginer_name')"
                :rules="[v => !!v || $t('validation.required')]"
                required
              />
            </v-col>
            
            <!-- Number of Pages -->
            <v-col cols="12" md="6">
              <v-text-field
                v-model.number="formData.num_pages"
                :label="$t('search.num_pages')"
                type="number"
                min="1"
                max="100"
                :rules="[v => v >= 1 && v <= 100 || $t('validation.pages_range')]"
                required
              />
            </v-col>
            
            <!-- Concurrency -->
            <v-col cols="12" md="6">
              <v-text-field
                v-model.number="formData.concurrency"
                :label="$t('search.concurrency')"
                type="number"
                min="1"
                max="10"
                :rules="[v => v >= 1 && v <= 10 || $t('validation.concurrency_range')]"
                required
              />
            </v-col>
            
            <!-- Browser Visibility -->
            <v-col cols="12" md="6">
              <v-switch
                v-model="formData.notShowBrowser"
                :label="$t('search.not_show_browser')"
                color="primary"
              />
            </v-col>
            
            <!-- Local Browser -->
            <v-col cols="12" md="6">
              <v-select
                v-model="formData.localBrowser"
                :items="browserOptions"
                :label="$t('search.local_browser')"
                clearable
              />
            </v-col>
            
            <!-- Keywords -->
            <v-col cols="12">
              <v-textarea
                v-model="keywordsText"
                :label="$t('search.keyword')"
                :placeholder="$t('search.keywords_placeholder')"
                :rules="[v => !!v || $t('validation.required')]"
                rows="3"
                required
                @input="updateKeywords"
              />
              <v-chip-group>
                <v-chip
                  v-for="(keyword, index) in formData.keywords"
                  :key="index"
                  closable
                  @click:close="removeKeyword(index)"
                >
                  {{ keyword }}
                </v-chip>
              </v-chip-group>
            </v-col>
            
            <!-- Proxies -->
            <v-col cols="12">
              <v-expansion-panels>
                <v-expansion-panel>
                  <v-expansion-panel-title>
                    {{ $t('search.proxies') }}
                  </v-expansion-panel-title>
                  <v-expansion-panel-text>
                    <div v-for="(proxy, index) in formData.proxys" :key="index" class="mb-4">
                      <v-row>
                        <v-col cols="12" md="3">
                          <v-text-field
                            v-model="proxy.host"
                            :label="$t('search.proxy_host')"
                            dense
                          />
                        </v-col>
                        <v-col cols="12" md="2">
                          <v-text-field
                            v-model.number="proxy.port"
                            :label="$t('search.proxy_port')"
                            type="number"
                            dense
                          />
                        </v-col>
                        <v-col cols="12" md="3">
                          <v-text-field
                            v-model="proxy.user"
                            :label="$t('search.proxy_user')"
                            dense
                          />
                        </v-col>
                        <v-col cols="12" md="3">
                          <v-text-field
                            v-model="proxy.pass"
                            :label="$t('search.proxy_pass')"
                            type="password"
                            dense
                          />
                        </v-col>
                        <v-col cols="12" md="1">
                          <v-btn
                            icon="mdi-delete"
                            color="error"
                            variant="text"
                            @click="removeProxy(index)"
                          />
                        </v-col>
                      </v-row>
                    </div>
                    <v-btn
                      prepend-icon="mdi-plus"
                      @click="addProxy"
                      variant="outlined"
                    >
                      {{ $t('search.add_proxy') }}
                    </v-btn>
                  </v-expansion-panel-text>
                </v-expansion-panel>
              </v-expansion-panels>
            </v-col>
            
            <!-- Accounts -->
            <v-col cols="12">
              <v-expansion-panels>
                <v-expansion-panel>
                  <v-expansion-panel-title>
                    {{ $t('search.accounts') }}
                  </v-expansion-panel-title>
                  <v-expansion-panel-text>
                    <v-select
                      v-model="formData.accounts"
                      :items="availableAccounts"
                      :label="$t('search.select_accounts')"
                      multiple
                      chips
                      closable-chips
                    />
                  </v-expansion-panel-text>
                </v-expansion-panel>
              </v-expansion-panels>
            </v-col>
          </v-row>
        </v-form>
      </v-card-text>
      
      <v-card-actions>
        <v-spacer />
        <v-btn
          color="grey"
          variant="text"
          @click="closeDialog"
          :disabled="loading"
        >
          {{ $t('common.cancel') }}
        </v-btn>
        <v-btn
          color="primary"
          @click="saveTask"
          :loading="loading"
          :disabled="!valid"
        >
          {{ $t('common.save') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getSearchTaskDetails, updateSearchTask, receiveSearchTaskUpdateEvent } from '@/views/api/search'
import { SearchTaskDetails, UpdateSearchTaskData } from '@/views/api/types'

const { t } = useI18n()

// Props
interface Props {
  modelValue: boolean
  taskId?: number
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  taskId: undefined
})

// Emits
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'saved': [taskId: number]
  'error': [message: string]
}>()

// Reactive data
const dialog = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const valid = ref(false)
const loading = ref(false)
const form = ref()

const formData = reactive<UpdateSearchTaskData>({
  engine: '',
  keywords: [],
  num_pages: 1,
  concurrency: 1,
  notShowBrowser: false,
  localBrowser: '',
  proxys: [],
  accounts: []
})

const keywordsText = ref('')

// Options
const searchEngines = [
  { title: 'Google', value: 'google' },
  { title: 'Bing', value: 'bing' },
  { title: 'Yahoo', value: 'yahoo' }
]

const browserOptions = [
  { title: 'Chrome', value: 'chrome' },
  { title: 'Firefox', value: 'firefox' }
]

const availableAccounts = ref<Array<{ title: string, value: number }>>([])

// Methods
const updateKeywords = () => {
  const keywords = keywordsText.value
    .split('\n')
    .map(k => k.trim())
    .filter(k => k.length > 0)
  formData.keywords = keywords
}

const removeKeyword = (index: number) => {
  formData.keywords.splice(index, 1)
  keywordsText.value = formData.keywords.join('\n')
}

const addProxy = () => {
  formData.proxys.push({
    host: '',
    port: 8080,
    user: '',
    pass: ''
  })
}

const removeProxy = (index: number) => {
  formData.proxys.splice(index, 1)
}

const loadTaskDetails = async () => {
  if (!props.taskId) return
  
  try {
    loading.value = true
    const response = await getSearchTaskDetails(props.taskId)
    
    if (response.status && response.data) {
      const taskDetails: SearchTaskDetails = response.data
      
      // Populate form data
      formData.engine = taskDetails.engine
      formData.keywords = taskDetails.keywords
      formData.num_pages = taskDetails.num_pages
      formData.concurrency = taskDetails.concurrency
      formData.notShowBrowser = taskDetails.notShowBrowser
      formData.localBrowser = taskDetails.localBrowser
      formData.proxys = taskDetails.proxys
      formData.accounts = taskDetails.accounts
      
      // Update keywords text
      keywordsText.value = taskDetails.keywords.join('\n')
    }
  } catch (error) {
    console.error('Error loading task details:', error)
    emit('error', error instanceof Error ? error.message : 'Unknown error')
  } finally {
    loading.value = false
  }
}

const saveTask = async () => {
  if (!props.taskId) return
  
  try {
    loading.value = true
    
    // Update keywords from text
    updateKeywords()
    
    const response = await updateSearchTask(props.taskId, formData)
    
    if (response.status) {
      emit('saved', props.taskId)
      closeDialog()
    } else {
      emit('error', response.msg || 'Failed to update task')
    }
  } catch (error) {
    console.error('Error saving task:', error)
    emit('error', error instanceof Error ? error.message : 'Unknown error')
  } finally {
    loading.value = false
  }
}

const closeDialog = () => {
  dialog.value = false
}

// Watch for dialog open to load data
watch(dialog, (newValue) => {
  if (newValue && props.taskId) {
    loadTaskDetails()
  }
})

// Listen for update events
receiveSearchTaskUpdateEvent((data) => {
  if (data.taskId === props.taskId) {
    if (data.status) {
      emit('saved', props.taskId!)
    } else {
      emit('error', data.msg)
    }
  }
})
</script>

<style scoped>
.v-expansion-panels {
  margin-top: 16px;
}
</style> 