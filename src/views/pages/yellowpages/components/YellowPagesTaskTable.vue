<template>
  <div>
    <v-data-table
      :headers="headers"
      :items="tasks"
      :loading="loading"
      :items-per-page="10"
      class="elevation-1"
    >
      <!-- Task Name Column -->
      <template v-slot:item.name="{ item }">
        <div class="d-flex align-center">
          <v-icon class="mr-2" :color="getPlatformColor(item.platform)">
            {{ getPlatformIcon(item.platform) }}
          </v-icon>
          <div>
            <div class="font-weight-medium">{{ item.name }}</div>
            <div class="text-caption text-medium-emphasis">
              Platform: {{ item.platform }}
            </div>
          </div>
        </div>
      </template>

      <!-- Status Column -->
      <template v-slot:item.status="{ item }">
        <v-chip
          :color="getStatusColor(item.status)"
          size="small"
          class="font-weight-medium"
        >
          <v-icon start size="small">{{ getStatusIcon(item.status) }}</v-icon>
          {{ getStatusText(item.status) }}
        </v-chip>
      </template>

      <!-- Progress Column -->
      <template v-slot:item.progress="{ item }">
        <div class="d-flex align-center">
          <v-progress-linear
            :model-value="item.progress_percentage || 0"
            :color="getProgressColor(item.status)"
            height="8"
            rounded
            class="mr-2"
            style="width: 60px"
          ></v-progress-linear>
          <span class="text-caption">{{ item.progress_percentage || 0 }}%</span>
        </div>
      </template>

      <!-- Priority Column -->
      <template v-slot:item.priority="{ item }">
        <v-chip
          color="grey"
          size="small"
          variant="outlined"
        >
          N/A
        </v-chip>
      </template>

      <!-- Results Column -->
      <template v-slot:item.results_count="{ item }">
        <div class="d-flex align-center">
          <v-icon class="mr-1" size="small">mdi-database</v-icon>
          <span>{{ item.results_count || 0 }}</span>
        </div>
      </template>

      <!-- Created Date Column -->
      <template v-slot:item.created_at="{ item }">
        <div class="text-caption">
          {{ formatDate(item.created_at) }}
        </div>
      </template>

      <!-- Updated Date Column -->
      <template v-slot:item.updated_at="{ item }">
        <div class="text-caption">
          {{ formatDate(item.created_at) }}
        </div>
      </template>

      <!-- Actions Column -->
      <template v-slot:item.actions="{ item }">
        <div class="d-flex align-center">
          <!-- View Details -->
          <v-btn
            icon="mdi-eye"
            size="small"
            variant="text"
            color="info"
            @click="$emit('view-details', item)"
            class="mr-1"
          ></v-btn>

          <!-- Start/Stop Button -->
          <v-btn
            v-if="item.status === TaskStatus.Pending || item.status === TaskStatus.Paused||item.status === TaskStatus.Failed||item.status === TaskStatus.Completed"
            icon="mdi-play"
            size="small"
            variant="text"
            color="success"
            @click="$emit('start', item)"
            class="mr-1"
          ></v-btn>

          <v-btn
            v-if="item.status === TaskStatus.InProgress"
            icon="mdi-stop"
            size="small"
            variant="text"
            color="error"
            @click="$emit('stop', item)"
            class="mr-1"
          ></v-btn>

          <!-- Pause/Resume Button -->
          <!-- <v-btn
            v-if="item.status === TaskStatus.InProgress"
            icon="mdi-pause"
            size="small"
            variant="text"
            color="warning"
            @click="$emit('pause', item)"
            class="mr-1"
          ></v-btn> -->

          <!-- <v-btn
            v-if="item.status === TaskStatus.Paused"
            icon="mdi-play"
            size="small"
            variant="text"
            color="success"
            @click="$emit('resume', item)"
            class="mr-1"
          ></v-btn> -->

          <!-- View Results -->
          <v-btn
            v-if="item.status === TaskStatus.Completed"
            icon="mdi-chart-bar"
            size="small"
            variant="text"
            color="primary"
            @click="$emit('view-results', item)"
            class="mr-1"
          ></v-btn>

          <!-- Edit Button -->
          <v-btn
            icon="mdi-pencil"
            size="small"
            variant="text"
            color="secondary"
            @click="$emit('edit', item)"
            class="mr-1"
          ></v-btn>

          <!-- Delete Button -->
          <v-btn
            icon="mdi-delete"
            size="small"
            variant="text"
            color="error"
            @click="$emit('delete', item)"
          ></v-btn>
        </div>
      </template>
    </v-data-table>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { TaskSummary, TaskStatus } from '@/interfaces/ITaskManager'

