<template>
  <v-container fluid class="dashboard-home pa-4">
    <!-- Page Header -->
    <v-row>
      <v-col cols="12">
        <div class="d-flex align-center mb-4">
          <v-icon size="32" color="primary" class="mr-3">mdi-view-dashboard</v-icon>
          <h1 class="text-h4 font-weight-bold">Dashboard</h1>
          <v-spacer></v-spacer>
          <v-btn
            icon
            variant="text"
            @click="handleManualRefresh"
            :loading="isRefreshing"
            title="Refresh Dashboard"
            aria-label="Refresh dashboard data"
          >
            <v-icon>mdi-refresh</v-icon>
          </v-btn>
        </div>
      </v-col>
    </v-row>

    <!-- Date Range Filter -->
    <v-row>
      <v-col cols="12">
        <DashboardDateRangeFilter
          @date-range-changed="handleDateRangeChange"
          aria-label="Date range filter for dashboard data"
        />
        <v-progress-linear
          v-if="isDebouncing"
          indeterminate
          color="primary"
          class="mt-2"
          height="2"
          aria-label="Updating data"
        ></v-progress-linear>
      </v-col>
    </v-row>

    <!-- Summary Cards -->
    <v-row class="mt-4" role="region" aria-label="Dashboard summary statistics">
      <v-col cols="12">
        <DashboardSummaryCards
          :data="summaryData"
          :loading="isSummaryLoading"
          @card-clicked="handleCardClick"
        />
      </v-col>
    </v-row>

    <!-- Charts Section -->
    <div ref="chartsSection">
      <v-row class="mt-6" role="region" aria-label="Analytics and trend charts">
        <v-col cols="12">
          <h2 class="text-h5 font-weight-bold mb-4">Analytics & Trends</h2>
        </v-col>

        <!-- Trends Line Chart -->
        <v-col cols="12" md="6">
          <DashboardTrendsChart
            :data="trendsData"
            :loading="isChartsLoading"
            :error="chartsError"
            @refresh="refreshCharts"
          />
        </v-col>

        <!-- Activity Area Chart -->
        <v-col cols="12" md="6">
          <DashboardActivityChart
            :data="trendsData"
            :loading="isChartsLoading"
            :error="chartsError"
            @refresh="refreshCharts"
          />
        </v-col>

        <!-- Search Engine Bar Chart -->
        <v-col cols="12" md="6">
          <DashboardSearchEngineChart
            :data="searchEngineData"
            :loading="isChartsLoading"
            :error="chartsError"
            @refresh="refreshCharts"
            @engine-clicked="handleEngineClick"
          />
        </v-col>

        <!-- Email Status Pie Chart -->
        <v-col cols="12" md="6">
          <DashboardEmailStatusChart
            :data="emailStatusData"
            :loading="isChartsLoading"
            :error="chartsError"
            @refresh="refreshCharts"
          />
        </v-col>
      </v-row>
    </div>

    <!-- Global Error Snackbar -->
    <v-snackbar
      v-model="showErrorSnackbar"
      color="error"
      timeout="5000"
      location="top"
    >
      {{ errorMessage }}
      <template v-slot:actions>
        <v-btn color="white" variant="text" @click="showErrorSnackbar = false">
          Close
        </v-btn>
      </template>
    </v-snackbar>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import DashboardDateRangeFilter from './components/DashboardDateRangeFilter.vue';
import DashboardSummaryCards from './components/DashboardSummaryCards.vue';
import DashboardTrendsChart from './components/DashboardTrendsChart.vue';
import DashboardSearchEngineChart from './components/DashboardSearchEngineChart.vue';
import DashboardEmailStatusChart from './components/DashboardEmailStatusChart.vue';
import DashboardActivityChart from './components/DashboardActivityChart.vue';
import {
  getDashboardSummary,
  getDashboardTrends,
  getSearchEngineBreakdown,
  getEmailStatusBreakdown
} from '@/views/api/dashboard';
import type {
  DashboardSummary,
  TrendData,
  SearchEngineBreakdown,
  EmailStatusBreakdown
} from '@/entityTypes/dashboardType';

// Performance monitoring
const performanceMarks = {
  pageLoadStart: 0,
  summaryDataLoad: 0,
  chartsDataLoad: 0
};

// Router
const router = useRouter();

// State - Summary
const summaryData = ref<DashboardSummary | null>(null);
const isSummaryLoading = ref(false);

// State - Charts
const trendsData = ref<TrendData | null>(null);
const searchEngineData = ref<SearchEngineBreakdown | null>(null);
const emailStatusData = ref<EmailStatusBreakdown | null>(null);
const isChartsLoading = ref(false);
const chartsError = ref<string | null>(null);
const chartsVisible = ref(false);

