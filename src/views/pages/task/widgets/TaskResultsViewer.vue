<template>
  <v-container fluid>
    <!-- Header -->
    <v-row class="mb-4">
      <v-col cols="12">
        <div class="d-flex align-center justify-space-between">
          <div>
            <h2 class="text-h4 font-weight-bold">
              <v-icon class="mr-2">mdi-chart-box</v-icon>
              Task Results
            </h2>
            <p class="text-subtitle-1 text-medium-emphasis">
              View and export results for task #{{ taskId }}
            </p>
          </div>
          <div class="d-flex">
            <v-btn
              color="secondary"
              prepend-icon="mdi-download"
              @click="exportResults"
              :loading="exporting"
              class="mr-2"
            >
              Export Results
            </v-btn>
            <v-btn
              color="primary"
              prepend-icon="mdi-arrow-left"
              @click="goBack"
            >
              Back to Tasks
            </v-btn>
          </div>
        </div>
      </v-col>
    </v-row>

    <!-- Task Info Card -->
    <v-row class="mb-4">
      <v-col cols="12">
        <v-card>
          <v-card-title>Task Information</v-card-title>
          <v-card-text>
            <v-row>
              <v-col cols="12" md="6">
                <div class="d-flex align-center mb-2">
                  <strong class="mr-2">Name:</strong>
                  <span>{{ taskInfo.name }}</span>
                </div>
                <div class="d-flex align-center mb-2">
                  <strong class="mr-2">Platform:</strong>
                  <v-chip size="small" color="primary">{{ taskInfo.platform }}</v-chip>
                </div>
                <div class="d-flex align-center mb-2">
                  <strong class="mr-2">Status:</strong>
                  <v-chip
                    :color="getStatusColor(taskInfo.status)"
                    size="small"
                  >
                    {{ taskInfo.status }}
                  </v-chip>
                </div>
              </v-col>
              <v-col cols="12" md="6">
                <div class="d-flex align-center mb-2">
                  <strong class="mr-2">Results Count:</strong>
                  <span>{{ results.length }}</span>
                </div>
                <div class="d-flex align-center mb-2">
                  <strong class="mr-2">Created:</strong>
                  <span>{{ formatDate(taskInfo.created_at) }}</span>
                </div>
                <div class="d-flex align-center mb-2">
                  <strong class="mr-2">Updated:</strong>
                  <span>{{ formatDate(taskInfo.updated_at) }}</span>
                </div>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Search and Filters -->
    <v-row class="mb-4">
      <v-col cols="12">
        <v-card>
          <v-card-text>
            <v-row>
              <v-col cols="12" md="6">
                <v-text-field
                  v-model="searchQuery"
                  prepend-inner-icon="mdi-magnify"
                  label="Search results"
                  single-line
                  hide-details
                  density="compact"
                />
              </v-col>
              <v-col cols="12" md="3">
                <v-select
                  v-model="selectedColumns"
                  :items="availableColumns"
                  label="Visible columns"
                  multiple
                  chips
                  hide-details
                  density="compact"
                />
              </v-col>
              <v-col cols="12" md="3">
                <v-select
                  v-model="exportFormat"
                  :items="exportFormats"
                  label="Export format"
                  hide-details
                  density="compact"
                />
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Results Table -->
    <v-row>
      <v-col cols="12">
        <v-card>
          <v-card-title class="d-flex align-center justify-space-between">
            <span>Results ({{ filteredResults.length }})</span>
            <div class="d-flex align-center">
              <v-btn
                icon="mdi-refresh"
                variant="text"
                @click="loadResults"
                :loading="loading"
              />
            </div>
          </v-card-title>
          <v-card-text>
            <v-data-table
              :headers="tableHeaders"
              :items="paginatedResults"
              :loading="loading"
              :search="searchQuery"
              :items-per-page="itemsPerPage"
              :page="currentPage"
              @update:options="handleTableUpdate"
              class="elevation-1"
            >
              <template v-slot:item.title="{ item }">
                <a
                  :href="item.url"
                  target="_blank"
                  class="text-decoration-none"
                  style="color: #1976d2;"
                >
                  {{ item.title }}
                </a>
              </template>
              
              <template v-slot:item.description="{ item }">
                <div class="text-truncate" style="max-width: 300px;">
                  {{ item.description }}
                </div>
              </template>
              
              <template v-slot:item.actions="{ item }">
                <v-btn
                  icon="mdi-open-in-new"
                  size="small"
                  variant="text"
                  @click="openUrl(item.url)"
                />
              </template>
            </v-data-table>
            
            <!-- Pagination -->
            <div class="d-flex justify-center mt-4">
              <v-pagination
                v-model="currentPage"
                :length="totalPages"
                :total-visible="7"
              />
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Export Dialog -->
    <v-dialog v-model="exportDialog.show" max-width="400">
      <v-card>
        <v-card-title>Export Results</v-card-title>
        <v-card-text>
          <v-select
            v-model="exportDialog.format"
            :items="exportFormats"
            label="Export format"
            class="mb-4"
          />
          <v-text-field
            v-model="exportDialog.filename"
            label="Filename"
            hint="Enter filename without extension"
            persistent-hint
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn color="secondary" @click="exportDialog.show = false">Cancel</v-btn>
          <v-btn
            color="primary"
            @click="confirmExport"
            :loading="exporting"
          >
            Export
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'

const props = defineProps<{
  taskId: number
}>()

const router = useRouter()

// Reactive data
const loading = ref(false)
const exporting = ref(false)
const searchQuery = ref('')
const currentPage = ref(1)
const itemsPerPage = ref(20)
const exportFormat = ref('csv')

