<template>
  <v-form ref="form" @submit.prevent="handleSubmit">
    <v-container fluid>
      <!-- Basic Information -->
      <v-row>
        <v-col cols="12">
          <h3 class="text-h6 mb-4">
            <v-icon class="mr-2">mdi-information</v-icon>
            {{ t('schedule.basic_information') }}
          </h3>
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12" md="6">
          <v-text-field
            v-model="formData.name"
            :label="t('schedule.schedule_name')"
            required
            :rules="[rules.required]"
            :placeholder="t('schedule.schedule_name_placeholder')"
          />
        </v-col>
        <v-col cols="12" md="6">
          <v-select
            v-model="formData.task_type"
            :items="taskTypeOptions"
            :label="t('schedule.task_type')"
            required
            :rules="[rules.required]"
            @update:model-value="handleTaskTypeChange"
          />
        </v-col>
      </v-row>

      <v-row v-if="formData.task_type==TaskType.SEARCH" >
        <!-- show search result table -->
        <SearchResultSelectTable @change="handleSearchtaskChanged" />
      </v-row>
      <v-row v-if="formData.task_type==TaskType.EMAIL_EXTRACT">
        <!-- <EmailExtractSelectTable @change="handleEmailExtractChanged" /> -->
       
      <EmailresultTable :isSelectedtable="true" @change="handleEmailsourceChanged" />
          
      </v-row>
      <v-row v-if="formData.task_type==TaskType.BUCK_EMAIL">
<EmailSendtaskTable :isSelectedtable="true" @change="handleEmailsendtaskChanged" />
      </v-row>

      <v-row>
        <v-col cols="12" md="6">
          <v-text-field
            v-model="formData.task_id"
            :label="t('schedule.task_id')"
            type="number"
            :readonly="true"
            required
            :rules="[rules.required, rules.positive]"
            :placeholder="t('schedule.task_id_placeholder')"
          />
        </v-col>
        <v-col cols="12" md="6">
          <v-textarea
            v-model="formData.description"
            :label="t('schedule.description')"
            rows="2"
            :placeholder="t('schedule.description_placeholder')"
          />
        </v-col>
      </v-row>

      <!-- Trigger Configuration -->
      <v-row>
        <v-col cols="12">
          <h3 class="text-h6 mb-4">
            <v-icon class="mr-2">mdi-trigger</v-icon>
            {{ t('schedule.trigger_configuration') }}
          </h3>
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12" md="6">
          <v-select
            v-model="formData.trigger_type"
            :items="triggerTypeOptions"
            :label="t('schedule.trigger_type')"
            required
            :rules="[rules.required]"
            @update:model-value="handleTriggerTypeChange"
          />
        </v-col>
        <v-col cols="12" md="6">
          <v-switch
            v-model="formData.is_active"
            :label="t('schedule.active')"
            color="success"
            hide-details
          />
        </v-col>
      </v-row>

      <!-- Cron Expression (for CRON trigger type) -->
      <v-row v-if="formData.trigger_type === 'cron'">
        <v-col cols="12" md="8">
          <v-text-field
            v-model="formData.cron_expression"
            :label="t('schedule.cron_expression')"
            required
            :rules="[rules.required, rules.cron]"
            :placeholder="t('schedule.cron_expression_placeholder')"
            :error-messages="cronValidationError"
            @update:model-value="validateCronExpression"
          />
        </v-col>
        <v-col cols="12" md="4" class="d-flex align-center">
          <CronExpressionBuilder @expression-change="handleCronExpressionChange" />
        </v-col>
      </v-row>

      <!-- Dependency Configuration (for DEPENDENCY trigger type) -->
      <v-row v-if="formData.trigger_type === 'dependency'">
        <v-col cols="12" md="6">
          <v-select
            v-model="formData.parent_schedule_id"
            :items="availableParentSchedules"
            :label="t('schedule.parent_schedule')"
            required
            :rules="[rules.required]"
            item-title="name"
            item-value="id"
            :placeholder="t('schedule.parent_schedule_placeholder')"
          />
        </v-col>
        <v-col cols="12" md="6">
          <v-select
            v-model="formData.dependency_condition"
            :items="dependencyConditionOptions"
            :label="t('schedule.dependency_condition')"
            required
            :rules="[rules.required]"
          />
        </v-col>
      </v-row>

      <v-row v-if="formData.trigger_type === 'dependency'">
        <v-col cols="12" md="6">
          <v-text-field
            v-model="formData.delay_minutes"
            :label="t('schedule.delay_minutes')"
            type="number"
            min="0"
            :rules="[rules.nonNegative]"
            :placeholder="t('schedule.delay_placeholder')"
          />
        </v-col>
      </v-row>

      <!-- Next Run Preview -->
      <v-row v-if="formData.trigger_type === 'cron' && formData.cron_expression">
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
              <span>{{ t('schedule.next_run_time', { time: nextRunTime }) }}</span>
              <v-btn
                size="small"
                variant="outlined"
                @click="calculateNextRunTime"
              >
                {{ t('schedule.refresh') }}
              </v-btn>
            </div>
          </v-alert>
        </v-col>
      </v-row>

      <!-- Form Actions -->
      <v-row>
        <v-col cols="12" class="d-flex justify-end">
          <v-btn
            color="secondary"
            variant="outlined"
            @click="$emit('cancel')"
            class="mr-2"
          >
            {{ t('schedule.cancel') }}
          </v-btn>
          <v-btn
            color="primary"
            type="submit"
            :loading="loading"
            :disabled="!isFormValid"
          >
            {{ isEdit ? t('schedule.update_schedule') : t('schedule.create_schedule') }}
          </v-btn>
        </v-col>
      </v-row>
    </v-container>
  </v-form>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import CronExpressionBuilder from './CronExpressionBuilder.vue'
