<template>
  <div v-if="error" class="error-display">
    <v-alert
      :type="error.type"
      :title="error.userFriendlyMessage || error.message"
      :text="error.details"
      variant="tonal"
      class="mb-4"
    >
      <template v-slot:prepend>
        <v-icon :icon="getErrorIcon(error.type)" size="large"></v-icon>
      </template>

      <!-- Recovery Options -->
      <div v-if="error.recoveryOptions && error.recoveryOptions.length > 0" class="mt-3">
        <div class="text-caption text-medium-emphasis mb-2">
          Try these options to resolve the issue:
        </div>
        <div class="d-flex flex-wrap gap-2">
          <v-btn
            v-for="option in error.recoveryOptions"
            :key="option.id"
            :color="option.color || 'primary'"
            :icon="option.icon"
            size="small"
            variant="outlined"
            @click="executeRecoveryOption(option)"
            :loading="recoveryLoading === option.id"
            :disabled="recoveryLoading !== null"
          >
            {{ option.label }}
          </v-btn>
        </div>
      </div>

      <!-- Retry Count Display -->
      <div v-if="error.retryCount && error.retryCount > 0" class="mt-2">
        <v-chip
          size="small"
          color="warning"
          variant="outlined"
        >
          Attempt {{ error.retryCount }} of 3
        </v-chip>
      </div>

      <!-- Offline Indicator -->
      <div v-if="error.isOffline" class="mt-2">
        <v-chip
          size="small"
          color="error"
          variant="outlined"
          icon="mdi-wifi-off"
        >
          You are currently offline
        </v-chip>
      </div>

      <!-- Action Buttons -->
      <template v-slot:actions>
        <v-spacer></v-spacer>
        
        <!-- Retry Button -->
        <v-btn
          v-if="error.recoverable && !error.recoveryOptions?.some(o => o.id === 'retry')"
          color="primary"
          variant="outlined"
          size="small"
          @click="retryOperation"
          :loading="retryLoading"
          :disabled="retryLoading"
        >
          Try Again
        </v-btn>

        <!-- Dismiss Button -->
        <v-btn
          color="secondary"
          variant="text"
          size="small"
          @click="dismissError"
        >
          Dismiss
        </v-btn>
      </template>
    </v-alert>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { ErrorInfo, RecoveryOption } from '@/views/utils/errorHandler'

interface Props {
  error: ErrorInfo | null
  onRetry?: () => Promise<void>
  onDismiss?: () => void
  onRecoveryOption?: (option: RecoveryOption) => Promise<void>
}

const props = withDefaults(defineProps<Props>(), {
  onRetry: undefined,
  onDismiss: undefined,
  onRecoveryOption: undefined
})

const retryLoading = ref(false)
const recoveryLoading = ref<string | null>(null)

// Get appropriate icon for error type
const getErrorIcon = (type: ErrorInfo['type']) => {
  switch (type) {
    case 'error':
      return 'mdi-alert-circle'
    case 'warning':
      return 'mdi-alert'
    case 'info':
      return 'mdi-information'
    default:
      return 'mdi-help-circle'
  }
}

// Execute recovery option
const executeRecoveryOption = async (option: RecoveryOption) => {
  if (recoveryLoading.value) return
  
  recoveryLoading.value = option.id
  
  try {
    if (props.onRecoveryOption) {
      await props.onRecoveryOption(option)
    } else {
      await option.action()
    }
  } catch (error) {
    console.error('Recovery option failed:', error)
  } finally {
    recoveryLoading.value = null
  }
}

// Retry operation
const retryOperation = async () => {
  if (retryLoading.value || !props.onRetry) return
  
  retryLoading.value = true
  
  try {
    await props.onRetry()
  } catch (error) {
    console.error('Retry operation failed:', error)
  } finally {
    retryLoading.value = false
  }
}

// Dismiss error
const dismissError = () => {
  if (props.onDismiss) {
    props.onDismiss()
  }
}
</script>

<style scoped>
.error-display {
  transition: all 0.3s ease;
}

.error-display:hover {
  transform: translateY(-1px);
}

/* Animation for error appearance */
.v-alert {
  animation: errorSlideIn 0.3s ease-out;
}

@keyframes errorSlideIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Focus management for accessibility */
.error-display:focus-within {
  outline: 2px solid var(--v-primary-base);
  outline-offset: 2px;
}
</style> 