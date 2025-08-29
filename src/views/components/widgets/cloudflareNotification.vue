<template>
  <v-snackbar
    v-model="show"
    :timeout="timeout"
    color="warning"
    rounded="lg"
    variant="tonal"
    top
    right
    max-width="400"
  >
    <div class="d-flex align-start">
      <v-icon class="mr-3 mt-1" color="warning" size="24">
        mdi-shield-alert
      </v-icon>
      <div class="flex-grow-1">
        <div class="text-subtitle-2 font-weight-bold mb-1">
          {{ t('notifications.cloudflare_protection_detected') }}
        </div>
        <div class="text-body-2 mb-2">
          {{ currentNotification?.message || '' }}
        </div>
        <div class="text-caption text-medium-emphasis mb-2">
          <strong>{{ t('notifications.recommendations') }}:</strong>
        </div>
        <ul class="text-caption text-medium-emphasis mb-2" style="margin: 0; padding-left: 16px;">
          <li>{{ t('notifications.wait_before_retry') }}</li>
          <li>{{ t('notifications.use_different_proxy') }}</li>
          <li>{{ t('notifications.reduce_frequency') }}</li>
          <li>{{ t('notifications.check_manual_access') }}</li>
        </ul>
        <div class="text-caption text-medium-emphasis">
          <strong>{{ t('notifications.task_id') }}:</strong> {{ currentNotification?.taskId || 'N/A' }}
        </div>
      </div>
    </div>
    
    <template v-slot:actions="{ attrs }">
      <v-btn
        color="white"
        variant="text"
        size="small"
        v-bind="attrs"
        @click="dismiss"
        class="mr-2"
      >
        {{ t('notifications.dismiss') }}
      </v-btn>
      <v-btn
        color="primary"
        variant="text"
        size="small"
        v-bind="attrs"
        @click="viewTaskDetails"
      >
        {{ t('notifications.view_task') }}
      </v-btn>
    </template>
  </v-snackbar>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import notificationManager from '@/views/services/notificationManager'

const { t } = useI18n()
const router = useRouter()

const props = withDefaults(defineProps<{
  timeout?: number
}>(), {
  timeout: 10000
})

// Get reactive state from notification manager
const state = notificationManager.getState()

// Computed properties
const show = computed({
  get: () => state.showCloudflareNotification,
  set: (value: boolean) => {
    if (!value) {
      notificationManager.dismissCloudflareNotification()
    }
  }
})

const currentNotification = computed(() => state.currentCloudflareNotification)

// Methods
const dismiss = () => {
  notificationManager.dismissCloudflareNotification()
}

const viewTaskDetails = () => {
  if (currentNotification.value) {
    notificationManager.viewTaskDetails(currentNotification.value.taskId)
  }
}

// Lifecycle
onMounted(() => {
  // Set router in notification manager
  notificationManager.setRouter(router)
})
</script>

<style scoped>
.v-snackbar {
  z-index: 9999;
}

.v-snackbar :deep(.v-snackbar__content) {
  padding: 16px;
}

.v-snackbar :deep(.v-snackbar__wrapper) {
  border-radius: 12px;
}
</style>
