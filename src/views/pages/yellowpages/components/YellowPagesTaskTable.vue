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
            <div class="d-flex align-center">
              <span class="font-weight-medium">{{ item.name }}</span>
              <!-- Results indicator badge -->
              <v-chip
                v-if="item.results_count && item.results_count > 0"
                size="x-small"
                color="success"
                class="ml-2"
                :title="`${item.results_count} results available`"
              >
                {{ item.results_count }} results
              </v-chip>
            </div>
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



      <!-- Results Column -->
      <template v-slot:item.results_count="{ item }">
        <div class="d-flex align-center">
          <v-icon class="mr-1" size="small" :color="item.results_count && item.results_count > 0 ? 'primary' : 'grey'">mdi-database</v-icon>
          <div v-if="item.results_count && item.results_count > 0">
            <v-btn
              variant="text"
              size="small"
              color="primary"
              class="px-0 text-body-2 font-weight-medium results-button"
              @click="$emit('view-results', item)"
              :title="`View ${item.results_count} results`"
            >
              <v-chip
                size="x-small"
                color="primary"
                variant="outlined"
                class="mr-1"
              >
                {{ item.results_count }}
              </v-chip>
              View Results
            </v-btn>
          </div>
          <div v-else class="text-caption text-grey-darken-1">
            {{ item.status === TaskStatus.InProgress ? 'Collecting...' : 'No results' }}
          </div>
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
          <!-- <v-btn
            icon="mdi-eye"
            size="small"
            variant="text"
            color="info"
            @click="$emit('view-details', item)"
            class="mr-1"
          ></v-btn> -->

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
          <v-btn
            v-if="item.status === TaskStatus.InProgress"
            icon="mdi-pause"
            size="small"
            variant="text"
            color="warning"
            @click="$emit('pause', item)"
            class="mr-1"
            title="Pause Task"
          ></v-btn>

          <v-btn
            v-if="item.status === TaskStatus.Paused"
            icon="mdi-play"
            size="small"
            variant="text"
            color="success"
            @click="$emit('resume', item)"
            class="mr-1"
            title="Resume Task"
          ></v-btn>

          <!-- View Results -->
          <v-btn
            v-if="item.results_count && item.results_count > 0"
            icon="mdi-chart-bar"
            size="small"
            variant="text"
            color="primary"
            @click="$emit('view-results', item)"
            class="mr-1"
            :title="`View ${item.results_count} results`"
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
import { useI18n } from 'vue-i18n'
import { TaskSummary, TaskStatus } from '@/interfaces/ITaskManager'

// Props
interface Props {
  tasks: TaskSummary[]
  loading: boolean
}

const props = defineProps<Props>()

// i18n
const { t } = useI18n()

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

// Table headers - computed to support language switching
const headers = computed(() => [
  { title: t('home.task_name'), key: 'name', sortable: true },
  { title: t('home.platform'), key: 'platform', sortable: true },
  { title: t('home.status'), key: 'status', sortable: true },
  { title: t('home.progress'), key: 'progress', sortable: true },
  { title: t('home.results'), key: 'results_count', sortable: true },
  { title: t('home.created_time'), key: 'created_at', sortable: true },
  { title: t('home.updated_time'), key: 'updated_at', sortable: true },
  { title: t('home.actions'), key: 'actions', sortable: false }
])

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

/* Results button styling */
.results-button {
  transition: all 0.2s ease;
}

.results-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}
</style> 