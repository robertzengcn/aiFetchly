<template>
  <div v-if="task">
    <v-row>
      <!-- Task Information -->
      <v-col cols="12" md="6">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-information</v-icon>
            Task Information
          </v-card-title>
          <v-card-text>
            <v-list>
              <v-list-item>
                <template v-slot:prepend>
                  <v-icon>mdi-format-title</v-icon>
                </template>
                <v-list-item-title>Name</v-list-item-title>
                <v-list-item-subtitle>{{ task.name }}</v-list-item-subtitle>
              </v-list-item>

              <v-list-item>
                <template v-slot:prepend>
                  <v-icon :color="getPlatformColor(task.platform)">
                    {{ getPlatformIcon(task.platform) }}
                  </v-icon>
                </template>
                <v-list-item-title>Platform</v-list-item-title>
                <v-list-item-subtitle>{{ task.platform }}</v-list-item-subtitle>
              </v-list-item>

              <v-list-item>
                <template v-slot:prepend>
                  <v-icon>mdi-tag</v-icon>
                </template>
                <v-list-item-title>Keywords</v-list-item-title>
                <v-list-item-subtitle>{{ task.keywords.join(', ') }}</v-list-item-subtitle>
              </v-list-item>

              <v-list-item>
                <template v-slot:prepend>
                  <v-icon>mdi-map-marker</v-icon>
                </template>
                <v-list-item-title>Location</v-list-item-title>
                <v-list-item-subtitle>{{ task.location }}</v-list-item-subtitle>
              </v-list-item>

              <v-list-item>
                <template v-slot:prepend>
                  <v-icon>mdi-file-document</v-icon>
                </template>
                <v-list-item-title>Max Pages</v-list-item-title>
                <v-list-item-subtitle>{{ task.max_pages }}</v-list-item-subtitle>
              </v-list-item>

              <v-list-item>
                <template v-slot:prepend>
                  <v-icon>mdi-priority-high</v-icon>
                </template>
                <v-list-item-title>Priority</v-list-item-title>
                <v-list-item-subtitle>
                  <v-chip
                    :color="getPriorityColor(task.priority)"
                    size="small"
                    variant="outlined"
                  >
                    {{ task.priority }}
                  </v-chip>
                </v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Task Status -->
      <v-col cols="12" md="6">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-chart-line</v-icon>
            Task Status
          </v-card-title>
          <v-card-text>
            <v-list>
              <v-list-item>
                <template v-slot:prepend>
                  <v-icon :color="getStatusColor(task.status)">
                    {{ getStatusIcon(task.status) }}
                  </v-icon>
                </template>
                <v-list-item-title>Status</v-list-item-title>
                <v-list-item-subtitle>
                  <v-chip
                    :color="getStatusColor(task.status)"
                    size="small"
                    class="font-weight-medium"
                  >
                    {{ getStatusText(task.status) }}
                  </v-chip>
                </v-list-item-subtitle>
              </v-list-item>

              <v-list-item>
                <template v-slot:prepend>
                  <v-icon>mdi-progress-clock</v-icon>
                </template>
                <v-list-item-title>Progress</v-list-item-title>
                <v-list-item-subtitle>
                  <div class="d-flex align-center">
                    <v-progress-linear
                      :model-value="task.progress"
                      :color="getProgressColor(task.status)"
                      height="8"
                      rounded
                      class="mr-2"
                      style="width: 100px"
                    ></v-progress-linear>
                    <span class="text-caption">{{ task.progress }}%</span>
                  </div>
                </v-list-item-subtitle>
              </v-list-item>

              <v-list-item>
                <template v-slot:prepend>
                  <v-icon>mdi-database</v-icon>
                </template>
                <v-list-item-title>Results Count</v-list-item-title>
                <v-list-item-subtitle>{{ task.results_count }}</v-list-item-subtitle>
              </v-list-item>

              <v-list-item>
                <template v-slot:prepend>
                  <v-icon>mdi-calendar</v-icon>
                </template>
                <v-list-item-title>Created</v-list-item-title>
                <v-list-item-subtitle>{{ formatDate(task.created_at) }}</v-list-item-subtitle>
              </v-list-item>

              <v-list-item>
                <template v-slot:prepend>
                  <v-icon>mdi-update</v-icon>
                </template>
                <v-list-item-title>Last Updated</v-list-item-title>
                <v-list-item-subtitle>{{ formatDate(task.updated_at) }}</v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Task Actions -->
    <v-row class="mt-4">
      <v-col cols="12">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-cog</v-icon>
            Task Actions
          </v-card-title>
          <v-card-text>
            <div class="d-flex flex-wrap gap-2">
              <!-- Start/Stop Button -->
              <v-btn
                v-if="task.status === 'pending' || task.status === 'paused'"
                color="success"
                prepend-icon="mdi-play"
                @click="$emit('start', task)"
              >
                Start Task
              </v-btn>

              <v-btn
                v-if="task.status === 'running'"
                color="error"
                prepend-icon="mdi-stop"
                @click="$emit('stop', task)"
              >
                Stop Task
              </v-btn>

              <!-- Pause/Resume Button -->
              <v-btn
                v-if="task.status === 'running'"
                color="warning"
                prepend-icon="mdi-pause"
                @click="$emit('pause', task)"
              >
                Pause Task
              </v-btn>

              <v-btn
                v-if="task.status === 'paused'"
                color="success"
                prepend-icon="mdi-play"
                @click="$emit('resume', task)"
              >
                Resume Task
              </v-btn>

              <!-- View Results -->
              <v-btn
                v-if="task.status === 'completed'"
                color="primary"
                prepend-icon="mdi-chart-bar"
                @click="$emit('view-results', task)"
              >
                View Results
              </v-btn>

              <!-- Edit Task -->
              <v-btn
                color="secondary"
                prepend-icon="mdi-pencil"
                @click="$emit('edit', task)"
              >
                Edit Task
              </v-btn>

              <!-- Delete Task -->
              <v-btn
                color="error"
                prepend-icon="mdi-delete"
                variant="outlined"
                @click="$emit('delete', task)"
              >
                Delete Task
              </v-btn>

              <!-- Close -->
              <v-btn
                color="grey"
                prepend-icon="mdi-close"
                variant="outlined"
                @click="$emit('close')"
              >
                Close
              </v-btn>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
// Props
interface Props {
  task: any
}

const props = defineProps<Props>()

// Emits
const emit = defineEmits<{
  start: [task: any]
  stop: [task: any]
  pause: [task: any]
  resume: [task: any]
  'view-results': [task: any]
  edit: [task: any]
  delete: [task: any]
  close: []
}>()

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
.v-card {
  border-radius: 8px;
}

.v-btn {
  text-transform: none;
}

.gap-2 {
  gap: 8px;
}
</style> 