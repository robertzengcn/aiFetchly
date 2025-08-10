<template>
  <v-data-table-server
    v-model:items-per-page="itemsPerPage"
    :search="search"
    :headers="headers"
    :items-length="totalItems"
    :items="serverItems"
    :loading="loading"
    item-value="id"
    @update:options="loadItems"
  >
    <template v-slot:[`item.status`]="{ item }">
      <v-chip
        :color="getStatusColor(item.status)"
        size="small"
        variant="tonal"
      >
        {{ getStatusText(item.status) }}
      </v-chip>
    </template>

    <template v-slot:[`item.platform`]="{ item }">
      <v-chip
        color="primary"
        size="small"
        variant="outlined"
      >
        {{ item.platform }}
      </v-chip>
    </template>

    <template v-slot:[`item.actions`]="{ item }">
      <v-btn
        icon="mdi-play"
        size="small"
        color="success"
        variant="text"
        @click="$emit('run-task', item)"
        :disabled="item.status === 'running'"
        title="Run Task"
      />
      <v-btn
        icon="mdi-eye"
        size="small"
        color="info"
        variant="text"
        @click="$emit('view-results', item)"
        :disabled="item.status !== 'completed'"
        title="View Results"
      />
      <v-btn
        icon="mdi-pencil"
        size="small"
        color="warning"
        variant="text"
        @click="$emit('edit-task', item)"
        title="Edit Task"
      />
      <v-btn
        icon="mdi-delete"
        size="small"
        color="error"
        variant="text"
        @click="$emit('delete-task', item)"
        title="Delete Task"
      />
    </template>
  </v-data-table-server>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { TaskEntity } from '@/entityTypes/task-type'

// Props
interface Props {
  tasks: TaskEntity[]
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  loading: false
})

// Emits
const emit = defineEmits<{
  'edit-task': [task: TaskEntity]
  'delete-task': [task: TaskEntity]
  'run-task': [task: TaskEntity]
  'view-results': [task: TaskEntity]
}>()

// Table configuration
const headers = [
  { title: 'ID', key: 'id', sortable: false },
  { title: 'Name', key: 'name', sortable: true },
  { title: 'Platform', key: 'platform', sortable: true },
  { title: 'Status', key: 'status', sortable: true },
  { title: 'Created', key: 'created_at', sortable: true },
  { title: 'Results', key: 'results_count', sortable: false },
  { title: 'Actions', key: 'actions', sortable: false }
]

const itemsPerPage = ref(10)
const serverItems = ref<TaskEntity[]>([])
const totalItems = ref(0)
const search = ref('')

// Methods
const loadItems = ({ page, itemsPerPage, sortBy }) => {
  // This would typically call an API
  serverItems.value = props.tasks
  totalItems.value = props.tasks.length
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'completed': return 'success'
    case 'running': return 'info'
    case 'failed': return 'error'
    case 'cancelled': return 'warning'
    default: return 'grey'
  }
}

const getStatusText = (status: string) => {
  return status.charAt(0).toUpperCase() + status.slice(1)
}
</script>
