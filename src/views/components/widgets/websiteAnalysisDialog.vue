<template>
  <v-dialog
    :modelValue="showDialog"
    max-width="600"
    persistent
    @keydown.esc="closeDialog"
  >
    <v-card>
      <v-card-title class="d-flex justify-space-between align-center">
        <span>{{ CapitalizeFirstLetter(t('websiteAnalysis.dialog_title')) }}</span>
        <v-btn
          icon="mdi-close"
          variant="text"
          color="on-surface"
          :disabled="loading"
          @click="closeDialog"
        />
      </v-card-title>

      <v-card-text class="pt-4">
        <div v-if="itemCount > 1" class="mb-4">
          <v-alert type="info" variant="tonal" density="compact">
            {{ t('websiteAnalysis.analyzing_multiple', { itemCount }) || `Analyzing ${itemCount} selected items` }}
          </v-alert>
          <v-progress-linear
            v-if="loading && progress.total > 0"
            :model-value="(progress.current / progress.total) * 100"
            color="primary"
            height="8"
            class="mt-2"
          >
            <template v-slot:default>
              <strong>{{ progress.current }} / {{ progress.total }}</strong>
            </template>
          </v-progress-linear>
        </div>
        <v-textarea
          v-model="businessInfo"
          :label="CapitalizeFirstLetter(t('websiteAnalysis.business_info_label'))"
          :placeholder="t('websiteAnalysis.business_info_placeholder')"
          rows="5"
          variant="outlined"
          :disabled="loading"
          :rules="[rules.required]"
          class="mb-4"
        />

        <v-text-field
          v-model.number="temperature"
          :label="CapitalizeFirstLetter(t('websiteAnalysis.temperature_label'))"
          type="number"
          min="0"
          max="2"
          step="0.1"
          variant="outlined"
          :disabled="loading"
          :rules="[rules.temperature]"
          class="mb-4"
        />

        <v-checkbox
          v-model="saveForFuture"
          :label="CapitalizeFirstLetter(t('websiteAnalysis.save_for_future'))"
          :disabled="loading"
          class="mb-2"
        />
      </v-card-text>

      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn
          @click="closeDialog"
          variant="outlined"
          color="primary"
          :disabled="loading"
        >
          {{ CapitalizeFirstLetter(t('common.cancel')) }}
        </v-btn>
        <v-btn
          @click="handleAnalyze"
          color="primary"
          :loading="loading"
          :disabled="loading || !isValid"
        >
          {{ CapitalizeFirstLetter(t('websiteAnalysis.analyze_button')) }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { CapitalizeFirstLetter } from '@/views/utils/function';
import { getSystemSettinglist, updateSystemSetting } from '@/views/api/systemsetting';
import { ai_website_analysis_business_info } from '@/config/settinggroupInit';

const { t } = useI18n({ inheritLocale: true });

interface Props {
  showDialog: boolean;
  loading?: boolean;
  itemCount?: number;
  progress?: { current: number; total: number };
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  itemCount: 1,
  progress: () => ({ current: 0, total: 0 })
});

const emit = defineEmits<{
  (e: 'dialogclose'): void;
  (e: 'analyze', data: { businessInfo: string; temperature: number; saveForFuture: boolean }): void;
}>();

const businessInfo = ref('');
const temperature = ref(0.7);
const saveForFuture = ref(false);

const rules = {
  required: (value: string) => {
    if (!value || value.trim().length === 0) {
      return t('websiteAnalysis.business_info_required') || 'Business information is required';
    }
    return true;
  },
  temperature: (value: number) => {
    if (value < 0 || value > 2) {
      return t('websiteAnalysis.temperature_range_error') || 'Temperature must be between 0 and 2';
    }
    return true;
  }
};

const isValid = computed(() => {
  return businessInfo.value.trim().length > 0 && 
         temperature.value >= 0 && 
         temperature.value <= 2;
});

/**
 * Load saved business information from system settings
 */
async function loadSavedBusinessInfo(): Promise<void> {
  try {
    const settingsGroups = await getSystemSettinglist();
    
    // Find the setting in user_preferences group
    for (const group of settingsGroups) {
      if (group.name === 'user_preferences') {
        const businessInfoSetting = group.items.find(s => s.key === ai_website_analysis_business_info);
        
        if (businessInfoSetting && businessInfoSetting.value) {
          try {
            const savedData = JSON.parse(businessInfoSetting.value);
            if (savedData.business) {
              businessInfo.value = savedData.business;
            }
            if (savedData.temperature !== undefined) {
              temperature.value = savedData.temperature;
            }
          } catch (error) {
            console.error('Error parsing saved business info:', error);
          }
        }
        break;
      }
    }
  } catch (error) {
    console.error('Error loading saved business info:', error);
  }
}

/**
 * Save business information to system settings
 */
async function saveBusinessInfo(): Promise<void> {
  if (!saveForFuture.value) {
    return;
  }

  try {
    const settingsGroups = await getSystemSettinglist();
    
    // Find the setting in user_preferences group
    for (const group of settingsGroups) {
      if (group.name === 'user_preferences') {
        const businessInfoSetting = group.items.find(s => s.key === ai_website_analysis_business_info);
        
        if (businessInfoSetting) {
          const dataToSave = {
            business: businessInfo.value.trim(),
            temperature: temperature.value
          };
          
          await updateSystemSetting(businessInfoSetting.id, JSON.stringify(dataToSave));
        }
        break;
      }
    }
  } catch (error) {
    console.error('Error saving business info:', error);
  }
}

function closeDialog(): void {
  if (!props.loading) {
    emit('dialogclose');
  }
}

function handleAnalyze(): void {
  if (!isValid.value || props.loading) {
    return;
  }

  emit('analyze', {
    businessInfo: businessInfo.value.trim(),
    temperature: temperature.value,
    saveForFuture: saveForFuture.value
  });
}

// Load saved info when dialog opens
watch(() => props.showDialog, (newVal) => {
  if (newVal) {
    loadSavedBusinessInfo();
  }
});

onMounted(() => {
  if (props.showDialog) {
    loadSavedBusinessInfo();
  }
});
</script>

<style scoped>
.v-card {
  transition: all 0.3s ease;
}
</style>

