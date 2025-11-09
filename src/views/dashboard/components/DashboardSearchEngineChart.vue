<template>
  <v-card class="chart-card" elevation="2">
    <v-card-title class="d-flex align-center">
      <v-icon class="mr-2" color="primary">mdi-search-web</v-icon>
      <span>{{ translations.searchEngineBreakdown }}</span>
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
        <v-icon size="64" color="grey">mdi-chart-bar</v-icon>
        <div class="text-h6 mt-4">{{ translations.noSearchEngineDataAvailable }}</div>
        <div class="text-body-2 text-medium-emphasis mt-2">{{ translations.noDataFoundForPeriod }}</div>
      </div>
      
      <div v-else class="chart-container">
        <apexchart
          type="bar"
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
import type { SearchEngineBreakdown } from '@/entityTypes/dashboardType';
import { useTheme } from 'vuetify';

const apexchart = VueApexCharts;

// i18n
const { t } = useI18n();

// Computed translations
const translations = computed(() => ({
  searchEngineBreakdown: t('home.search_engine_breakdown'),
  retry: t('home.retry'),
  unableToLoadChart: t('home.unable_to_load_chart'),
  noSearchEngineDataAvailable: t('home.no_search_engine_data_available'),
  noDataFoundForPeriod: t('home.no_data_found_for_period'),
  count: t('home.count'),
  results: t('home.results')
}));

// Props
interface Props {
  data?: SearchEngineBreakdown | null;
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
  (e: 'engine-clicked', engineName: string): void;
}>();

// Theme
const theme = useTheme();

// Computed
const hasData = computed(() => {
  return props.data && props.data.engines.length > 0;
});

const chartSeries = computed(() => {
  if (!props.data || !props.data.engines.length) return [];
  
  return [{
    name: translations.value.results,
    data: props.data.engines.map(e => e.count)
  }];
});

const chartOptions = computed(() => ({
  chart: {
    type: 'bar',
    height: 400,
    toolbar: {
      show: true
    },
    events: {
      dataPointSelection: (event: unknown, chartContext: unknown, config: { dataPointIndex: number }) => {
        if (props.data && props.data.engines[config.dataPointIndex]) {
          const engineName = props.data.engines[config.dataPointIndex].name;
          emit('engine-clicked', engineName);
        }
      }
    }
  },
  colors: ['#1976D2', '#4CAF50', '#FFC107', '#00BCD4', '#FF5722', '#9C27B0', '#795548'],
  plotOptions: {
    bar: {
      borderRadius: 4,
      horizontal: false,
      distributed: true,
      dataLabels: {
        position: 'top'
      }
    }
  },
  dataLabels: {
    enabled: true,
    formatter: (val: number) => val.toLocaleString(),
    offsetY: -20,
    style: {
      fontSize: '12px',
      colors: [theme.current.value.dark ? '#FFFFFF' : '#000000']
    }
  },
  xaxis: {
    categories: props.data?.engines.map(e => e.name) || [],
    labels: {
      style: {
        colors: theme.current.value.dark ? '#FFFFFF' : '#000000'
      }
    }
  },
  yaxis: {
    title: {
      text: translations.value.count,
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
    show: false
  },
  tooltip: {
    theme: theme.current.value.dark ? 'dark' : 'light',
    y: {
      formatter: (val: number) => val.toLocaleString() + ' ' + translations.value.results
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
        plotOptions: {
          bar: {
            horizontal: true
          }
        },
        dataLabels: {
          offsetY: 0,
          offsetX: -6
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

