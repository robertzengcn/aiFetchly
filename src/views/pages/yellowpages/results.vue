<template>
  <v-container fluid>
    <!-- Header with back button and task info -->
    <v-row class="mb-4">
      <v-col cols="12">
        <div class="d-flex align-center mb-4">
          <v-btn
            icon="mdi-arrow-left"
            variant="text"
            @click="goBack"
            class="mr-4"
          />
          <div>
            <h2 class="text-h4 font-weight-bold">
              <v-icon class="mr-2">mdi-chart-box</v-icon>
              {{ t('home.task_results') }}
            </h2>
            <p class="text-subtitle-1 text-medium-emphasis">
              {{ taskDetails?.name || 'Loading task details...' }}
            </p>
          </div>
        </div>
      </v-col>
    </v-row>

    <!-- Task Summary Card -->
    <v-row class="mb-4" v-if="taskDetails">
      <v-col cols="12">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-information</v-icon>
            {{ t('home.task_summary') }}
          </v-card-title>
          <v-card-text>
            <v-row>
              <v-col cols="12" md="3">
                <div class="text-center">
                  <div class="text-h6 font-weight-bold text-primary">{{ taskDetails?.task?.platform }}</div>
                  <div class="text-caption">{{ t('home.platform') }}</div>
                </div>
              </v-col>
              <v-col cols="12" md="3">
                <div class="text-center">
                  <div class="text-h6 font-weight-bold text-success">{{ results.length }}</div>
                  <div class="text-caption">{{ t('home.total_results') }}</div>
                </div>
              </v-col>
              <v-col cols="12" md="3">
                <div class="text-center">
                  <div class="text-h6 font-weight-bold" :class="getStatusColor(taskDetails.status)">
                    {{ getStatusText(taskDetails.status) }}
                  </div>
                  <div class="text-caption">{{ t('home.status') }}</div>
                </div>
              </v-col>
              <v-col cols="12" md="3">
                <div class="text-center">
                  <div class="text-h6 font-weight-bold text-info">
                    {{ formatDate(taskDetails?.task?.created_at) }}
                  </div>
                  <div class="text-caption">{{ t('common.created_time') }}</div>
                </div>
              </v-col>
            </v-row>
            
            <!-- Task Details -->
            <v-divider class="my-4" />
            <v-row>
              <v-col cols="12" md="6">
                <div class="d-flex align-center mb-2">
                  <v-icon class="mr-2" size="small">mdi-magnify</v-icon>
                  <strong>{{ t('home.keywords') }}:</strong>
                </div>
                <div class="ml-8">
                  <v-chip
                    v-for="keyword in keywords"
                    :key="keyword"
                    size="small"
                    color="primary"
                    variant="outlined"
                    class="mr-1 mb-1"
                  >
                    {{ keyword }}
                  </v-chip>
                </div>
              </v-col>
              <v-col cols="12" md="6">
                <div class="d-flex align-center mb-2">
                  <v-icon class="mr-2" size="small">mdi-map-marker</v-icon>
                  <strong>{{ t('home.location') }}:</strong>
                </div>
                <div class="ml-8">{{ taskDetails?.task?.location }}</div>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Results Actions -->
    <v-row class="mb-4">
      <v-col cols="12">
        <v-card>
          <v-card-text>
            <div class="d-flex justify-space-between align-center flex-wrap">
              <div class="d-flex align-center">
                <v-text-field
                  v-model="searchQuery"
                  :label="t('home.search_results')"
                  prepend-inner-icon="mdi-magnify"
                  clearable
                  placeholder="Search by business name, email, phone..."
                  class="mr-4"
                  style="min-width: 300px;"
                />
                <v-select
                  v-model="categoryFilter"
                  :items="categoryOptions"
                  :label="t('home.filter_by_category')"
                  clearable
                  class="mr-4"
                  style="min-width: 200px;"
                />
              </div>
              <div class="d-flex align-center">
                <v-btn
                  color="primary"
                  variant="outlined"
                  prepend-icon="mdi-download"
                  @click="exportResults"
                  :loading="exporting"
                  class="mr-2"
                >
                  {{ t('home.export_results') }}
                </v-btn>
                <v-btn
                  color="secondary"
                  variant="outlined"
                  @click="refreshResults"
                  :loading="loading"
                >
                  <v-icon>mdi-refresh</v-icon>
                </v-btn>
              </div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Results Table -->
    <v-row>
      <v-col cols="12">
        <v-card>
          <v-card-title class="d-flex justify-space-between align-center">
            <div>
              <span>{{ t('home.results') }} ({{ totalResults }})</span>
              <v-chip
                v-if="hasActiveFilters"
                color="info"
                size="small"
                class="ml-2"
              >
                {{ filteredResults.length }} of {{ totalResults }} results match filters
              </v-chip>
            </div>
            <v-chip color="info" size="small">
              {{ t('home.page') }} {{ currentPage + 1 }} {{ t('home.of') }} {{ totalPages }}
            </v-chip>
          </v-card-title>
          <v-card-text>
            <div v-if="!loading && hasActiveFilters && filteredResults.length === 0" class="text-center py-8">
              <v-icon size="64" color="grey-lighten-1" class="mb-4">mdi-filter-off</v-icon>
              <h3 class="text-h6 text-grey-darken-1 mb-2">No results match your filters</h3>
              <p class="text-body-2 text-grey-darken-1 mb-4">
                Try adjusting your search criteria or clearing some filters
              </p>
              <v-btn
                color="primary"
                variant="outlined"
                @click="clearFilters"
              >
                Clear All Filters
              </v-btn>
            </div>
            <div v-else-if="!loading && results.length === 0" class="text-center py-8">
              <v-icon size="64" color="grey-lighten-1" class="mb-4">mdi-chart-box-outline</v-icon>
              <h3 class="text-h6 text-grey-darken-1 mb-2">No results found</h3>
              <p class="text-body-2 text-grey-darken-1">
                This task hasn't produced any results yet or the scraping is still in progress.
              </p>
            </div>
            <YellowPagesResultsTable
              v-else
              :results="paginatedResults"
              :loading="loading"
              @view-details="viewResultDetails"
            />
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

   
   <v-row class="mt-4" v-if="totalPages > 1">
      <v-col cols="12" class="d-flex justify-center">
        <v-pagination
          v-model="currentPage"
          :length="totalPages"
          :total-visible="7"
          @update:model-value="handlePageChange"
        />
      </v-col>
    </v-row>

    <!-- Result Details Dialog -->
    <v-dialog v-model="resultDetailsDialog.show" max-width="800">
      <v-card>
        <v-card-title class="d-flex justify-space-between align-center">
          <span>{{ t('home.result_details') }}</span>
          <v-btn icon="mdi-close" variant="text" @click="resultDetailsDialog.show = false"></v-btn>
        </v-card-title>
        <v-card-text>
          <ResultDetailsView
            v-if="resultDetailsDialog.show"
            :result="resultDetailsDialog.result"
            @close="resultDetailsDialog.show = false"
          />
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import YellowPagesResultsTable from './components/YellowPagesResultsTable.vue'
import ResultDetailsView from './components/ResultDetailsView.vue'
import { getYellowPagesTaskResults, getYellowPagesTaskDetail } from '@/views/api/yellowpages'
import { YellowPagesResult, TaskStatus } from '@/modules/interface/ITaskManager'

