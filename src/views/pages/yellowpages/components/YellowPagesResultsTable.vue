<template>
  <div>
    <v-data-table
      :headers="headers"
      :items="results"
      :loading="loading"
      class="elevation-1"
      item-key="id"
    >
      <!-- Business Name Column -->
      <template v-slot:item.business_name="{ item }">
        <div class="d-flex align-center">
          <v-icon class="mr-2" color="primary" size="small">mdi-store</v-icon>
          <div>
            <div class="font-weight-medium">{{ item.business_name }}</div>
            <div v-if="item.categories" class="text-caption text-grey-darken-1">
              <v-chip
                v-for="category in Array.isArray(item.categories) ? item.categories : [item.categories]"
                :key="category"
                size="x-small"
                color="primary"
                variant="outlined"
                class="mr-1"
              >
                {{ category }}
              </v-chip>
            </div>
          </div>
        </div>
      </template>

      <!-- Contact Information Column -->
      <template v-slot:item.contact="{ item }">
        <div class="d-flex flex-column">
          <div v-if="item.email" class="d-flex align-center mb-1">
            <v-icon size="small" class="mr-1" color="blue">mdi-email</v-icon>
            <span class="text-caption">{{ item.email }}</span>
          </div>
          <div v-if="item.phone" class="d-flex align-center mb-1">
            <v-icon size="small" class="mr-1" color="green">mdi-phone</v-icon>
            <span class="text-caption">{{ item.phone }}</span>
          </div>
          <div v-if="item.website" class="d-flex align-center">
            <v-icon size="small" class="mr-1" color="purple">mdi-web</v-icon>
            <a 
              :href="item.website" 
              target="_blank" 
              class="text-caption text-decoration-none"
              style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
            >
              {{ item.website }}
            </a>
          </div>
        </div>
      </template>

      <!-- Address Column -->
      <template v-slot:item.address="{ item }">
        <div v-if="item.address?.street || item.address?.city || item.address?.state">
          <div class="d-flex align-center mb-1">
            <v-icon size="small" class="mr-1" color="orange">mdi-map-marker</v-icon>
            <span class="text-caption">
              {{ formatAddress(item) }}
            </span>
          </div>
        </div>
        <div v-else class="text-caption text-grey-darken-1">
          No address available
        </div>
      </template>

      <!-- Rating Column -->
      <template v-slot:item.rating="{ item }">
        <div v-if="item.rating" class="d-flex align-center">
          <v-rating
            :model-value="item.rating"
            :length="5"
            size="small"
            readonly
            half-increments
            color="amber"
            density="compact"
          />
          <span class="ml-2 text-caption">{{ item.rating }}/5</span>
          <span v-if="item.review_count" class="ml-1 text-caption text-grey-darken-1">
            ({{ item.review_count }})
          </span>
        </div>
        <div v-else class="text-caption text-grey-darken-1">
          No rating
        </div>
      </template>

      <!-- Additional Info Column -->
      <template v-slot:item.additional="{ item }">
        <div class="d-flex flex-column">
          <div v-if="item.description" class="mb-1">
            <div class="text-caption text-grey-darken-1">Description:</div>
            <div class="text-caption" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              {{ item.description }}
            </div>
          </div>
          <div v-if="item.year_established" class="mb-1">
            <div class="text-caption text-grey-darken-1">Established:</div>
            <div class="text-caption">{{ item.year_established }}</div>
          </div>
          <div v-if="item.number_of_employees" class="mb-1">
            <div class="text-caption text-grey-darken-1">Employees:</div>
            <div class="text-caption">{{ item.number_of_employees }}</div>
          </div>
        </div>
      </template>

      <!-- Scraped At Column -->
      <template v-slot:item.scraped_at="{ item }">
        <div class="text-caption">
          {{ formatDate(item.scraped_at) }}
        </div>
      </template>

      <!-- Actions Column -->
      <template v-slot:item.actions="{ item }">
        <div class="d-flex">
          <v-btn
            icon="mdi-eye"
            size="small"
            variant="text"
            color="primary"
            @click="$emit('view-details', item)"
            :title="t('home.view_details')"
          />
          <v-btn
            v-if="item.website"
            icon="mdi-open-in-new"
            size="small"
            variant="text"
            color="blue"
            @click="openWebsite(item.website)"
            :title="t('home.open_website')"
          />
          <v-btn
            v-if="item.email"
            icon="mdi-email-outline"
            size="small"
            variant="text"
            color="green"
            @click="copyToClipboard(item.email, 'Email')"
            :title="t('home.copy_email')"
          />
          <v-btn
            v-if="item.phone"
            icon="mdi-content-copy"
            size="small"
            variant="text"
            color="orange"
            @click="copyToClipboard(item.phone, 'Phone')"
            :title="t('home.copy_phone')"
          />
        </div>
      </template>

      <!-- Loading State -->
      <template v-slot:loading>
        <v-skeleton-loader
          v-for="n in 5"
          :key="n"
          type="table-row"
          class="my-2"
        />
      </template>

      <!-- No Data State -->
      <template v-slot:no-data>
        <div class="text-center py-8">
          <v-icon size="64" color="grey-lighten-1" class="mb-4">mdi-chart-box-outline</v-icon>
          <h3 class="text-h6 text-grey-darken-1 mb-2">No results found</h3>
          <p class="text-body-2 text-grey-darken-1">
            This task hasn't produced any results yet.
          </p>
        </div>
      </template>
    </v-data-table>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { YellowPagesResult } from '@/interfaces/ITaskManager'