// State - Date Range
const currentStartDate = ref<string>('');
const currentEndDate = ref<string>('');

// State - UI
const isRefreshing = ref(false);
const showErrorSnackbar = ref(false);
const errorMessage = ref('');
const isDebouncing = ref(false);

// Refs
const chartsSection = ref<HTMLElement | null>(null);

// Debounce timer
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// Cache management
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const summaryCache = ref<Record<string, CacheEntry<DashboardSummary>>>({});
const chartsCache = ref<Record<string, CacheEntry<{
  trends: TrendData;
  searchEngine: SearchEngineBreakdown;
  emailStatus: EmailStatusBreakdown;
}>>>({});

// Intersection Observer for lazy loading
let chartsObserver: IntersectionObserver | null = null;

// Methods
function getCacheKey(startDate: string, endDate: string): string {
  return `${startDate}_${endDate}`;
}

function isCacheValid<T>(cache: CacheEntry<T> | undefined): boolean {
  if (!cache) return false;
  return Date.now() - cache.timestamp < CACHE_DURATION;
}

async function fetchSummaryData(startDate: string, endDate: string, bypassCache = false) {
  const cacheKey = getCacheKey(startDate, endDate);
  
  // Performance monitoring
  const startTime = performance.now();
  
  // Check cache
  if (!bypassCache && isCacheValid(summaryCache.value[cacheKey])) {
    summaryData.value = summaryCache.value[cacheKey].data;
    const loadTime = performance.now() - startTime;
    console.log(`[Dashboard] Summary data loaded from cache in ${loadTime.toFixed(2)}ms`);
    return;
  }

  isSummaryLoading.value = true;
  
  try {
    const response = await getDashboardSummary(startDate, endDate);
    
    if (response) {
      summaryData.value = response;
      
      // Update cache
      summaryCache.value[cacheKey] = {
        data: response,
        timestamp: Date.now()
      };
      
      // Performance logging
      const loadTime = performance.now() - startTime;
      performanceMarks.summaryDataLoad = loadTime;
      console.log(`[Dashboard] Summary data loaded in ${loadTime.toFixed(2)}ms`);
      
      // Verify performance target (< 2s)
      if (loadTime > 2000) {
        console.warn(`[Dashboard] Summary load time (${loadTime.toFixed(2)}ms) exceeds 2s target`);
      }
    } else {
      throw new Error('Failed to load summary data');
    }
  } catch (error) {
    console.error('Error fetching summary data:', error);
    errorMessage.value = error instanceof Error ? error.message : 'Failed to load dashboard data';
    showErrorSnackbar.value = true;
    
    // Log error for debugging
    if (error instanceof Error) {
      console.error('[Dashboard] Error details:', {
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
    }
  } finally {
    isSummaryLoading.value = false;
  }
}

async function fetchChartsData(startDate: string, endDate: string, bypassCache = false) {
  const cacheKey = getCacheKey(startDate, endDate);
  
  // Performance monitoring
  const startTime = performance.now();
  
  // Check cache
  if (!bypassCache && isCacheValid(chartsCache.value[cacheKey])) {
    const cached = chartsCache.value[cacheKey].data;
    trendsData.value = cached.trends;
    searchEngineData.value = cached.searchEngine;
    emailStatusData.value = cached.emailStatus;
    const loadTime = performance.now() - startTime;
    console.log(`[Dashboard] Charts data loaded from cache in ${loadTime.toFixed(2)}ms`);
    return;
  }

  isChartsLoading.value = true;
  chartsError.value = null;
  
  try {
    // Fetch all chart data in parallel
    const [trendsResponse, searchEngineResponse, emailStatusResponse] = await Promise.all([
      getDashboardTrends(startDate, endDate),
      getSearchEngineBreakdown(startDate, endDate),
      getEmailStatusBreakdown(startDate, endDate)
    ]);

    if (trendsResponse) {
      trendsData.value = trendsResponse;
    } else {
      throw new Error('Failed to load trends data');
    }

    if (searchEngineResponse) {
      searchEngineData.value = searchEngineResponse;
    } else {
      throw new Error('Failed to load search engine data');
    }

    if (emailStatusResponse) {
      emailStatusData.value = emailStatusResponse;
    } else {
      throw new Error('Failed to load email status data');
    }

    // Update cache
    chartsCache.value[cacheKey] = {
      data: {
        trends: trendsData.value,
        searchEngine: searchEngineData.value,
        emailStatus: emailStatusData.value
      },
      timestamp: Date.now()
    };
    
    // Performance logging
    const loadTime = performance.now() - startTime;
    performanceMarks.chartsDataLoad = loadTime;
    console.log(`[Dashboard] Charts data loaded in ${loadTime.toFixed(2)}ms`);
    
    // Verify performance target (< 500ms)
    if (loadTime > 500) {
      console.warn(`[Dashboard] Charts load time (${loadTime.toFixed(2)}ms) exceeds 500ms target`);
    }
  } catch (error) {
    console.error('Error fetching charts data:', error);
    chartsError.value = error instanceof Error ? error.message : 'Failed to load chart data';
    
    // Log error for debugging
    if (error instanceof Error) {
      console.error('[Dashboard] Charts error details:', {
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
    }
  } finally {
    isChartsLoading.value = false;
  }
}

function handleDateRangeChange(payload: { startDate: string; endDate: string; preset: string }) {
  // Clear any existing debounce timer
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  
  // Show debouncing indicator
  isDebouncing.value = true;
  
  // Debounce the actual data fetch by 300ms
  debounceTimer = setTimeout(() => {
    currentStartDate.value = payload.startDate;
    currentEndDate.value = payload.endDate;
    
    // Clear cache when date range changes
    summaryCache.value = {};
    chartsCache.value = {};
    
    // Fetch new data
    fetchSummaryData(payload.startDate, payload.endDate);
    
    // Only fetch charts if they're visible
    if (chartsVisible.value) {
      fetchChartsData(payload.startDate, payload.endDate);
    }
    
    // Hide debouncing indicator
    isDebouncing.value = false;
    debounceTimer = null;
  }, 300);
}

async function handleManualRefresh() {
  if (!currentStartDate.value || !currentEndDate.value) return;
  
  isRefreshing.value = true;
  
  try {
    await Promise.all([
      fetchSummaryData(currentStartDate.value, currentEndDate.value, true),
      chartsVisible.value ? fetchChartsData(currentStartDate.value, currentEndDate.value, true) : Promise.resolve()
    ]);
  } finally {
    isRefreshing.value = false;
  }
}

function refreshCharts() {
  if (currentStartDate.value && currentEndDate.value) {
    fetchChartsData(currentStartDate.value, currentEndDate.value, true);
  }
}

function handleCardClick(metricType: string) {
  // Navigate to respective detail pages
  switch (metricType) {
    case 'search':
      router.push('/search-results');
      break;
    case 'emails':
      router.push('/email-extraction');
      break;
    case 'yellowpages':
      router.push('/yellow-pages');
      break;
    case 'emailssent':
      router.push('/email-marketing');
      break;
  }
}

function handleEngineClick(engineName: string) {
  console.log('Engine clicked:', engineName);
  // Navigate to search results filtered by engine
  router.push({ path: '/search-results', query: { engine: engineName } });
}

function setupIntersectionObserver() {
  if (!chartsSection.value) return;
  
  chartsObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !chartsVisible.value) {
          chartsVisible.value = true;
          
          // Fetch charts data when section becomes visible
          if (currentStartDate.value && currentEndDate.value) {
            fetchChartsData(currentStartDate.value, currentEndDate.value);
          }
          
          // Stop observing after first intersection
          if (chartsObserver) {
            chartsObserver.disconnect();
          }
        }
      });
    },
    {
      threshold: 0.1 // Trigger when 10% of the element is visible
    }
  );

  chartsObserver.observe(chartsSection.value);
}

