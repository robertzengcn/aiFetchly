<template>
  <v-card class="chart-card" elevation="2">
    <v-card-title class="d-flex align-center">
      <v-icon class="mr-2" color="success">mdi-chart-areaspline</v-icon>
      <span>{{ translations.activityOverview }}</span>
      <v-spacer></v-spacer>
      <v-btn v-if="!loading && !error" icon size="small" variant="text" @click="refreshData">
        <v-icon>mdi-refresh</v-icon>
      </v-btn>
    </v-card-title>
    
    <v-card-text>
      <div v-if="loading" class="chart-skeleton">
        <v-skeleton-loader type="image" height="400"></v-skeleton-loader>
      </div>
      
      <div v-else-if="error" class="error-state text-center py-8">
        <v-icon size="64" color="error">mdi-alert-circle-outline</v-icon>
        <div class="text-h6 mt-4">{{ translations.unableToLoadChart }}</div>
        <div class="text-body-2 text-medium-emphasis mt-2">{{ error }}</div>
        <v-btn color="primary" class="mt-4" @click="refreshData">
          {{ translations.retry }}
        </v-btn>
      </div>
      
      <div v-else-if="!hasData" class="empty-state text-center py-8">
        <v-icon size="64" color="grey">mdi-chart-areaspline-variant</v-icon>
        <div class="text-h6 mt-4">{{ translations.noActivityDataAvailable }}</div>
        <div class="text-body-2 text-medium-emphasis mt-2">{{ translations.noDataFoundForPeriod }}</div>
      </div>
      
      <div v-else class="chart-container">
        <apexchart
          type="area"
          height="400"
          :options="chartOptions"
          :series="chartSeries"
        ></apexchart>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import VueApexCharts from 'vue3-apexcharts';
import type { TrendData } from '@/entityTypes/dashboardType';
import { useTheme } from 'vuetify';

const apexchart = VueApexCharts;

// i18n
const { t } = useI18n();

// Computed translations
const translations = computed(() => ({
  activityOverview: t('home.activity_overview'),
  searchResults: t('home.search_results'),
  emailsExtracted: t('home.emails_extracted'),
  yellowPages: t('home.yellow_pages'),
  emailsSent: t('home.emails_sent'),
  retry: t('home.retry'),
  unableToLoadChart: t('home.unable_to_load_chart'),
  noActivityDataAvailable: t('home.no_activity_data_available'),
  noDataFoundForPeriod: t('home.no_data_found_for_period'),
  totalCount: t('home.total_count')
}));

// Props
interface Props {
  data?: TrendData | null;
  loading?: boolean;
  error?: string | null;
}

const props = withDefaults(defineProps<Props>(), {
  data: null,
  loading: false,
  error: null
});

// Emit events
const emit = defineEmits<{
  (e: 'refresh'): void;
}>();

// Theme
const theme = useTheme();

// Computed
const hasData = computed(() => {
  return props.data && props.data.dates.length > 0;
});

const chartSeries = computed(() => {
  if (!props.data) return [];
  
  return [
    {
      name: translations.value.searchResults,
      data: props.data.searchResults
    },
    {
      name: translations.value.emailsExtracted,
      data: props.data.emailsExtracted
    },
    {
      name: translations.value.yellowPages,
      data: props.data.yellowPagesResults
    },
    {
      name: translations.value.emailsSent,
      data: props.data.emailsSent
    }
  ];
});

const chartOptions = computed(() => ({
  chart: {
    type: 'area',
    height: 400,
    stacked: true,
    toolbar: {
      show: true
    },
    animations: {
      enabled: true,
      easing: 'easeinout',
      speed: 800
    }
  },
  colors: ['#1976D2', '#4CAF50', '#FFC107', '#00BCD4'], // Blue, Green, Yellow, Cyan
  dataLabels: {
    enabled: false
  },
  stroke: {
    curve: 'smooth',
    width: 2
  },
  fill: {
    type: 'gradient',
    gradient: {
      opacityFrom: 0.6,
      opacityTo: 0.1,
      stops: [0, 100]
    }
  },
  xaxis: {
    categories: props.data?.dates || [],
    labels: {
      rotate: -45,
      rotateAlways: false,
      style: {
        colors: theme.current.value.dark ? '#FFFFFF' : '#000000'
      }
    }
  },
  yaxis: {
    title: {
      text: translations.value.totalCount,
      style: {
        color: theme.current.value.dark ? '#FFFFFF' : '#000000'
      }
    },
    labels: {
      formatter: (val: number) => val.toLocaleString(),
      style: {
        colors: theme.current.value.dark ? '#FFFFFF' : '#000000'
      }
    }
  },
  legend: {
    position: 'top',
    horizontalAlign: 'center',
    labels: {
      colors: theme.current.value.dark ? '#FFFFFF' : '#000000'
    }
  },
  tooltip: {
    shared: true,
    intersect: false,
    theme: theme.current.value.dark ? 'dark' : 'light',
    y: {
      formatter: (val: number) => val.toLocaleString()
    }
  },
  grid: {
    borderColor: theme.current.value.dark ? '#404040' : '#e0e0e0'
  },
  responsive: [
    {
      breakpoint: 768,
      options: {
        chart: {
          height: 300
        },
        legend: {
          position: 'bottom'
        }
      }
    }
  ]
}));

// Methods
function refreshData() {
  emit('refresh');
}
</script>

<style scoped>
.chart-card {
  height: 100%;
}

.chart-container {
  min-height: 400px;
}

.chart-skeleton {
  min-height: 400px;
}

.empty-state,
.error-state {
  min-height: 400px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

@media (max-width: 768px) {
  .chart-container,
  .chart-skeleton,
  .empty-state,
  .error-state {
    min-height: 300px;
  }
}
</style>

