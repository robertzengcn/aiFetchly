<template>
  <div>
    <v-row>
      <!-- Business Information -->
      <v-col cols="12" md="6">
        <v-card class="mb-4">
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-store</v-icon>
            {{ t('home.business_information') }}
          </v-card-title>
          <v-card-text>
            <div class="mb-3">
              <div class="text-caption text-grey-darken-1">{{ t('home.business_name') }}</div>
              <div class="text-body-1 font-weight-medium">{{ result.business_name }}</div>
            </div>
            
            <div v-if="result.categories" class="mb-3">
              <div class="text-caption text-grey-darken-1">{{ t('home.categories') }}</div>
              <div class="d-flex flex-wrap">
                <v-chip
                  v-for="category in Array.isArray(result.categories) ? result.categories : [result.categories]"
                  :key="category"
                  size="small"
                  color="primary"
                  variant="outlined"
                  class="mr-1 mb-1"
                >
                  {{ category }}
                </v-chip>
              </div>
            </div>
            
            <div v-if="result.description" class="mb-3">
              <div class="text-caption text-grey-darken-1">{{ t('home.description') }}</div>
              <div class="text-body-2">{{ result.description }}</div>
            </div>
            
            <div v-if="result.year_established" class="mb-3">
              <div class="text-caption text-grey-darken-1">{{ t('home.year_established') }}</div>
              <div class="text-body-2">{{ result.year_established }}</div>
            </div>
            
            <div v-if="result.number_of_employees" class="mb-3">
              <div class="text-caption text-grey-darken-1">{{ t('home.number_of_employees') }}</div>
              <div class="text-body-2">{{ result.number_of_employees }}</div>
            </div>
            
            <div v-if="result.specialties" class="mb-3">
              <div class="text-caption text-grey-darken-1">{{ t('home.specialties') }}</div>
              <div class="d-flex flex-wrap">
                <v-chip
                  v-for="specialty in Array.isArray(result.specialties) ? result.specialties : [result.specialties]"
                  :key="specialty"
                  size="small"
                  color="secondary"
                  variant="outlined"
                  class="mr-1 mb-1"
                >
                  {{ specialty }}
                </v-chip>
              </div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Contact Information -->
      <v-col cols="12" md="6">
        <v-card class="mb-4">
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-phone</v-icon>
            {{ t('home.contact_information') }}
          </v-card-title>
          <v-card-text>
            <div v-if="result.email" class="mb-3">
              <div class="text-caption text-grey-darken-1">{{ t('home.email') }}</div>
              <div class="d-flex align-center">
                <span class="text-body-2 mr-2">{{ result.email }}</span>
                <v-btn
                  icon="mdi-content-copy"
                  size="small"
                  variant="text"
                  color="primary"
                  @click="copyToClipboard(result.email, 'Email')"
                  :title="t('home.copy_email')"
                />
              </div>
            </div>
            
            <div v-if="result.phone" class="mb-3">
              <div class="text-caption text-grey-darken-1">{{ t('home.phone') }}</div>
              <div class="d-flex align-center">
                <span class="text-body-2 mr-2">{{ result.phone }}</span>
                <v-btn
                  icon="mdi-content-copy"
                  size="small"
                  variant="text"
                  color="primary"
                  @click="copyToClipboard(result.phone, 'Phone')"
                  :title="t('home.copy_phone')"
                />
              </div>
            </div>
            
            <div v-if="result.fax_number" class="mb-3">
              <div class="text-caption text-grey-darken-1">{{ t('home.fax_number') }}</div>
              <div class="text-body-2">{{ result.fax_number }}</div>
            </div>
            
            <div v-if="result.website" class="mb-3">
              <div class="text-caption text-grey-darken-1">{{ t('home.website') }}</div>
              <div class="d-flex align-center">
                <a 
                  :href="result.website" 
                  target="_blank" 
                  class="text-body-2 text-decoration-none mr-2"
                >
                  {{ result.website }}
                </a>
                <v-btn
                  icon="mdi-open-in-new"
                  size="small"
                  variant="text"
                  color="blue"
                  @click="openWebsite(result.website)"
                  :title="t('home.open_website')"
                />
              </div>
            </div>
            
            <div v-if="result.contact_person" class="mb-3">
              <div class="text-caption text-grey-darken-1">{{ t('home.contact_person') }}</div>
              <div class="text-body-2">{{ result.contact_person }}</div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Address Information -->
    <v-row v-if="hasAddress">
      <v-col cols="12">
        <v-card class="mb-4">
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-map-marker</v-icon>
            {{ t('home.address_information') }}
          </v-card-title>
          <v-card-text>
            <v-row>
              <v-col cols="12" md="6">
                <div v-if="result.address?.street" class="mb-3">
                  <div class="text-caption text-grey-darken-1">{{ t('home.street_address') }}</div>
                  <div class="text-body-2">{{ result.address.street }}</div>
                </div>
              </v-col>
              <v-col cols="12" md="6">
                <div v-if="result.address?.city" class="mb-3">
                  <div class="text-caption text-grey-darken-1">{{ t('home.city') }}</div>
                  <div class="text-body-2">{{ result.address.city }}</div>
                </div>
              </v-col>
              <v-col cols="12" md="4">
                <div v-if="result.address?.state" class="mb-3">
                  <div class="text-caption text-grey-darken-1">{{ t('home.state') }}</div>
                  <div class="text-body-2">{{ result.address.state }}</div>
                </div>
              </v-col>
              <v-col cols="12" md="4">
                <div v-if="result.address?.zip" class="mb-3">
                  <div class="text-caption text-grey-darken-1">{{ t('home.zip_code') }}</div>
                  <div class="text-body-2">{{ result.address.zip }}</div>
                </div>
              </v-col>
              <v-col cols="12" md="4">
                <div v-if="result.address?.country" class="mb-3">
                  <div class="text-caption text-grey-darken-1">{{ t('home.country') }}</div>
                  <div class="text-body-2">{{ result.address.country }}</div>
                </div>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Additional Information -->
    <v-row>
      <v-col cols="12" md="6">
        <v-card class="mb-4">
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-star</v-icon>
            {{ t('home.rating_and_reviews') }}
          </v-card-title>
          <v-card-text>
            <div v-if="result.rating" class="mb-3">
              <div class="text-caption text-grey-darken-1">{{ t('home.rating') }}</div>
              <div class="d-flex align-center">
                <v-rating
                  :model-value="result.rating"
                  :length="5"
                  size="large"
                  readonly
                  half-increments
                  color="amber"
                />
                <span class="ml-3 text-h6">{{ result.rating }}/5</span>
              </div>
            </div>
            
            <div v-if="result.review_count" class="mb-3">
              <div class="text-caption text-grey-darken-1">{{ t('home.review_count') }}</div>
              <div class="text-body-2">{{ result.review_count }} reviews</div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card class="mb-4">
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-clock</v-icon>
            {{ t('home.business_hours') }}
          </v-card-title>
          <v-card-text>
            <div v-if="result.business_hours" class="mb-3">
              <div class="text-caption text-grey-darken-1">{{ t('home.hours') }}</div>
              <div class="text-body-2">
                <pre class="text-body-2" style="white-space: pre-wrap; font-family: inherit;">{{ typeof result.business_hours === 'string' ? formatBusinessHours(result.business_hours) : JSON.stringify(result.business_hours, null, 2) }}</pre>
              </div>
            </div>
            <div v-else class="text-body-2 text-grey-darken-1">
              {{ t('home.no_hours_available') }}
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Social Media and Additional Details -->
    <v-row v-if="hasAdditionalInfo">
      <v-col cols="12">
        <v-card class="mb-4">
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-information</v-icon>
            {{ t('home.additional_details') }}
          </v-card-title>
          <v-card-text>
            <v-row>
              <v-col cols="12" md="6" v-if="result.social_media">
                <div class="mb-3">
                  <div class="text-caption text-grey-darken-1">{{ t('home.social_media') }}</div>
                  <div class="d-flex flex-wrap">
                    <v-chip
                      v-for="social in Array.isArray(result.social_media) ? result.social_media : [result.social_media]"
                      :key="social"
                      size="small"
                      color="info"
                      variant="outlined"
                      class="mr-1 mb-1"
                    >
                      {{ social }}
                    </v-chip>
                  </div>
                </div>
              </v-col>
              
              <v-col cols="12" md="6" v-if="result.payment_methods">
                <div class="mb-3">
                  <div class="text-caption text-grey-darken-1">{{ t('home.payment_methods') }}</div>
                  <div class="d-flex flex-wrap">
                    <v-chip
                      v-for="method in Array.isArray(result.payment_methods) ? result.payment_methods : [result.payment_methods]"
                      :key="method"
                      size="small"
                      color="success"
                      variant="outlined"
                      class="mr-1 mb-1"
                    >
                      {{ method }}
                    </v-chip>
                  </div>
                </div>
              </v-col>
            </v-row>
            

          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Scraping Information -->
    <v-row>
      <v-col cols="12">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-database</v-icon>
            {{ t('home.scraping_information') }}
          </v-card-title>
          <v-card-text>
            <v-row>
              <v-col cols="12" md="4">
                <div class="mb-3">
                  <div class="text-caption text-grey-darken-1">{{ t('home.platform') }}</div>
                  <div class="text-body-2">{{ result.platform }}</div>
                </div>
              </v-col>
              <v-col cols="12" md="4">
                <div class="mb-3">
                  <div class="text-caption text-grey-darken-1">{{ t('home.scraped_at') }}</div>
                  <div class="text-body-2">{{ formatDate(result.scraped_at) }}</div>
                </div>
              </v-col>
              <v-col cols="12" md="4">
                <div class="mb-3">
                  <div class="text-caption text-grey-darken-1">{{ t('home.task_id') }}</div>
                  <div class="text-body-2">{{ result.task_id }}</div>
                </div>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Action Buttons -->
    <v-row class="mt-4">
      <v-col cols="12" class="d-flex justify-end">
        <v-btn
          color="primary"
          variant="outlined"
          @click="$emit('close')"
        >
          {{ t('home.close') }}
        </v-btn>
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { YellowPagesResult } from '@/interfaces/ITaskManager'

