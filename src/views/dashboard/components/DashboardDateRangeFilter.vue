<template>
  <v-card class="dashboard-date-filter" elevation="0">
    <v-card-text class="pa-4">
      <!-- Quick Filter Buttons (Desktop/Tablet) -->
      <div class="d-flex flex-wrap align-center mb-3">
        <div class="filter-buttons">
          <v-chip-group
            v-model="selectedPresetIndex"
            mandatory
            selected-class="text-primary"
            @update:model-value="handlePresetChange"
          >
            <v-chip
              v-for="preset in presets"
              :key="preset.value"
              :value="preset.value"
              :class="{ 'v-chip--active': activePreset === preset.value }"
              class="mx-1"
              size="default"
            >
              {{ preset.label }}
            </v-chip>
          </v-chip-group>
        </div>
        
        <v-spacer></v-spacer>
        
        <!-- Custom Date Picker Button (Mobile) -->
        <v-btn
          v-if="isMobile"
          icon
          variant="text"
          @click="showDatePickerDialog = true"
        >
          <v-icon>mdi-calendar</v-icon>
        </v-btn>
      </div>

      <!-- Custom Date Picker (Desktop/Tablet Inline) -->
      <v-expand-transition>
        <div v-if="!isMobile && activePreset === 'custom'" class="custom-date-picker mt-3">
          <v-row dense>
            <v-col cols="12" sm="5">
              <v-text-field
                v-model="customStartDate"
                :label="translations.startDate"
                type="date"
                variant="outlined"
                density="compact"
                hide-details="auto"
                :error-messages="validationError"
              ></v-text-field>
            </v-col>
            <v-col cols="12" sm="5">
              <v-text-field
                v-model="customEndDate"
                :label="translations.endDate"
                type="date"
                variant="outlined"
                density="compact"
                hide-details="auto"
                :error-messages="validationError"
              ></v-text-field>
            </v-col>
            <v-col cols="12" sm="2">
              <v-btn
                color="primary"
                block
                :disabled="!isValidRange"
                @click="applyCustomDateRange"
              >
                {{ translations.apply }}
              </v-btn>
            </v-col>
          </v-row>
        </div>
      </v-expand-transition>

      <!-- Validation Error Alert -->
      <v-alert
        v-if="validationError"
        type="error"
        density="compact"
        class="mt-3"
        closable
        @click:close="validationError = ''"
      >
        {{ validationError }}
      </v-alert>
    </v-card-text>

    <!-- Mobile Date Picker Dialog -->
    <v-dialog
      v-model="showDatePickerDialog"
      :fullscreen="isMobile"
      max-width="500"
    >
      <v-card>
        <v-toolbar color="primary" dark>
          <v-toolbar-title>{{ translations.selectDateRange }}</v-toolbar-title>
          <v-spacer></v-spacer>
          <v-btn icon @click="showDatePickerDialog = false">
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-toolbar>

        <v-card-text class="pa-4">
          <v-text-field
            v-model="customStartDate"
            :label="translations.startDate"
            type="date"
            variant="outlined"
            class="mb-3"
            hide-details
          ></v-text-field>
          
          <v-text-field
            v-model="customEndDate"
            :label="translations.endDate"
            type="date"
            variant="outlined"
            class="mb-3"
            hide-details
          ></v-text-field>

          <v-alert
            v-if="validationError"
            type="error"
            density="compact"
            class="mt-2"
          >
            {{ validationError }}
          </v-alert>
        </v-card-text>

        <v-card-actions class="pa-4">
          <v-btn
            block
            color="grey"
            variant="outlined"
            @click="showDatePickerDialog = false"
            style="min-height: 44px"
          >
            {{ translations.cancel }}
          </v-btn>
          <v-btn
            block
            color="primary"
            :disabled="!isValidRange"
            @click="applyCustomDateRangeMobile"
            style="min-height: 44px"
            class="ml-2"
          >
            {{ translations.apply }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useDisplay } from 'vuetify';
