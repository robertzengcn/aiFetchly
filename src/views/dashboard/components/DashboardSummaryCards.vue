<template>
  <v-row>
    <!-- Search Results Card -->
    <v-col cols="12" sm="6" md="3">
      <v-card
        class="summary-card"
        :class="{ 'card-hover': !loading }"
        :elevation="hoverCard === 'search' ? 8 : 2"
        @mouseenter="!loading && (hoverCard = 'search')"
        @mouseleave="hoverCard = null"
        @click="!loading && handleCardClick('search')"
      >
        <v-card-text>
          <div v-if="loading">
            <v-skeleton-loader type="article"></v-skeleton-loader>
          </div>
          <div v-else class="card-content">
            <div class="d-flex align-center mb-2">
              <v-icon color="primary" size="32" class="mr-2">mdi-magnify</v-icon>
              <div class="text-subtitle-2 text-medium-emphasis">{{ translations.searchResults }}</div>
            </div>
            <div class="text-h4 font-weight-bold primary--text mb-2">
              {{ formatNumber(data?.searchResults?.periodCount ?? 0) }}
            </div>
            <div class="d-flex align-center">
              <v-icon
                :color="getTrendColor(data?.searchResults?.trendDirection)"
                size="20"
                class="mr-1"
              >
                {{ getTrendIcon(data?.searchResults?.trendDirection) }}
              </v-icon>
              <span :class="`text-${getTrendColor(data?.searchResults?.trendDirection)}`" class="text-body-2">
                {{ formatTrend(data?.searchResults?.trend) }}
              </span>
              <span class="text-medium-emphasis text-body-2 ml-1">{{ translations.vsPreviousPeriod }}</span>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <!-- Emails Extracted Card -->
    <v-col cols="12" sm="6" md="3">
      <v-card
        class="summary-card"
        :class="{ 'card-hover': !loading }"
        :elevation="hoverCard === 'emails' ? 8 : 2"
        @mouseenter="!loading && (hoverCard = 'emails')"
        @mouseleave="hoverCard = null"
        @click="!loading && handleCardClick('emails')"
      >
        <v-card-text>
          <div v-if="loading">
            <v-skeleton-loader type="article"></v-skeleton-loader>
          </div>
          <div v-else class="card-content">
            <div class="d-flex align-center mb-2">
              <v-icon color="success" size="32" class="mr-2">mdi-email-multiple</v-icon>
              <div class="text-subtitle-2 text-medium-emphasis">{{ translations.emailsExtracted }}</div>
            </div>
            <div class="text-h4 font-weight-bold success--text mb-2">
              {{ formatNumber(data?.emailsExtracted?.periodCount ?? 0) }}
            </div>
            <div class="d-flex align-center">
              <v-icon
                :color="getTrendColor(data?.emailsExtracted?.trendDirection)"
                size="20"
                class="mr-1"
              >
                {{ getTrendIcon(data?.emailsExtracted?.trendDirection) }}
              </v-icon>
              <span :class="`text-${getTrendColor(data?.emailsExtracted?.trendDirection)}`" class="text-body-2">
                {{ formatTrend(data?.emailsExtracted?.trend) }}
              </span>
              <span class="text-medium-emphasis text-body-2 ml-1">{{ translations.vsPreviousPeriod }}</span>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <!-- Yellow Pages Results Card -->
    <v-col cols="12" sm="6" md="3">
      <v-card
        class="summary-card"
        :class="{ 'card-hover': !loading }"
        :elevation="hoverCard === 'yellowpages' ? 8 : 2"
        @mouseenter="!loading && (hoverCard = 'yellowpages')"
        @mouseleave="hoverCard = null"
        @click="!loading && handleCardClick('yellowpages')"
      >
        <v-card-text>
          <div v-if="loading">
            <v-skeleton-loader type="article"></v-skeleton-loader>
          </div>
          <div v-else class="card-content">
            <div class="d-flex align-center mb-2">
              <v-icon color="warning" size="32" class="mr-2">mdi-book-open-page-variant</v-icon>
              <div class="text-subtitle-2 text-medium-emphasis">{{ translations.yellowPages }}</div>
            </div>
            <div class="text-h4 font-weight-bold warning--text mb-2">
              {{ formatNumber(data?.yellowPagesResults?.periodCount ?? 0) }}
            </div>
            <div class="d-flex align-center">
              <v-icon
                :color="getTrendColor(data?.yellowPagesResults?.trendDirection)"
                size="20"
                class="mr-1"
              >
                {{ getTrendIcon(data?.yellowPagesResults?.trendDirection) }}
              </v-icon>
              <span :class="`text-${getTrendColor(data?.yellowPagesResults?.trendDirection)}`" class="text-body-2">
                {{ formatTrend(data?.yellowPagesResults?.trend) }}
              </span>
              <span class="text-medium-emphasis text-body-2 ml-1">{{ translations.vsPreviousPeriod }}</span>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-col>

    <!-- Emails Sent Card -->
    <v-col cols="12" sm="6" md="3">
      <v-card
        class="summary-card"
        :class="{ 'card-hover': !loading }"
        :elevation="hoverCard === 'emailssent' ? 8 : 2"
        @mouseenter="!loading && (hoverCard = 'emailssent')"
        @mouseleave="hoverCard = null"
        @click="!loading && handleCardClick('emailssent')"
      >
        <v-card-text>
          <div v-if="loading">
            <v-skeleton-loader type="article"></v-skeleton-loader>
          </div>
          <div v-else class="card-content">
            <div class="d-flex align-center mb-2">
              <v-icon color="info" size="32" class="mr-2">mdi-email-send</v-icon>
              <div class="text-subtitle-2 text-medium-emphasis">{{ translations.emailsSent }}</div>
            </div>
            <div class="text-h4 font-weight-bold info--text mb-2">
              {{ formatNumber(data?.emailsSent?.periodCount ?? 0) }}
            </div>
            <div class="d-flex align-center mb-2">
              <v-icon
                :color="getTrendColor(data?.emailsSent?.trendDirection)"
                size="20"
                class="mr-1"
              >
                {{ getTrendIcon(data?.emailsSent?.trendDirection) }}
              </v-icon>
              <span :class="`text-${getTrendColor(data?.emailsSent?.trendDirection)}`" class="text-body-2">
                {{ formatTrend(data?.emailsSent?.trend) }}
              </span>
              <span class="text-medium-emphasis text-body-2 ml-1">{{ translations.vsPreviousPeriod }}</span>
            </div>
            <div class="text-caption text-medium-emphasis">
              {{ translations.successRate }}: {{ formatPercentage(data?.emailsSent?.successRate ?? 0) }}
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { DashboardSummary } from '@/entityTypes/dashboardType';

