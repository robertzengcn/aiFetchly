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
              {{ item.keywords.join(', ') }} in {{ item.location }}
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
            :model-value="item.progress"
            :color="getProgressColor(item.status)"
            height="8"
            rounded
            class="mr-2"
            style="width: 60px"
          ></v-progress-linear>
          <span class="text-caption">{{ item.progress }}%</span>
        </div>
      </template>

      <!-- Priority Column -->
      <template v-slot:item.priority="{ item }">
        <v-chip
          :color="getPriorityColor(item.priority)"
          size="small"
          variant="outlined"
        >
          {{ item.priority }}
        </v-chip>
      </template>

      <!-- Results Column -->
      <template v-slot:item.results_count="{ item }">
        <div class="d-flex align-center">
          <v-icon class="mr-1" size="small">mdi-database</v-icon>
          <span>{{ item.results_count }}</span>
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
          {{ formatDate(item.updated_at) }}
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
            v-if="item.status === 'pending' || item.status === 'paused'"
            icon="mdi-play"
            size="small"
            variant="text"
            color="success"
            @click="$emit('start', item)"
            class="mr-1"
          ></v-btn>

          <v-btn
            v-if="item.status === 'running'"
            icon="mdi-stop"
            size="small"
            variant="text"
            color="error"
            @click="$emit('stop', item)"
            class="mr-1"
          ></v-btn>

          <!-- Pause/Resume Button -->
          <v-btn
            v-if="item.status === 'running'"
            icon="mdi-pause"
            size="small"
            variant="text"
            color="warning"
            @click="$emit('pause', item)"
            class="mr-1"
          ></v-btn>

          <v-btn
            v-if="item.status === 'paused'"
            icon="mdi-play"
            size="small"
            variant="text"
            color="success"
            @click="$emit('resume', item)"
            class="mr-1"
          ></v-btn>

          <!-- View Results -->
          <v-btn
            v-if="item.status === 'completed'"
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
import { computed } from 'vue'

// Props
interface Props {
  tasks: any[]
  loading: boolean
}

const props = defineProps<Props>()

// Emits
const emit = defineEmits<{
  edit: [task: any]
  delete: [task: any]
  start: [task: any]
  stop: [task: any]
  pause: [task: any]
  resume: [task: any]
  'view-results': [task: any]
  'view-details': [task: any]
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
const getPlatformColor = (platform: string) => {
  const colors = {
    'yellowpages.com': 'blue',
    'yelp.com': 'red',
    'yellowpages.ca': 'green'
  }
  return colors[platform] || 'grey'
}

const getPlatformIcon = (platform: string) => {
  const icons = {
    'yellowpages.com': 'mdi-phone-book',
    'yelp.com': 'mdi-star',
    'yellowpages.ca': 'mdi-maple-leaf'
  }
  return icons[platform] || 'mdi-web'
}

const getStatusColor = (status: string) => {
  const colors = {
    pending: 'warning',
    running: 'info',
    completed: 'success',
    failed: 'error',
    paused: 'orange'
  }
  return colors[status] || 'grey'
}

const getStatusIcon = (status: string) => {
  const icons = {
    pending: 'mdi-clock-outline',
    running: 'mdi-play-circle',
    completed: 'mdi-check-circle',
    failed: 'mdi-alert-circle',
    paused: 'mdi-pause-circle'
  }
  return icons[status] || 'mdi-help-circle'
}

const getStatusText = (status: string) => {
  const texts = {
    pending: 'Pending',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
    paused: 'Paused'
  }
  return texts[status] || status
}

const getProgressColor = (status: string) => {
  if (status === 'failed') return 'error'
  if (status === 'completed') return 'success'
  if (status === 'running') return 'info'
  return 'warning'
}

const getPriorityColor = (priority: string) => {
  const colors = {
    high: 'error',
    medium: 'warning',
    low: 'success'
  }
  return colors[priority] || 'grey'
}

const formatDate = (dateString: string) => {
  const date = new Date(dateString)
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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