import { useI18n } from 'vue-i18n';
import { getDateRangePreset, formatDateForAPI, validateDateRange } from '@/views/utils/dateUtils';

// i18n
const { t } = useI18n();

// Responsive breakpoints
const { mobile } = useDisplay();
const isMobile = computed(() => mobile.value);

// Computed translations
const translations = computed(() => ({
  last7Days: t('home.last_7_days'),
  last30Days: t('home.last_30_days'),
  last90Days: t('home.last_90_days'),
  last365Days: t('home.last_365_days'),
  allTime: t('home.all_time'),
  custom: t('home.custom'),
  startDate: t('home.start_date'),
  endDate: t('home.end_date'),
  apply: t('home.apply'),
  selectDateRange: t('home.select_date_range'),
  cancel: t('common.cancel')
}));

// Preset options
const presets = computed(() => [
  { label: translations.value.last7Days, value: 'last7' },
  { label: translations.value.last30Days, value: 'last30' },
  { label: translations.value.last90Days, value: 'last90' },
  { label: translations.value.last365Days, value: 'last365' },
  { label: translations.value.allTime, value: 'all' },
  { label: translations.value.custom, value: 'custom' }
]);

// State
const activePreset = ref<string>('last30'); // Default to last 30 days
const selectedPresetIndex = ref('last30');
const customStartDate = ref<string>('');
const customEndDate = ref<string>('');
const validationError = ref<string>('');
const showDatePickerDialog = ref(false);

// Computed
const isValidRange = computed(() => {
  if (!customStartDate.value || !customEndDate.value) {
    return false;
  }
  
  const start = new Date(customStartDate.value);
  const end = new Date(customEndDate.value);
  const validation = validateDateRange(start, end);
  
  return validation.valid;
});

// Emit event
const emit = defineEmits<{
  (e: 'date-range-changed', payload: { startDate: string; endDate: string; preset: string }): void;
}>();

// Methods
function handlePresetChange(value: string) {
  activePreset.value = value;
  validationError.value = '';

  if (value === 'custom') {
    // Switch to custom mode - don't emit yet, wait for user to select dates
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 29);
    
    customStartDate.value = formatDateForAPI(thirtyDaysAgo);
    customEndDate.value = formatDateForAPI(today);
    return;
  }

  // Apply preset immediately
  const { startDate, endDate } = getDateRangePreset(value as 'last7' | 'last30' | 'last90' | 'last365' | 'all');
  
  emit('date-range-changed', {
    startDate: formatDateForAPI(startDate),
    endDate: formatDateForAPI(endDate),
    preset: value
  });
}

function applyCustomDateRange() {
  if (!isValidRange.value) {
    const start = new Date(customStartDate.value);
    const end = new Date(customEndDate.value);
    const validation = validateDateRange(start, end);
    validationError.value = validation.error || 'Invalid date range';
    return;
  }

  validationError.value = '';
  
  emit('date-range-changed', {
    startDate: customStartDate.value,
    endDate: customEndDate.value,
    preset: 'custom'
  });
}

function applyCustomDateRangeMobile() {
  applyCustomDateRange();
  if (isValidRange.value) {
    showDatePickerDialog.value = false;
  }
}

// Watch for manual date changes to update preset
watch([customStartDate, customEndDate], () => {
  if (activePreset.value === 'custom') {
    validationError.value = '';
  }
});

// Initialize with default preset
onMounted(() => {
  handlePresetChange('last30');
});
</script>

<style scoped>
.dashboard-date-filter {
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
}

.filter-buttons {
  flex: 1;
  min-width: 200px;
}

.v-chip {
  min-height: 36px;
}

@media (max-width: 768px) {
  .v-chip {
    min-height: 44px;
    min-width: 44px;
  }
}

.custom-date-picker {
  border-top: 1px solid rgba(0, 0, 0, 0.12);
  padding-top: 16px;
}
</style>