// Route and router
const route = useRoute()
const router = useRouter()
const { t } = useI18n()

// Get task ID from route
const taskId = Number(route.params.id)

// Reactive data
const loading = ref(false)
const exporting = ref(false)
const searchQuery = ref('')
const categoryFilter = ref('')
const currentPage = ref(0)
const pageSize = ref(20)
const results = ref<YellowPagesResult[]>([])
const taskDetails = ref<any>(null)
const totalResults = ref(0)
const totalPages = ref(0)

// Dialog states
const resultDetailsDialog = reactive({
  show: false,
  result: null as any
})

// Computed properties
const hasActiveFilters = computed(() => {
  return !!(searchQuery.value || categoryFilter.value)
})

const keywords = computed(() => {
  return taskDetails.value?.task?.keywords || []
})

const categoryOptions = computed(() => {
  const categories = new Set<string>()
  results.value.forEach(result => {
    if (result.categories) {
      if (Array.isArray(result.categories)) {
        result.categories.forEach(cat => categories.add(cat))
      } else {
        categories.add(result.categories)
      }
    }
  })
  return Array.from(categories).sort()
})

const filteredResults = computed(() => {
  let filtered = results.value

  // Apply search filter
  if (searchQuery.value && searchQuery.value.trim()) {
    const searchTerm = searchQuery.value.trim().toLowerCase()
    filtered = filtered.filter(result => {
      // Search in business name
      if (result.business_name && result.business_name.toLowerCase().includes(searchTerm)) {
        return true
      }
      // Search in email
      if (result.email && result.email.toLowerCase().includes(searchTerm)) {
        return true
      }
      // Search in phone
      if (result.phone && result.phone.toLowerCase().includes(searchTerm)) {
        return true
      }
      // Search in website
      if (result.website && result.website.toLowerCase().includes(searchTerm)) {
        return true
      }
      // Search in address
      if (result.address?.street && result.address.street.toLowerCase().includes(searchTerm)) {
        return true
      }
      return false
    })
  }

  // Apply category filter
  if (categoryFilter.value) {
    filtered = filtered.filter(result => {
      if (!result.categories) return false
      if (Array.isArray(result.categories)) {
        return result.categories.includes(categoryFilter.value)
      }
      return result.categories === categoryFilter.value
    })
  }

  return filtered
})

const paginatedResults = computed(() => {
  // Since we're now getting paginated data from backend, just return the current results
  return filteredResults.value
})