// i18n
const { t } = useI18n();

// Computed translations
const translations = computed(() => ({
  searchResults: t('home.search_results'),
  emailsExtracted: t('home.emails_extracted'),
  yellowPages: t('home.yellow_pages'),
  emailsSent: t('home.emails_sent'),
  vsPreviousPeriod: t('home.vs_previous_period'),
  successRate: t('home.success_rate')
}));

// Props
interface Props {
  data?: DashboardSummary | null;
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  data: null,
  loading: false
});

// State
const hoverCard = ref<string | null>(null);

// Emit events
const emit = defineEmits<{
  (e: 'card-clicked', metricType: string): void;
}>();

// Methods
function handleCardClick(metricType: string) {
  emit('card-clicked', metricType);
}

function formatNumber(num: number): string {
  if (num === undefined || num === null) return '0';
  return num.toLocaleString();
}

function formatTrend(trend: number | undefined): string {
  if (trend === undefined || trend === null) return 'N/A';
  return `${trend.toFixed(1)}%`;
}

function formatPercentage(percent: number): string {
  if (percent === undefined || percent === null) return '0%';
  return `${percent.toFixed(1)}%`;
}

function getTrendColor(direction: 'up' | 'down' | 'neutral' | undefined): string {
  if (!direction) return 'grey';
  switch (direction) {
    case 'up':
      return 'success';
    case 'down':
      return 'error';
    case 'neutral':
    default:
      return 'grey';
  }
}

function getTrendIcon(direction: 'up' | 'down' | 'neutral' | undefined): string {
  if (!direction) return 'mdi-minus';
  switch (direction) {
    case 'up':
      return 'mdi-trending-up';
    case 'down':
      return 'mdi-trending-down';
    case 'neutral':
    default:
      return 'mdi-minus';
  }
}
</script>

<style scoped>
.summary-card {
  cursor: pointer;
  transition: all 0.3s ease;
  min-height: 140px;
}

.card-hover:hover {
  transform: translateY(-4px);
}

.card-content {
  min-height: 120px;
}

@media (max-width: 768px) {
  .summary-card {
    min-height: 120px;
  }
  
  .card-content {
    min-height: 100px;
  }
  
  .text-h4 {
    font-size: 1.75rem !important;
  }
}
</style>