// Props
interface Props {
  result: YellowPagesResult
}

const props = defineProps<Props>()

// Emits
const emit = defineEmits<{
  'close': []
}>()

// i18n
const { t } = useI18n()

// Computed properties
const hasAddress = computed(() => {
  return !!(props.result.address?.street || props.result.address?.city || props.result.address?.state || props.result.address?.zip || props.result.address?.country)
})

const hasAdditionalInfo = computed(() => {
  return !!(props.result.social_media || props.result.payment_methods)
})

// Methods
const parseCategories = (categories: string): string[] => {
  try {
    const parsed = JSON.parse(categories)
    return Array.isArray(parsed) ? parsed : [categories]
  } catch (e) {
    return [categories]
  }
}

const parseArrayField = (field: string): string[] => {
  try {
    const parsed = JSON.parse(field)
    return Array.isArray(parsed) ? parsed : [field]
  } catch (e) {
    return [field]
  }
}

const formatBusinessHours = (hours: string): string => {
  try {
    const parsed = JSON.parse(hours)
    if (typeof parsed === 'object') {
      return Object.entries(parsed)
        .map(([day, time]) => `${day}: ${time}`)
        .join('\n')
    }
    return hours
  } catch (e) {
    return hours
  }
}



const formatDate = (date: string | Date): string => {
  if (!date) return 'N/A'
  return new Date(date).toLocaleString()
}

const copyToClipboard = async (text: string, type: string) => {
  try {
    await navigator.clipboard.writeText(text)
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

const openWebsite = (url: string) => {
  if (url) {
    window.open(url, '_blank')
  }
}
</script>

<style scoped>
.v-card {
  border-radius: 8px;
}

.v-card-title {
  min-height: auto;
  padding: 16px 20px 8px 20px;
}

.v-card-text {
  padding: 0 20px 20px 20px;
}

/* Responsive improvements */
@media (max-width: 960px) {
  .v-card-title {
    padding: 16px 16px 8px 16px;
  }
  
  .v-card-text {
    padding: 0 16px 16px 16px;
  }
}

@media (max-width: 600px) {
  .v-card-title {
    padding: 12px 12px 6px 12px;
  }
  
  .v-card-text {
    padding: 0 12px 12px 12px;
  }
}
</style>


