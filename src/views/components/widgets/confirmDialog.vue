<template>
  <v-dialog
    :modelValue="showDialog"
    max-width="400"
    persistent
    @keydown.esc="closeDialog"
    @keydown.enter="okCallback"
      >
    <v-card
      :prepend-icon="dialogIcon"
      :text="noticeText"
      :title="noticeTitle"
      class="confirm-dialog"
    >
        <template #append>
          <v-btn
            icon="mdi-close"
            variant="text"
            color="on-surface"
            :disabled="loading"
            @click="closeDialog"
          />
        </template>

      <template v-slot:prepend>
        <v-icon
          :icon="dialogIcon"
          :color="dialogColor"
          size="large"
        ></v-icon>
      </template>

      <v-card-text class="pt-4">
        <div class="text-body-1">{{ noticeText }}</div>
        <div v-if="additionalInfo" class="text-caption text-medium-emphasis mt-2">
          {{ additionalInfo }}
        </div>
      </v-card-text>

      <template v-slot:actions>
        <v-spacer></v-spacer>
        
        <v-btn 
          @click="closeDialog"
          variant="outlined"
          :color="dialogColor"
          :disabled="loading"
        >
          {{ CapitalizeFirstLetter(t('common.cancel')) }}
        </v-btn>

        <v-btn 
          @click="okCallback"
          :color="dialogColor"
          :loading="loading"
          :disabled="loading"
        >
          {{ CapitalizeFirstLetter(t(confirmButtonText)) }}
        </v-btn>
      </template>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { computed } from 'vue';
const { t } = useI18n({ inheritLocale: true });
import { CapitalizeFirstLetter } from "@/views/utils/function"

interface Props {
  showDialog: boolean;
  noticeText: string;
  noticeTitle?: string;
  dialogType?: 'confirm' | 'delete' | 'edit' | 'warning' | 'error' | 'info';
  additionalInfo?: string;
  confirmButtonText?: string;
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  dialogType: 'confirm',
  additionalInfo: '',
  confirmButtonText: 'common.ok',
  loading: false
});

const emit = defineEmits(['dialogclose', 'okCallback']);

// Computed properties for dialog styling based on type
const dialogIcon = computed(() => {
  switch (props.dialogType) {
    case 'delete':
      return 'mdi-delete';
    case 'edit':
      return 'mdi-pencil';
    case 'warning':
      return 'mdi-alert';
    case 'error':
      return 'mdi-alert-circle';
    case 'info':
      return 'mdi-information';
    default:
      return 'mdi-help-circle';
  }
});

const dialogColor = computed(() => {
  switch (props.dialogType) {
    case 'delete':
      return 'error';
    case 'edit':
      return 'primary';
    case 'warning':
      return 'warning';
    case 'error':
      return 'error';
    case 'info':
      return 'info';
    default:
      return 'primary';
  }
});

const closeDialog = () => {
  if (!props.loading) {
    emit('dialogclose');
  }
};

const okCallback = () => {
  if (!props.loading) {
    emit('okCallback');
  }
};
</script>

<style scoped>
.confirm-dialog {
  transition: all 0.3s ease;
}

.confirm-dialog:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
}

/* Animation for dialog appearance */
.v-dialog {
  animation: dialogSlideIn 0.3s ease-out;
}

@keyframes dialogSlideIn {
  from {
    opacity: 0;
    transform: scale(0.9) translateY(-20px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

/* Focus management for accessibility */
.confirm-dialog:focus-within {
  outline: 2px solid var(--v-primary-base);
  outline-offset: 2px;
}
</style>