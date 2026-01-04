<template>
  <v-card class="chart-card" elevation="2">
    <v-card-title class="d-flex align-center">
      <v-icon class="mr-2" color="info">mdi-email-check</v-icon>
      <span>{{ translations.emailStatusDistribution }}</span>
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
        <v-icon size="64" color="grey">mdi-chart-donut</v-icon>
        <div class="text-h6 mt-4">{{ translations.noEmailStatusDataAvailable }}</div>
        <div class="text-body-2 text-medium-emphasis mt-2">{{ translations.noDataFoundForPeriod }}</div>
      </div>
      
      <div v-else class="chart-container">
        <apexchart
          type="donut"
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
import type { EmailStatusBreakdown } from '@/entityTypes/dashboardType';
import { useTheme } from 'vuetify';

const apexchart = VueApexCharts;

// i18n
const { t } = useI18n();

// Computed translations
const translations = computed(() => ({
  emailStatusDistribution: t('home.email_status_distribution'),
  successful: t('home.successful'),
  failed: t('home.failed'),
  pending: t('home.pending'),
  totalEmails: t('home.total_emails'),
  retry: t('home.retry'),
  unableToLoadChart: t('home.unable_to_load_chart'),
  noEmailStatusDataAvailable: t('home.no_email_status_data_available'),
  noDataFoundForPeriod: t('home.no_data_found_for_period')
}));

// Props
interface Props {
  data?: EmailStatusBreakdown | null;
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
  if (!props.data) return false;
  const total = props.data.successful + props.data.failed + props.data.pending;
  return total > 0;
});

const totalEmails = computed(() => {
  if (!props.data) return 0;
  return props.data.successful + props.data.failed + props.data.pending;
});

const chartSeries = computed(() => {
  if (!props.data) return [];
  return [
    props.data.successful,
    props.data.failed,
    props.data.pending
  ];
});

const chartOptions = computed(() => ({
  chart: {
    height: 400
  },
  colors: ['#4CAF50', '#F44336', '#FFC107'], // Green (success), Red (failed), Yellow (pending)
  labels: [translations.value.successful, translations.value.failed, translations.value.pending],
  dataLabels: {
    enabled: true,
    formatter: (val: number) => val.toFixed(1) + '%'
  },
  plotOptions: {
    pie: {
      donut: {
        size: '70%' as const,
        labels: {
          show: true,
          total: {
            show: true,
            label: translations.value.totalEmails,
            fontSize: '16px',
            fontWeight: 600,
            color: theme.current.value.dark ? '#FFFFFF' : '#000000',
            formatter: () => totalEmails.value.toLocaleString()
          },
          value: {
            fontSize: '24px',
            fontWeight: 'bold',
            color: theme.current.value.dark ? '#FFFFFF' : '#000000'
          },
          name: {
            fontSize: '14px',
            color: theme.current.value.dark ? '#AAAAAA' : '#666666'
          }
        }
      }
    }
  },
  legend: {
    position: 'bottom' as const,
    horizontalAlign: 'center' as const,
    labels: {
      colors: theme.current.value.dark ? '#FFFFFF' : '#000000'
    },
    formatter: (seriesName: string, opts: { w: { globals: { series: number[] } }; seriesIndex: number }) => {
      const value = opts.w.globals.series[opts.seriesIndex];
      return `${seriesName}: ${value.toLocaleString()}`;
    }
  },
  tooltip: {
    theme: (theme.current.value.dark ? 'dark' : 'light') as 'dark' | 'light',
    y: {
      formatter: (val: number) => {
        const percent = ((val / totalEmails.value) * 100).toFixed(1);
        return `${val.toLocaleString()} (${percent}%)`;
      }
    }
  },
  responsive: [
    {
      breakpoint: 768,
      options: {
        chart: {
          height: 350
        },
        plotOptions: {
          pie: {
            donut: {
              size: '65%' as const,
              labels: {
                total: {
                  fontSize: '14px'
                },
                value: {
                  fontSize: '20px'
                },
                name: {
                  fontSize: '12px'
                }
              }
            }
          }
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
    min-height: 350px;
  }
}
</style>