import { validateCronExpression as validateCron, calculateNextRunTime as calculateNextRunTimeAPI } from '@/views/api/schedule'
import { ScheduleCreateRequest, ScheduleUpdateRequest } from '@/entityTypes/schedule-type'
import { TaskType, ScheduleStatus, TriggerType, DependencyCondition } from '@/entity/ScheduleTask.entity'
import {SearchtaskItem } from "@/entityTypes/searchControlType"
import EmailresultTable from '@/views/pages/emailextraction/widgets/EmailResultTable.vue'
import SearchResultSelectTable from "@/views/pages/search/widgets/SearchResultSelectTable.vue";
import { EmailsearchTaskEntityDisplay } from '@/entityTypes/emailextraction-type'
import EmailSendtaskTable from '@/views/pages/emailsendtask/widgets/EmailSendtaskTable.vue'
import {BuckEmailListType} from "@/entityTypes/buckemailType"
const { t } = useI18n()

// Props
interface Props {
  schedule?: any
  isEdit?: boolean
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isEdit: false,
  loading: false
})

// Emits
const emit = defineEmits<{
  submit: [data: ScheduleCreateRequest | ScheduleUpdateRequest]
  cancel: []
}>()

// Form ref
const form = ref<HTMLFormElement>()

// Form data
const formData = ref<ScheduleCreateRequest>({
  name: '',
  description: '',
  task_type: TaskType.SEARCH,
  task_id: 0,
  cron_expression: '',
  is_active: true,
  trigger_type: TriggerType.CRON,
  parent_schedule_id: 0,
  dependency_condition: undefined,
  delay_minutes: 0
})

// Validation
const cronValidationError = ref('')
const nextRunTime = ref('')

// Available parent schedules for dependency
const availableParentSchedules = ref<any[]>([])

// Validation rules
const rules = {
  required: (value: any) => !!value || t('schedule.this_field_required'),
  positive: (value: number) => value > 0 || t('schedule.must_be_positive'),
  nonNegative: (value: number) => value >= 0 || t('schedule.must_be_non_negative'),
  cron: (value: string) => {
    if (!value) return true
    return /^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|\*\/([1-9]|1[0-9]|2[0-9]|3[0-1])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6]))$/.test(value) || t('schedule.invalid_cron_expression')
  }
}

// Options for selects
const taskTypeOptions = [
  { title: t('schedule.search_task'), value: TaskType.SEARCH },
  { title: t('schedule.email_extract'), value: TaskType.EMAIL_EXTRACT },
  { title: t('schedule.bulk_email'), value: TaskType.BUCK_EMAIL },
  { title: t('schedule.video_download'), value: TaskType.VIDEO_DOWNLOAD },
 
]

const triggerTypeOptions = [
  { title: t('schedule.cron_schedule'), value: TriggerType.CRON },
  { title: t('schedule.dependency'), value: TriggerType.DEPENDENCY },
  { title: t('schedule.manual_only'), value: TriggerType.MANUAL }
]

const dependencyConditionOptions = [
  { title: t('schedule.on_success'), value: DependencyCondition.ON_SUCCESS },
  { title: t('schedule.on_completion'), value: DependencyCondition.ON_COMPLETION },
  { title: t('schedule.on_failure'), value: DependencyCondition.ON_FAILURE }
]

// Computed properties
const isFormValid = computed(() => {
  if (!form.value) return false
  
  const isValid = form.value.validate()
  
  // Additional validation for trigger types
  if (formData.value.trigger_type === TriggerType.CRON) {
    return isValid && !!formData.value.cron_expression && !cronValidationError.value
  }
  
  if (formData.value.trigger_type === TriggerType.DEPENDENCY) {
    return isValid && !!formData.value.parent_schedule_id && !!formData.value.dependency_condition
  }
  
  return isValid
})
const handleSearchtaskChanged = (newValue: SearchtaskItem[]|undefined) => {
  // console.log(`selectedProxy changed to ${newValue}`);
  // proxyValue.value=[];
  console.log("search change")
  console.log(newValue)
  if(newValue&& newValue.length > 0){
    if (newValue[0] && newValue[0].id) {
      formData.value.task_id=newValue[0].id;
    console.log("search task id is"+formData.value.task_id)
    }
  }else{
    formData.value.task_id=0;
  }
};
const handleEmailsourceChanged = (newValue: Array<EmailsearchTaskEntityDisplay>|undefined) => {
  //console.warn(newValue)
  //email task selected change
  if(newValue){
    formData.value.task_id = newValue[0].id
  }
  //console.log(emailsourcesdata.value)
}

