<template>
  <div v-if="show" class="success-notification">
    <v-snackbar
      v-model="show"
      :timeout="timeout"
      :color="color"
      location="top"
      class="success-snackbar"
    >
      <div class="d-flex align-center">
        <v-icon
          :icon="icon"
          size="large"
          class="me-3"
        ></v-icon>
        
        <div class="flex-grow-1">
          <div class="text-body-1 font-weight-medium">
            {{ title }}
          </div>
          <div v-if="message" class="text-caption text-medium-emphasis">
            {{ message }}
          </div>
        </div>

        <!-- Undo Button -->
        <v-btn
          v-if="showUndo && onUndo"
          color="white"
          variant="text"
          size="small"
          @click="handleUndo"
          :loading="undoLoading"
          :disabled="undoLoading"
          class="ms-2"
        >
          Undo
        </v-btn>
      </div>

      <template v-slot:actions>
        <v-btn
          color="white"
          variant="text"
          @click="show = false"
        >
          Close
        </v-btn>
      </template>
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

interface Props {
  modelValue: boolean
  title: string
  message?: string
  timeout?: number
  color?: string
  icon?: string
  showUndo?: boolean
  onUndo?: () => Promise<void>
  autoNavigate?: boolean
  navigateTo?: string
}

const props = withDefaults(defineProps<Props>(), {
  timeout: 4000,
  color: 'success',
  icon: 'mdi-check-circle',
  showUndo: false,
  autoNavigate: false,
  navigateTo: ''
})

const emit = defineEmits(['update:modelValue'])

const show = ref(props.modelValue)
const undoLoading = ref(false)

// Watch for prop changes
watch(() => props.modelValue, (newValue) => {
  show.value = newValue
})

watch(show, (newValue) => {
  emit('update:modelValue', newValue)
  
  // Auto navigate after success
  if (newValue && props.autoNavigate && props.navigateTo) {
    setTimeout(() => {
      // Navigate to specified route
      window.location.href = props.navigateTo
    }, 1000)
  }
})

// Handle undo action
const handleUndo = async () => {
  if (undoLoading.value || !props.onUndo) return
  
  undoLoading.value = true
  
  try {
    await props.onUndo()
    show.value = false
  } catch (error) {
    console.error('Undo action failed:', error)
  } finally {
    undoLoading.value = false
  }
}
</script>

<style scoped>
.success-notification {
  z-index: 9999;
}

.success-snackbar {
  animation: successSlideIn 0.3s ease-out;
}

@keyframes successSlideIn {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Success animation */
.success-snackbar .v-icon {
  animation: successPulse 0.6s ease-out;
}

@keyframes successPulse {
  0% {
    transform: scale(0.8);
    opacity: 0.5;
  }
  50% {
    transform: scale(1.1);
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

/* Hover effect */
.success-snackbar:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
</style> 