<template>
  <!--
    Spoken-response speech-model install dialog (spec 2026-10-26). Replaces
    the former inline bottom-of-chat TTS notice; presentational only — state
    lives in the shared useAiChatVoice composable, both chat surfaces render
    this one component.
  -->
  <v-dialog
    :model-value="modelValue"
    max-width="520"
    persistent
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <v-card data-testid="tts-install-dialog">
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2" color="primary">mdi-volume-high</v-icon>
        <span>
          {{
            t("aiChatV2.voice.enable_spoken_responses") ||
            "Enable spoken responses"
          }}
        </span>
      </v-card-title>
      <v-card-text>
        <p class="text-body-2 mb-3">
          {{
            t("aiChatV2.voice.tts_model_missing") ||
            "Spoken responses need a speech model. Install it to enable."
          }}
        </p>
        <v-alert
          v-if="error"
          type="error"
          variant="tonal"
          density="comfortable"
          class="mb-3"
        >
          {{ error }}
        </v-alert>
        <div v-if="installing" class="d-flex align-center mt-3">
          <v-progress-circular
            indeterminate
            size="18"
            width="2"
            color="primary"
            class="mr-2"
          />
          <span class="text-body-2">
            {{ t("aiChatV2.voice.installing_model") || "Installing..." }}
          </span>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-btn
          variant="text"
          :disabled="installing"
          data-testid="tts-install-settings"
          @click="emit('open-settings')"
        >
          {{ t("aiChatV2.voice.open_model_settings") || "Open settings" }}
        </v-btn>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="installing"
          data-testid="tts-install-cancel"
          @click="emit('update:modelValue', false)"
        >
          {{ t("common.cancel") || "Cancel" }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="installing"
          :disabled="installing"
          data-testid="tts-install-confirm"
          @click="emit('confirm')"
        >
          {{ t("aiChatV2.voice.install_tts_model") || "Install speech model" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

withDefaults(
  defineProps<{
    /** Dialog visibility (v-model). */
    modelValue?: boolean;
    installing?: boolean;
    error?: string | null;
  }>(),
  { modelValue: false, installing: false, error: null }
);

const emit = defineEmits<{
  (event: "update:modelValue", value: boolean): void;
  (event: "confirm"): void;
  (event: "open-settings"): void;
}>();

const { t } = useI18n();
</script>