// Props
interface Props {
  tasks: TaskSummary[]
  loading: boolean
}

const props = defineProps<Props>()

// Emits
const emit = defineEmits<{
  edit: [task: TaskSummary]
  delete: [task: TaskSummary]
  start: [task: TaskSummary]
  stop: [task: TaskSummary]
  pause: [task: TaskSummary]
  resume: [task: TaskSummary]
  'view-results': [task: TaskSummary]
  'view-details': [task: TaskSummary]
}>()

// Table headers
const headers = [
  { title: 'Task Name', key: 'name', sortable: true },
  { title: 'Platform', key: 'platform', sortable: true },
  { title: 'Status', key: 'status', sortable: true },
  { title: 'Progress', key: 'progress', sortable: true },
  { title: 'Priority', key: 'priority', sortable: true },
  { title: 'Results', key: 'results_count', sortable: true },
  { title: 'Created', key: 'created_at', sortable: true },
  { title: 'Updated', key: 'updated_at', sortable: true },
  { title: 'Actions', key: 'actions', sortable: false }
]

// Methods
const getPlatformColor = (platform?: string) => {
  if (!platform) return 'grey'
  const colors = {
    'yellowpages.com': 'blue',
    'yelp.com': 'red',
    'yellowpages.ca': 'green'
  }
  return colors[platform] || 'grey'
}

const getPlatformIcon = (platform?: string) => {
  if (!platform) return 'mdi-web'
  const icons = {
    'yellowpages.com': 'mdi-phone-book',
    'yelp.com': 'mdi-star',
    'yellowpages.ca': 'mdi-maple-leaf'
  }
  return icons[platform] || 'mdi-web'
}

const getStatusColor = (status?: TaskStatus) => {
  if (!status) return 'grey'
  const colors = {
    [TaskStatus.Pending]: 'warning',
    [TaskStatus.InProgress]: 'info',
    [TaskStatus.Completed]: 'success',
    [TaskStatus.Failed]: 'error',
    [TaskStatus.Paused]: 'orange'
  }
  return colors[status] || 'grey'
}

const getStatusIcon = (status?: TaskStatus) => {
  if (!status) return 'mdi-help-circle'
  const icons = {
    [TaskStatus.Pending]: 'mdi-clock-outline',
    [TaskStatus.InProgress]: 'mdi-play-circle',
    [TaskStatus.Completed]: 'mdi-check-circle',
    [TaskStatus.Failed]: 'mdi-alert-circle',
    [TaskStatus.Paused]: 'mdi-pause-circle'
  }
  return icons[status] || 'mdi-help-circle'
}

const getStatusText = (status?: TaskStatus) => {
  if (!status) return 'Unknown'
  const texts = {
    [TaskStatus.Pending]: 'Pending',
    [TaskStatus.InProgress]: 'Running',
    [TaskStatus.Completed]: 'Completed',
    [TaskStatus.Failed]: 'Failed',
    [TaskStatus.Paused]: 'Paused'
  }
  return texts[status] || status
}

const getProgressColor = (status?: TaskStatus) => {
  if (!status) return 'warning'
  if (status === TaskStatus.Failed) return 'error'
  if (status === TaskStatus.Completed) return 'success'
  if (status === TaskStatus.InProgress) return 'info'
  return 'warning'
}

const getPriorityColor = (priority?: string) => {
  if (!priority) return 'grey'
  const colors = {
    high: 'error',
    medium: 'warning',
    low: 'success'
  }
  return colors[priority] || 'grey'
}

const formatDate = (date: Date | string) => {
  if (!date) return 'N/A'
  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date
    return dateObj.toLocaleDateString()
  } catch {
    return 'Invalid Date'
  }
}
</script>

<style scoped>
.v-data-table {
  border-radius: 8px;
}

.v-chip {
  text-transform: none;
}
</style> 