// Props
interface Props {
  results: YellowPagesResult[]
  loading: boolean
}

const props = defineProps<Props>()

// Emits
const emit = defineEmits<{
  'view-details': [result: YellowPagesResult]
}>()

// i18n
const { t } = useI18n()

// Table headers
const headers = computed(() => [
  {
    title: t('home.business_name'),
    key: 'business_name',
    sortable: true,
    width: '25%'
  },
  {
    title: t('home.contact'),
    key: 'contact',
    sortable: false,
    width: '20%'
  },
  {
    title: t('home.address'),
    key: 'address',
    sortable: false,
    width: '20%'
  },
  {
    title: t('home.rating'),
    key: 'rating',
    sortable: true,
    width: '15%'
  },
  {
    title: t('home.additional_info'),
    key: 'additional',
    sortable: false,
    width: '15%'
  },
  {
    title: t('home.scraped_at'),
    key: 'scraped_at',
    sortable: true,
    width: '10%'
  },
  {
    title: t('home.actions'),
    key: 'actions',
    sortable: false,
    width: '10%'
  }
])

// Methods
const parseCategories = (categories: string): string[] => {
  try {
    const parsed = JSON.parse(categories)
    return Array.isArray(parsed) ? parsed : [categories]
  } catch (e) {
    return [categories]
  }
}

const formatAddress = (item: YellowPagesResult): string => {
  const parts: string[] = []
  if (item.address?.street) parts.push(item.address.street)
  if (item.address?.city) parts.push(item.address.city)
  if (item.address?.state) parts.push(item.address.state)
  if (item.address?.zip) parts.push(item.address.zip)
  if (item.address?.country) parts.push(item.address.country)
  
  return parts.length > 0 ? parts.join(', ') : 'No address available'
}

const formatDate = (date: string | Date): string => {
  if (!date) return 'N/A'
  return new Date(date).toLocaleDateString()
}

const openWebsite = (url: string) => {
  if (url) {
    window.open(url, '_blank')
  }
}

const copyToClipboard = async (text: string, type: string) => {
  try {
    await navigator.clipboard.writeText(text)
    // You could add a toast notification here
    console.log(`${type} copied to clipboard: ${text}`)
  } catch (err) {
    console.error('Failed to copy to clipboard:', err)
    // Fallback for older browsers
    const textArea = document.createElement('textarea')
    textArea.value = text
    document.body.appendChild(textArea)
    textArea.select()
    document.execCommand('copy')
    document.body.removeChild(textArea)
  }
}
</script>

<style scoped>
.v-data-table {
  border-radius: 8px;
}

.v-data-table__wrapper {
  border-radius: 8px;
}

/* Custom styling for table cells */
:deep(.v-data-table__td) {
  padding: 12px 16px;
}

:deep(.v-data-table__th) {
  background-color: #f5f5f5;
  font-weight: 600;
}

/* Responsive improvements */
@media (max-width: 960px) {
  :deep(.v-data-table__td) {
    padding: 8px 12px;
  }
}

@media (max-width: 600px) {
  :deep(.v-data-table__td) {
    padding: 6px 8px;
  }
}
</style>