const handleEmailsendtaskChanged = (newValue: Array<BuckEmailListType>|undefined) => {
  //console.warn(newValue)
  //email task selected change
  if(newValue){
    formData.value.task_id = newValue[0].TaskId
  }
  //console.log(emailsourcesdata.value)
}

// Methods
const handleTaskTypeChange = () => {
  // Reset task_id when task type changes
  formData.value.task_id = 0
}

const handleTriggerTypeChange = () => {
  // Reset trigger-specific fields when trigger type changes
  if (formData.value.trigger_type === TriggerType.CRON) {
    formData.value.cron_expression = ''
    formData.value.parent_schedule_id = 0
    formData.value.dependency_condition = undefined
    formData.value.delay_minutes = 0
  } else if (formData.value.trigger_type === TriggerType.DEPENDENCY) {
    formData.value.cron_expression = ''
  } else {
    formData.value.cron_expression = ''
    formData.value.parent_schedule_id = 0
    formData.value.dependency_condition = undefined
    formData.value.delay_minutes = 0
  }
}

const handleCronExpressionChange = (expression: string) => {
  formData.value.cron_expression = expression
  validateCronExpression()
}

const validateCronExpression = async () => {
  if (!formData.value.cron_expression) {
    cronValidationError.value = ''
    return
  }

  try {
    const result = await validateCron(formData.value.cron_expression)
    if (result.isValid) {
      cronValidationError.value = ''
      calculateNextRunTime()
    } else {
      cronValidationError.value = result.errors.join(',')  || t('schedule.invalid_cron_expression')
    }
  } catch (error) {
    cronValidationError.value = t('schedule.failed_validate_cron')
  }
}

const calculateNextRunTime = async () => {
  if (formData.value.trigger_type === TriggerType.CRON && formData.value.cron_expression) {
    try {
      nextRunTime.value = t('schedule.calculating')
      const nextRun = await calculateNextRunTimeAPI(formData.value.cron_expression)
      nextRunTime.value = nextRun.toLocaleString()
    } catch (error) {
      console.error('Failed to calculate next run time:', error)
      nextRunTime.value = t('schedule.calculation_failed')
    }
  }
}

const loadParentSchedules = async () => {
  try {
    // This would load available parent schedules from the API
    // For now, we'll use placeholder data
    availableParentSchedules.value = [
      { id: 1, name: 'Daily Search Task' },
      { id: 2, name: 'Weekly Email Campaign' },
      { id: 3, name: 'Monthly Video Download' }
    ]
  } catch (error) {
    console.error('Failed to load parent schedules:', error)
  }
}

const handleSubmit = () => {
  if (!isFormValid.value) return

  const submitData = { ...formData.value }
  
  // Convert numeric fields
  submitData.task_id = Number(submitData.task_id)
  submitData.delay_minutes = Number(submitData.delay_minutes)
  
  // Convert nullable fields
  if (submitData.parent_schedule_id === 0) {
    submitData.parent_schedule_id = undefined
  }
  if (submitData.dependency_condition === undefined) {
    submitData.dependency_condition = undefined
  }

  emit('submit', submitData)
}

const initializeForm = () => {
  if (props.schedule && props.isEdit) {
    formData.value = {
      name: props.schedule.name || '',
      description: props.schedule.description || '',
      task_type: props.schedule.task_type || TaskType.SEARCH,
      task_id: props.schedule.task_id || 0,
      cron_expression: props.schedule.cron_expression || '',
      is_active: props.schedule.is_active !== undefined ? props.schedule.is_active : true,
      trigger_type: props.schedule.trigger_type || TriggerType.CRON,
      parent_schedule_id: props.schedule.parent_schedule_id || null,
      dependency_condition: props.schedule.dependency_condition || null,
      delay_minutes: props.schedule.delay_minutes || 0
    }
  }
}

// Watchers
watch(() => formData.value.cron_expression, () => {
  if (formData.value.trigger_type === TriggerType.CRON) {
    validateCronExpression()
  }
})

// Lifecycle
onMounted(() => {
  initializeForm()
  loadParentSchedules()
})
</script>

<style scoped>
.v-form {
  max-width: 800px;
  margin: 0 auto;
}

.v-text-field,
.v-select,
.v-textarea {
  margin-bottom: 16px;
}
</style> 