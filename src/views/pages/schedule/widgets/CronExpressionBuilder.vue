<template>
  <div>
    <v-btn
      color="primary"
      variant="outlined"
      size="small"
      @click="showBuilder = true"
    >
      <v-icon class="mr-1">mdi-tools</v-icon>
      Builder
    </v-btn>

    <v-dialog v-model="showBuilder" max-width="600">
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon class="mr-2">mdi-clock-outline</v-icon>
          Cron Expression Builder
        </v-card-title>

        <v-card-text>
          <v-container>
            <!-- Preset Options -->
            <v-row>
              <v-col cols="12">
                <h4 class="text-subtitle-1 mb-2">Quick Presets</h4>
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
                <h4 class="text-subtitle-1 mb-2">Custom Schedule</h4>
              </v-col>
            </v-row>

            <!-- Minutes -->
            <v-row>
              <v-col cols="12" md="6">
                <v-select
                  v-model="customSchedule.minutes"
                  :items="minuteOptions"
                  label="Minutes"
                  @update:model-value="updateExpression"
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field
                  v-if="customSchedule.minutes === 'custom'"
                  v-model="customSchedule.minutesValue"
                  label="Custom Minutes"
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
                  label="Hours"
                  @update:model-value="updateExpression"
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field
                  v-if="customSchedule.hours === 'custom'"
                  v-model="customSchedule.hoursValue"
                  label="Custom Hours"
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
                  label="Days"
                  @update:model-value="updateExpression"
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field
                  v-if="customSchedule.days === 'custom'"
                  v-model="customSchedule.daysValue"
                  label="Custom Days"
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
                  label="Months"
                  @update:model-value="updateExpression"
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field
                  v-if="customSchedule.months === 'custom'"
                  v-model="customSchedule.monthsValue"
                  label="Custom Months"
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
                  label="Weekdays"
                  @update:model-value="updateExpression"
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field
                  v-if="customSchedule.weekdays === 'custom'"
                  v-model="customSchedule.weekdaysValue"
                  label="Custom Weekdays"
                  placeholder="1,3,5"
                  @update:model-value="updateExpression"
                />
              </v-col>
            </v-row>

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
                      Copy
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
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            @click="applyExpression"
          >
            Apply Expression
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

// Emits
const emit = defineEmits<{
  'expression-change': [expression: string]
}>()

// Reactive data
const showBuilder = ref(false)
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
const presets = [
  { name: 'Every Minute', expression: '* * * * *' },
  { name: 'Every Hour', expression: '0 * * * *' },
  { name: 'Daily', expression: '0 0 * * *' },
  { name: 'Weekly', expression: '0 0 * * 0' },
  { name: 'Monthly', expression: '0 0 1 * *' },
  { name: 'Every 15 Min', expression: '*/15 * * * *' },
  { name: 'Every 30 Min', expression: '*/30 * * * *' },
  { name: 'Every 2 Hours', expression: '0 */2 * * *' },
  { name: 'Weekdays 9 AM', expression: '0 9 * * 1-5' },
  { name: 'Weekends 10 AM', expression: '0 10 * * 0,6' }
]

// Options for selects
const minuteOptions = [
  { title: 'Every Minute', value: 'every' },
  { title: 'Every 5 Minutes', value: '*/5' },
  { title: 'Every 15 Minutes', value: '*/15' },
  { title: 'Every 30 Minutes', value: '*/30' },
  { title: 'Specific Minutes', value: 'custom' }
]

const hourOptions = [
  { title: 'Every Hour', value: 'every' },
  { title: 'Every 2 Hours', value: '*/2' },
  { title: 'Every 6 Hours', value: '*/6' },
  { title: 'Every 12 Hours', value: '*/12' },
  { title: 'Specific Hours', value: 'custom' }
]

const dayOptions = [
  { title: 'Every Day', value: 'every' },
  { title: 'Every 2 Days', value: '*/2' },
  { title: 'Every Week', value: '*/7' },
  { title: 'Specific Days', value: 'custom' }
]

const monthOptions = [
  { title: 'Every Month', value: 'every' },
  { title: 'Every 3 Months', value: '*/3' },
  { title: 'Every 6 Months', value: '*/6' },
  { title: 'Specific Months', value: 'custom' }
]

const weekdayOptions = [
  { title: 'Every Day', value: 'every' },
  { title: 'Weekdays Only', value: '1-5' },
  { title: 'Weekends Only', value: '0,6' },
  { title: 'Specific Days', value: 'custom' }
]

// Computed properties
const expressionDescription = computed(() => {
  const parts = generatedExpression.value.split(' ')
  const [minute, hour, day, month, weekday] = parts

  let description = ''

  // Minutes
  if (minute === '*') description += 'Every minute'
  else if (minute === '0') description += 'At minute 0'
  else if (minute.startsWith('*/')) description += `Every ${minute.slice(2)} minutes`
  else description += `At minutes ${minute}`

  // Hours
  if (hour === '*') description += ' of every hour'
  else if (hour === '0') description += ' at midnight'
  else if (hour.startsWith('*/')) description += ` every ${hour.slice(2)} hours`
  else description += ` at ${hour}:00`

  // Days
  if (day === '*') description += ' of every day'
  else if (day === '1') description += ' on the 1st'
  else if (day.startsWith('*/')) description += ` every ${day.slice(2)} days`
  else description += ` on day ${day}`

  // Months
  if (month === '*') description += ' of every month'
  else if (month.startsWith('*/')) description += ` every ${month.slice(2)} months`
  else description += ` in month ${month}`

  // Weekdays
  if (weekday === '*') description += ''
  else if (weekday === '1-5') description += ' on weekdays'
  else if (weekday === '0,6') description += ' on weekends'
  else description += ` on weekday ${weekday}`

  return description
})

// Methods
const applyPreset = (expression: string) => {
  generatedExpression.value = expression
}

const updateExpression = () => {
  const parts = []

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
</style> 