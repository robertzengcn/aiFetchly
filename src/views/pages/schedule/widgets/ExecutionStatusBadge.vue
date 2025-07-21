<template>
  <v-chip
    :color="statusColor"
    :variant="statusVariant"
    size="small"
    :prepend-icon="statusIcon"
  >
    {{ statusLabel }}
  </v-chip>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ExecutionStatus } from '@/entity/ScheduleExecutionLog.entity'

// Props
interface Props {
  status: ExecutionStatus
}

const props = defineProps<Props>()

// Computed properties
const statusColor = computed(() => {
  switch (props.status) {
    case ExecutionStatus.SUCCESS:
      return 'success'
    case ExecutionStatus.FAILED:
      return 'error'
    case ExecutionStatus.RUNNING:
      return 'info'
    case ExecutionStatus.CANCELLED:
      return 'warning'
    case ExecutionStatus.TIMEOUT:
      return 'orange'
    default:
      return 'grey'
  }
})

const statusVariant = computed(() => {
  switch (props.status) {
    case ExecutionStatus.SUCCESS:
      return 'elevated'
    case ExecutionStatus.FAILED:
      return 'elevated'
    case ExecutionStatus.RUNNING:
      return 'elevated'
    case ExecutionStatus.CANCELLED:
      return 'outlined'
    case ExecutionStatus.TIMEOUT:
      return 'elevated'
    default:
      return 'outlined'
  }
})

const statusIcon = computed(() => {
  switch (props.status) {
    case ExecutionStatus.SUCCESS:
      return 'mdi-check-circle'
    case ExecutionStatus.FAILED:
      return 'mdi-alert-circle'
    case ExecutionStatus.RUNNING:
      return 'mdi-play-circle'
    case ExecutionStatus.CANCELLED:
      return 'mdi-stop-circle'
    case ExecutionStatus.TIMEOUT:
      return 'mdi-clock-alert'
    default:
      return 'mdi-help-circle'
  }
})

const statusLabel = computed(() => {
  switch (props.status) {
    case ExecutionStatus.SUCCESS:
      return 'Success'
    case ExecutionStatus.FAILED:
      return 'Failed'
    case ExecutionStatus.RUNNING:
      return 'Running'
    case ExecutionStatus.CANCELLED:
      return 'Cancelled'
    case ExecutionStatus.TIMEOUT:
      return 'Timeout'
    default:
      return 'Unknown'
  }
})
</script>

<style scoped>
.v-chip {
  font-weight: 500;
  text-transform: capitalize;
}
</style> 