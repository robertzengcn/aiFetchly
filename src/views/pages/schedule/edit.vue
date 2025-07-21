<template>
  <v-container fluid>
    <!-- Header -->
    <v-row class="mb-4">
      <v-col cols="12">
        <div class="d-flex align-center">
          <v-btn
            icon="mdi-arrow-left"
            variant="text"
            @click="goBack"
            class="mr-4"
          />
          <div>
            <h2 class="text-h4 font-weight-bold">
              <v-icon class="mr-2">mdi-pencil</v-icon>
              Edit Schedule
            </h2>
            <p class="text-subtitle-1 text-medium-emphasis">
              {{ schedule?.name || 'Loading...' }}
            </p>
          </div>
        </div>
      </v-col>
    </v-row>

    <!-- Loading State -->
    <v-row v-if="loading && !schedule">
      <v-col cols="12">
        <v-card>
          <v-card-text class="text-center py-8">
            <v-progress-circular
              indeterminate
              color="primary"
              size="64"
            />
            <div class="text-h6 mt-4">Loading schedule...</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Error State -->
    <v-row v-else-if="error">
      <v-col cols="12">
        <v-card>
          <v-card-text class="text-center py-8">
            <v-icon size="64" color="error" class="mb-4">mdi-alert-circle</v-icon>
            <div class="text-h6 text-error mb-2">Failed to load schedule</div>
            <div class="text-body-2 text-medium-emphasis mb-4">{{ error }}</div>
            <v-btn
              color="primary"
              @click="loadSchedule"
            >
              Retry
            </v-btn>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Form -->
    <v-row v-else-if="schedule">
      <v-col cols="12">
        <v-card>
          <v-card-text>
            <ScheduleForm
              :schedule="schedule"
              :is-edit="true"
              :loading="submitting"
              @submit="handleSubmit"
              @cancel="goBack"
            />
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Alert Dialog -->
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
          <v-btn
            color="primary"
            @click="handleAlertAction"
          >
            {{ alertDialog.actionText }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ScheduleForm from './widgets/ScheduleForm.vue'
import { getScheduleById, updateSchedule } from '@/views/api/schedule'
import { ScheduleUpdateRequest } from '@/entityTypes/schedule-type'

const route = useRoute()
const router = useRouter()

// Reactive data
const schedule = ref<any>(null)
const loading = ref(false)
const submitting = ref(false)
const error = ref('')

// Alert dialog
const alertDialog = ref({
  show: false,
  title: '',
  message: '',
  type: 'info' as 'success' | 'error' | 'warning' | 'info',
  actionText: 'OK',
  action: null as (() => void) | null
})

// Methods
const loadSchedule = async () => {
  const scheduleId = Number(route.params.id)
  
  if (!scheduleId || isNaN(scheduleId)) {
    error.value = 'Invalid schedule ID'
    return
  }

  try {
    loading.value = true
    error.value = ''
    
    const data = await getScheduleById(scheduleId)
    schedule.value = data.schedule
  } catch (err) {
    error.value = `Failed to load schedule: ${err}`
  } finally {
    loading.value = false
  }
}

const handleSubmit = async (data: ScheduleUpdateRequest) => {
  const scheduleId = Number(route.params.id)
  
  try {
    submitting.value = true
    await updateSchedule(scheduleId, data)
    
    showAlert(
      'Success',
      `Schedule "${data.name}" updated successfully`,
      'success',
      'View Schedule',
      () => router.push(`/schedule/detail/${scheduleId}`)
    )
  } catch (err) {
    showAlert(
      'Error',
      `Failed to update schedule: ${err}`,
      'error'
    )
  } finally {
    submitting.value = false
  }
}

const goBack = () => {
  router.push('/schedule/list')
}

const showAlert = (
  title: string,
  message: string,
  type: 'success' | 'error' | 'warning' | 'info',
  actionText?: string,
  action?: () => void
) => {
  alertDialog.value = {
    show: true,
    title,
    message,
    type,
    actionText: actionText || 'OK',
    action
  }
}

const handleAlertAction = () => {
  if (alertDialog.value.action) {
    alertDialog.value.action()
  }
  alertDialog.value.show = false
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
  loadSchedule()
})
</script>

<style scoped>
.v-card {
  border-radius: 8px;
}
</style> 