// Lifecycle
onMounted(() => {
  // Performance monitoring - mark page load start
  performanceMarks.pageLoadStart = performance.now();
  
  setupIntersectionObserver();
  
  // Log total page load time after initial data load
  setTimeout(() => {
    const totalLoadTime = performance.now() - performanceMarks.pageLoadStart;
    console.log(`[Dashboard] Total page load time: ${totalLoadTime.toFixed(2)}ms`);
    console.log(`[Dashboard] Performance Summary:`, {
      summaryLoad: `${performanceMarks.summaryDataLoad.toFixed(2)}ms`,
      chartsLoad: `${performanceMarks.chartsDataLoad.toFixed(2)}ms`,
      totalLoad: `${totalLoadTime.toFixed(2)}ms`
    });
    
    // Verify performance targets
    if (totalLoadTime > 2000) {
      console.warn(`[Dashboard] Total load time (${totalLoadTime.toFixed(2)}ms) exceeds 2s target`);
    }
  }, 100);
});

onUnmounted(() => {
  // Cleanup
  if (chartsObserver) {
    chartsObserver.disconnect();
  }
  
  // Clear debounce timer
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
});
</script>

<style scoped>
.dashboard-home {
  background-color: #f5f5f5;
  min-height: 100vh;
}

:deep(.v-theme--dark) .dashboard-home {
  background-color: #121212;
}
</style>
