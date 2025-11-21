<template>
  <div>
    <v-btn
      color="primary"
      variant="outlined"
      size="small"
      @click="showBuilder = true"
    >
      <v-icon class="mr-1">mdi-tools</v-icon>
      {{ t('schedule.cron_builder_button') }}
    </v-btn>

    <v-dialog v-model="showBuilder" max-width="600">
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon class="mr-2">mdi-clock-outline</v-icon>
          {{ t('schedule.cron_builder_title') }}
        </v-card-title>

        <v-card-text>
          <v-container>
            <!-- Preset Options -->
            <v-row>
              <v-col cols="12">
                <h4 class="text-subtitle-1 mb-2">{{ t('schedule.cron_builder_quick_presets') }}</h4>
                <v-chip-group>
                  <v-chip
                    v-for="preset in presets"
                    :key="preset.name"
                    variant="outlined"
                    @click="applyPreset(preset.expression)"
                    class="ma-1"
                  >
                    {{ preset.name }}
                  </v-chip>
                </v-chip-group>
              </v-col>
            </v-row>

            <v-divider class="my-4"></v-divider>

            <!-- Custom Builder -->
            <v-row>
              <v-col cols="12">
                <v-btn
                  color="primary"
                  variant="outlined"
                  class="text-subtitle-1 font-weight-medium"
                  @click="showCustomSchedule = !showCustomSchedule"
                  block
                >
                  <v-icon class="mr-2" :class="{ 'rotate-180': showCustomSchedule }">
                    mdi-chevron-down
                  </v-icon>
                  {{ t('schedule.cron_builder_custom_schedule') }}
                </v-btn>
              </v-col>
            </v-row>

            <v-expand-transition>
              <div v-show="showCustomSchedule">
                <!-- Minutes -->
            <v-row>
              <v-col cols="12" md="6">
                <v-select
                  v-model="customSchedule.minutes"
                  :items="minuteOptions"
                  :label="t('schedule.cron_builder_minutes')"
                  @update:model-value="updateExpression"
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field
                  v-if="customSchedule.minutes === 'custom'"
                  v-model="customSchedule.minutesValue"
                  :label="t('schedule.cron_builder_custom_minutes')"
                  placeholder="0,15,30,45"
                  @update:model-value="updateExpression"
                />
              </v-col>
            </v-row>

            <!-- Hours -->
            <v-row>
              <v-col cols="12" md="6">
                <v-select
                  v-model="customSchedule.hours"
                  :items="hourOptions"
                  :label="t('schedule.cron_builder_hours')"
                  @update:model-value="updateExpression"
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field
                  v-if="customSchedule.hours === 'custom'"
                  v-model="customSchedule.hoursValue"
                  :label="t('schedule.cron_builder_custom_hours')"
                  placeholder="0,6,12,18"
                  @update:model-value="updateExpression"
                />
              </v-col>
            </v-row>

            <!-- Days -->
            <v-row>
              <v-col cols="12" md="6">
                <v-select
                  v-model="customSchedule.days"
                  :items="dayOptions"
                  :label="t('schedule.cron_builder_days')"
                  @update:model-value="updateExpression"
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field
                  v-if="customSchedule.days === 'custom'"
                  v-model="customSchedule.daysValue"
                  :label="t('schedule.cron_builder_custom_days')"
                  placeholder="1,15"
                  @update:model-value="updateExpression"
                />
              </v-col>
            </v-row>

            <!-- Months -->
            <v-row>
              <v-col cols="12" md="6">
                <v-select
                  v-model="customSchedule.months"
                  :items="monthOptions"
                  :label="t('schedule.cron_builder_months')"
                  @update:model-value="updateExpression"
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field
                  v-if="customSchedule.months === 'custom'"
                  v-model="customSchedule.monthsValue"
                  :label="t('schedule.cron_builder_custom_months')"
                  placeholder="1,6,12"
                  @update:model-value="updateExpression"
                />
              </v-col>
            </v-row>

            <!-- Weekdays -->
            <v-row>
              <v-col cols="12" md="6">
                <v-select
                  v-model="customSchedule.weekdays"
                  :items="weekdayOptions"
                  :label="t('schedule.cron_builder_weekdays')"
                  @update:model-value="updateExpression"
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field
                  v-if="customSchedule.weekdays === 'custom'"
                  v-model="customSchedule.weekdaysValue"
                  :label="t('schedule.cron_builder_custom_weekdays')"
                  placeholder="1,3,5"
                  @update:model-value="updateExpression"
                />
              </v-col>
            </v-row>
              </div>
            </v-expand-transition>

            <!-- Generated Expression -->
            <v-row>
              <v-col cols="12">
                <v-alert
                  type="info"
                  variant="tonal"
                  class="mt-4"
                >
                  <template v-slot:prepend>
                    <v-icon>mdi-code-braces</v-icon>
                  </template>
                  <div class="d-flex justify-space-between align-center">
                    <span class="font-family-mono">{{ generatedExpression }}</span>
                    <v-btn
                      size="small"
                      variant="outlined"
                      @click="copyExpression"
                    >
                      {{ t('schedule.cron_builder_copy') }}
                    </v-btn>
                  </div>
                </v-alert>
              </v-col>
            </v-row>

            <!-- Expression Description -->
            <v-row>
              <v-col cols="12">
                <v-alert
                  type="success"
                  variant="tonal"
                  class="mt-2"
                >
                  <template v-slot:prepend>
                    <v-icon>mdi-information</v-icon>
                  </template>
                  {{ expressionDescription }}
                </v-alert>
              </v-col>
            </v-row>
          </v-container>
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn
            color="secondary"
            variant="outlined"
            @click="showBuilder = false"
          >
            {{ t('common.cancel') }}
          </v-btn>
          <v-btn
            color="primary"
            @click="applyExpression"
          >
            {{ t('schedule.cron_builder_apply_expression') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

// Emits
const emit = defineEmits<{
  'expression-change': [expression: string]
}>()

// Reactive data
const showBuilder = ref(false)
const showCustomSchedule = ref(false)
const generatedExpression = ref('* * * * *')

// Custom schedule configuration
const customSchedule = ref({
  minutes: 'every',
  minutesValue: '',
  hours: 'every',
  hoursValue: '',
  days: 'every',
  daysValue: '',
  months: 'every',
  monthsValue: '',
  weekdays: 'every',
  weekdaysValue: ''
})

// Preset expressions
const presets = computed(() => [
  { name: t('schedule.cron_preset_every_minute'), expression: '* * * * *' },
  { name: t('schedule.cron_preset_every_hour'), expression: '0 * * * *' },
  { name: t('schedule.cron_preset_daily'), expression: '0 0 * * *' },
  { name: t('schedule.cron_preset_weekly'), expression: '0 0 * * 0' },
  { name: t('schedule.cron_preset_monthly'), expression: '0 0 1 * *' },
  { name: t('schedule.cron_preset_every_15_min'), expression: '*/15 * * * *' },
  { name: t('schedule.cron_preset_every_30_min'), expression: '*/30 * * * *' },
  { name: t('schedule.cron_preset_every_2_hours'), expression: '0 */2 * * *' },
  { name: t('schedule.cron_preset_weekdays_9_am'), expression: '0 9 * * 1-5' },
  { name: t('schedule.cron_preset_weekends_10_am'), expression: '0 10 * * 0,6' }
])

// Options for selects
const minuteOptions = computed(() => [
  { title: t('schedule.cron_option_every_minute'), value: 'every' },
  { title: t('schedule.cron_option_every_5_minutes'), value: '*/5' },
  { title: t('schedule.cron_option_every_15_minutes'), value: '*/15' },
  { title: t('schedule.cron_option_every_30_minutes'), value: '*/30' },
  { title: t('schedule.cron_option_specific_minutes'), value: 'custom' }
])

const hourOptions = computed(() => [
  { title: t('schedule.cron_option_every_hour'), value: 'every' },
  { title: t('schedule.cron_option_every_2_hours'), value: '*/2' },
  { title: t('schedule.cron_option_every_6_hours'), value: '*/6' },
  { title: t('schedule.cron_option_every_12_hours'), value: '*/12' },
  { title: t('schedule.cron_option_specific_hours'), value: 'custom' }
])

const dayOptions = computed(() => [
  { title: t('schedule.cron_option_every_day'), value: 'every' },
  { title: t('schedule.cron_option_every_2_days'), value: '*/2' },
  { title: t('schedule.cron_option_every_week'), value: '*/7' },
  { title: t('schedule.cron_option_specific_days'), value: 'custom' }
])

const monthOptions = computed(() => [
  { title: t('schedule.cron_option_every_month'), value: 'every' },
  { title: t('schedule.cron_option_every_3_months'), value: '*/3' },
  { title: t('schedule.cron_option_every_6_months'), value: '*/6' },
  { title: t('schedule.cron_option_specific_months'), value: 'custom' }
])

const weekdayOptions = computed(() => [
  { title: t('schedule.cron_option_every_day'), value: 'every' },
  { title: t('schedule.cron_option_weekdays_only'), value: '1-5' },
  { title: t('schedule.cron_option_weekends_only'), value: '0,6' },
  { title: t('schedule.cron_option_specific_weekdays'), value: 'custom' }
])

// Computed properties
const expressionDescription = computed(() => {
  const parts = generatedExpression.value.split(' ')
  const [minute, hour, day, month, weekday] = parts

  let description = ''

  // Minutes
  if (minute === '*') description += t('schedule.cron_desc_every_minute')
  else if (minute === '0') description += t('schedule.cron_desc_at_minute_0')
  else if (minute.startsWith('*/')) description += t('schedule.cron_desc_every_n_minutes', { count: minute.slice(2) })
  else description += t('schedule.cron_desc_at_minutes', { minutes: minute })

  // Hours
  if (hour === '*') description += t('schedule.cron_desc_of_every_hour')
  else if (hour === '0') description += t('schedule.cron_desc_at_midnight')
  else if (hour.startsWith('*/')) description += t('schedule.cron_desc_every_n_hours', { count: hour.slice(2) })
  else description += t('schedule.cron_desc_at_hour', { hour })

  // Days
  if (day === '*') description += t('schedule.cron_desc_of_every_day')
  else if (day === '1') description += t('schedule.cron_desc_on_the_1st')
  else if (day.startsWith('*/')) description += t('schedule.cron_desc_every_n_days', { count: day.slice(2) })
  else description += t('schedule.cron_desc_on_day', { day })

  // Months
  if (month === '*') description += t('schedule.cron_desc_of_every_month')
  else if (month.startsWith('*/')) description += t('schedule.cron_desc_every_n_months', { count: month.slice(2) })
  else description += t('schedule.cron_desc_in_month', { month })

  // Weekdays
  if (weekday === '*') description += ''
  else if (weekday === '1-5') description += t('schedule.cron_desc_on_weekdays')
  else if (weekday === '0,6') description += t('schedule.cron_desc_on_weekends')
  else description += t('schedule.cron_desc_on_weekday', { weekday })

  return description
})

// Methods
const applyPreset = (expression: string) => {
  generatedExpression.value = expression
}

const updateExpression = () => {
  const parts: string[] = []

  // Minutes
  if (customSchedule.value.minutes === 'every') {
    parts.push('*')
  } else if (customSchedule.value.minutes === 'custom') {
    parts.push(customSchedule.value.minutesValue || '*')
  } else {
    parts.push(customSchedule.value.minutes)
  }

  // Hours
  if (customSchedule.value.hours === 'every') {
    parts.push('*')
  } else if (customSchedule.value.hours === 'custom') {
    parts.push(customSchedule.value.hoursValue || '*')
  } else {
    parts.push(customSchedule.value.hours)
  }

  // Days
  if (customSchedule.value.days === 'every') {
    parts.push('*')
  } else if (customSchedule.value.days === 'custom') {
    parts.push(customSchedule.value.daysValue || '*')
  } else {
    parts.push(customSchedule.value.days)
  }

  // Months
  if (customSchedule.value.months === 'every') {
    parts.push('*')
  } else if (customSchedule.value.months === 'custom') {
    parts.push(customSchedule.value.monthsValue || '*')
  } else {
    parts.push(customSchedule.value.months)
  }

  // Weekdays
  if (customSchedule.value.weekdays === 'every') {
    parts.push('*')
  } else if (customSchedule.value.weekdays === 'custom') {
    parts.push(customSchedule.value.weekdaysValue || '*')
  } else {
    parts.push(customSchedule.value.weekdays)
  }

  generatedExpression.value = parts.join(' ')
}

const copyExpression = () => {
  navigator.clipboard.writeText(generatedExpression.value)
}

const applyExpression = () => {
  emit('expression-change', generatedExpression.value)
  showBuilder.value = false
}
</script>

<style scoped>
.font-family-mono {
  font-family: 'Courier New', monospace;
  font-size: 0.875rem;
}

.v-chip-group {
  flex-wrap: wrap;
}

.rotate-180 {
  transform: rotate(180deg);
  transition: transform 0.3s ease;
}
</style> 