// Task info
const taskInfo = ref({
  id: props.taskId,
  name: 'Sample Task',
  platform: 'google',
  status: 'completed',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
})

// Results data
const results = ref([
  {
    id: 1,
    title: 'Sample Result 1',
    url: 'https://example.com/1',
    description: 'This is a sample result description that might be quite long and need to be truncated in the table view.',
    domain: 'example.com',
    position: 1,
    timestamp: new Date().toISOString()
  },
  {
    id: 2,
    title: 'Sample Result 2',
    url: 'https://example.com/2',
    description: 'Another sample result with different content.',
    domain: 'example.com',
    position: 2,
    timestamp: new Date().toISOString()
  }
])

// Column management
const availableColumns = ref([
  { title: 'Title', key: 'title', value: 'title' },
  { title: 'URL', key: 'url', value: 'url' },
  { title: 'Description', key: 'description', value: 'description' },
  { title: 'Domain', key: 'domain', value: 'domain' },
  { title: 'Position', key: 'position', value: 'position' },
  { title: 'Timestamp', key: 'timestamp', value: 'timestamp' }
])

const selectedColumns = ref(['title', 'url', 'description', 'domain'])

// Export options
const exportFormats = ref([
  { title: 'CSV', value: 'csv' },
  { title: 'JSON', value: 'json' },
  { title: 'Excel', value: 'xlsx' }
])

// Dialog state
const exportDialog = ref({
  show: false,
  format: 'csv',
  filename: `task-${props.taskId}-results`
})

// Computed properties
const filteredResults = computed(() => {
  if (!searchQuery.value) return results.value
  
  const query = searchQuery.value.toLowerCase()
  return results.value.filter(result => 
    result.title.toLowerCase().includes(query) ||
    result.description.toLowerCase().includes(query) ||
    result.url.toLowerCase().includes(query) ||
    result.domain.toLowerCase().includes(query)
  )
})

const totalPages = computed(() => {
  return Math.ceil(filteredResults.value.length / itemsPerPage.value)
})

const paginatedResults = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage.value
  const end = start + itemsPerPage.value
  return filteredResults.value.slice(start, end)
})

const tableHeaders = computed(() => {
  return selectedColumns.value.map(key => {
    const column = availableColumns.value.find(col => col.value === key)
    return {
      title: column?.title || key,
      key: key,
      sortable: true
    }
  }).concat([
    {
      title: 'Actions',
      key: 'actions',
      sortable: false
    }
  ])
})

// Methods
const loadTaskInfo = async () => {
  try {
    loading.value = true
    // TODO: Load task info from API
    console.log('Loading task info for task ID:', props.taskId)
  } catch (error) {
    console.error('Failed to load task info:', error)
  } finally {
    loading.value = false
  }
}

const loadResults = async () => {
  try {
    loading.value = true
    // TODO: Load results from API
    console.log('Loading results for task ID:', props.taskId)
  } catch (error) {
    console.error('Failed to load results:', error)
  } finally {
    loading.value = false
  }
}

const handleTableUpdate = (options: any) => {
  if (options.page !== undefined) {
    currentPage.value = options.page
  }
  if (options.itemsPerPage !== undefined) {
    itemsPerPage.value = options.itemsPerPage
  }
}

const exportResults = () => {
  exportDialog.value.show = true
}

const confirmExport = async () => {
  try {
    exporting.value = true
    const data = filteredResults.value
    const format = exportDialog.value.format
    const filename = exportDialog.value.filename
    
    switch (format) {
      case 'csv':
        await exportToCSV(data, filename)
        break
      case 'json':
        await exportToJSON(data, filename)
        break
      case 'xlsx':
        await exportToExcel(data, filename)
        break
    }
    
    exportDialog.value.show = false
  } catch (error) {
    console.error('Export failed:', error)
  } finally {
    exporting.value = false
  }
}

const exportToCSV = async (data: any[], filename: string) => {
  const headers = selectedColumns.value
  const csvContent = [
    headers.join(','),
    ...data.map(row => 
      headers.map(header => {
        const value = row[header] || ''
        return `"${String(value).replace(/"/g, '""')}"`
      }).join(',')
    )
  ].join('\n')
  
  downloadFile(csvContent, `${filename}.csv`, 'text/csv')
}

const exportToJSON = async (data: any[], filename: string) => {
  const jsonContent = JSON.stringify(data, null, 2)
  downloadFile(jsonContent, `${filename}.json`, 'application/json')
}

const exportToExcel = async (data: any[], filename: string) => {
  // TODO: Implement Excel export using a library like xlsx
  console.log('Excel export not implemented yet')
  // For now, fall back to CSV
  await exportToCSV(data, filename)
}

const downloadFile = (content: string, filename: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

const openUrl = (url: string) => {
  window.open(url, '_blank')
}

const goBack = () => {
  router.push({ name: 'TaskManagement' })
}

const getStatusColor = (status: string) => {
  switch (status.toLowerCase()) {
    case 'completed': return 'success'
    case 'running': return 'primary'
    case 'failed': return 'error'
    case 'pending': return 'warning'
    default: return 'grey'
  }
}

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleString()
}

// Lifecycle
onMounted(() => {
  loadTaskInfo()
  loadResults()
})

// Watch for search query changes
watch(searchQuery, () => {
  currentPage.value = 1
})
</script>

<style scoped>
.v-container {
  max-width: 1200px;
  margin: 0 auto;
}

.text-truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

