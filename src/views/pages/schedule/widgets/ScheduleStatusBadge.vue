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
import { ScheduleStatus } from '@/entity/ScheduleTask.entity'

// Props
interface Props {
  status: ScheduleStatus
}

const props = defineProps<Props>()

// Computed properties
const statusColor = computed(() => {
  switch (props.status) {
    case ScheduleStatus.ACTIVE:
      return 'success'
    case ScheduleStatus.INACTIVE:
      return 'grey'
    case ScheduleStatus.PAUSED:
      return 'warning'
    default:
      return 'grey'
  }
})

const statusVariant = computed(() => {
  switch (props.status) {
    case ScheduleStatus.ACTIVE:
      return 'elevated'
    case ScheduleStatus.INACTIVE:
      return 'outlined'
    case ScheduleStatus.PAUSED:
      return 'elevated'
    default:
      return 'outlined'
  }
})

const statusIcon = computed(() => {
  switch (props.status) {
    case ScheduleStatus.ACTIVE:
      return 'mdi-check-circle'
    case ScheduleStatus.INACTIVE:
      return 'mdi-pause-circle'
    case ScheduleStatus.PAUSED:
      return 'mdi-pause-circle'
    default:
      return 'mdi-help-circle'
  }
})

const statusLabel = computed(() => {
  switch (props.status) {
    case ScheduleStatus.ACTIVE:
      return 'Active'
    case ScheduleStatus.INACTIVE:
      return 'Inactive'
    case ScheduleStatus.PAUSED:
      return 'Paused'
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