// Methods
const goBack = () => {
  router.go(-1)
}

const loadTaskDetails = async () => {
  try {
    const response = await getYellowPagesTaskDetail(taskId)
    if (response) {
      console.log(response)
      taskDetails.value = response
    }
  } catch (error) {
    console.error('Failed to load task details:', error)
  }
}

const loadResults = async (page: number = 0) => {
  loading.value = true
  try {
    if(page==0){
      page = 1;
    }
    const response = await getYellowPagesTaskResults(taskId, page, pageSize.value)
    if (response) {
      results.value = response.data
      totalResults.value = response.pagination.total
      totalPages.value = response.pagination.totalPages
      currentPage.value = response.pagination.page
    } else {
      results.value = []
      totalResults.value = 0
      totalPages.value = 0
    }
  } catch (error) {
    console.error('Failed to load results:', error)
    results.value = []
    totalResults.value = 0
    totalPages.value = 0
  } finally {
    loading.value = false
  }
}

const refreshResults = async () => {
  await loadResults(currentPage.value)
  await loadTaskDetails()
}

const exportResults = async () => {
  exporting.value = true
  try {
    // TODO: Implement export functionality when the API is ready
    // For now, create a simple CSV export
    const csvContent = createCSVExport()
    downloadCSV(csvContent, `yellowpages_results_${taskId}_${new Date().toISOString().split('T')[0]}.csv`)
  } catch (error) {
    console.error('Failed to export results:', error)
  } finally {
    exporting.value = false
  }
}

const createCSVExport = () => {
  const headers = [
    'Business Name',
    'Email',
    'Phone',
    'Website',
    'Address',
    'City',
    'State',
    'ZIP',
    'Country',
    'Categories',
    'Rating',
    'Review Count',
    'Description',
    'Scraped At'
  ]

  const csvRows = [headers.join(',')]

  filteredResults.value.forEach(result => {
    const row = [
      `"${result.business_name || ''}"`,
      `"${result.email || ''}"`,
      `"${result.phone || ''}"`,
      `"${result.website || ''}"`,
      `"${result.address?.street || ''}"`,
      `"${result.address?.city || ''}"`,
      `"${result.address?.state || ''}"`,
      `"${result.address?.zip || ''}"`,
      `"${result.address?.country || ''}"`,
      `"${Array.isArray(result.categories) ? result.categories.join(', ') : result.categories || ''}"`,
      result.rating || '',
      result.review_count || '',
      `"${(result.description || '').replace(/"/g, '""')}"`,
      result.scraped_at || ''
    ]
    csvRows.push(row.join(','))
  })

  return csvRows.join('\n')
}

const downloadCSV = (content: string, filename: string) => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  link.setAttribute('href', url)
  link.setAttribute('download', filename)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

const clearFilters = () => {
  searchQuery.value = ''
  categoryFilter.value = ''
  currentPage.value = 0
}

const handlePageChange = async (page: number) => {
  currentPage.value = page
  await loadResults(page)
}

const viewResultDetails = (result: YellowPagesResult) => {
  resultDetailsDialog.result = result
  resultDetailsDialog.show = true
}

const getStatusColor = (status: TaskStatus) => {
  switch (status) {
    case TaskStatus.Completed:
      return 'text-success'
    case TaskStatus.InProgress:
      return 'text-primary'
    case TaskStatus.Failed:
      return 'text-error'
    case TaskStatus.Paused:
      return 'text-warning'
    default:
      return 'text-grey'
  }
}

const getStatusText = (status: TaskStatus) => {
  switch (status) {
    case TaskStatus.Completed:
      return t('home.completed')
    case TaskStatus.InProgress:
      return t('home.running')
    case TaskStatus.Failed:
      return t('home.failed')
    case TaskStatus.Paused:
      return t('home.paused')
    default:
      return t('home.pending')
  }
}

const formatDate = (date: string | Date) => {
  if (!date) return 'N/A'
  return new Date(date).toLocaleDateString()
}

// Watch for filter changes
watch([searchQuery, categoryFilter], () => {
  // Reset to first page when filters change
  // currentPage.value = 0
  // Reload results with new filters
  // loadResults(0)
})

// Lifecycle
onMounted(() => {
  if (taskId) {
    loadTaskDetails()
    loadResults()
  }
})
</script>

<style scoped>
.v-card {
  border-radius: 8px;
}

.v-btn {
  text-transform: none;
}

/* Responsive improvements */
@media (max-width: 960px) {
  .d-flex.justify-space-between {
    flex-direction: column;
    align-items: stretch;
  }
  
  .d-flex.justify-space-between > div {
    margin-bottom: 16px;
  }
  
  .v-text-field,
  .v-select {
    margin-bottom: 16px;
  }
}

@media (max-width: 600px) {
  .v-card-title {
    padding: 16px;
  }
  
  .v-card-text {
    padding: 16px;
  }
}
</style>


