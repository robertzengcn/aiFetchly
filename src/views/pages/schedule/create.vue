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
              <v-icon class="mr-2">mdi-plus-circle</v-icon>
              {{ t('schedule.create_new_schedule') }}
            </h2>
            <p class="text-subtitle-1 text-medium-emphasis">
              {{ t('schedule.create_description') }}
            </p>
          </div>
        </div>
      </v-col>
    </v-row>

    <!-- Form -->
    <v-row>
      <v-col cols="12">
        <v-card>
          <v-card-text>
            <ScheduleForm
              :loading="loading"
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
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import ScheduleForm from './widgets/ScheduleForm.vue'
import { createSchedule } from '@/views/api/schedule'
import { ScheduleCreateRequest, ScheduleUpdateRequest } from '@/entityTypes/schedule-type'

const { t } = useI18n()

const router = useRouter()

// Reactive data
const loading = ref(false)

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
const handleSubmit = async (data: ScheduleCreateRequest | ScheduleUpdateRequest) => {
  // Cast to ScheduleCreateRequest since this is a create page
  const createData = data as ScheduleCreateRequest
  try {
    loading.value = true
    const scheduleId = await createSchedule(createData)
    
    showAlert(
      t('common.success'),
      t('schedule.schedule_created_success', { name: createData.name, id: scheduleId }),
      'success',
      t('schedule.view_schedule'),
      () => router.push(`/schedule/detail/${scheduleId}`)
    )
  } catch (error) {
    showAlert(
      t('common.error'),
      t('schedule.create_schedule_failed', { error: String(error) }),
      'error'
    )
  } finally {
    loading.value = false
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
    actionText: actionText || t('common.ok'),
    action: action || null
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
</script>

<style scoped>
.v-card {
  border-radius: 8px;
}
</style> 