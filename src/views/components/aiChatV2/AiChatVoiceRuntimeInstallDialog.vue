<template>
  <!--
    Local voice-runtime install dialog (chat-first shell design §11.1/§11.4).
    Presentational: state and progress live in the shared useAiChatVoice
    composable; both chat surfaces render this one component.
  -->
  <v-dialog
    :model-value="open"
    max-width="520"
    persistent
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2" color="primary">mdi-microphone-outline</v-icon>
        <span>
          {{
            t("aiChatV2.voice.runtime_install_title") ||
            "Install local voice runtime?"
          }}
        </span>
      </v-card-title>
      <v-card-text>
        <p class="text-body-2 mb-3">
          {{
            t("aiChatV2.voice.runtime_install_message") ||
            "Voice input needs the local voice runtime and Whisper Base voice model. Download and install them now?"
          }}
        </p>
        <div v-if="sizeText" class="text-caption text-medium-emphasis mb-3">
          {{ sizeText }}
        </div>
        <v-alert
          v-if="error"
          type="error"
          variant="tonal"
          density="comfortable"
          class="mb-3"
        >
          {{ error }}
        </v-alert>
        <div v-if="installing" class="mt-3">
          <div class="d-flex align-center mb-2">
            <v-progress-circular
              indeterminate
              size="18"
              width="2"
              color="primary"
              class="mr-2"
            />
            <span class="text-body-2">
              {{ progressText }}
            </span>
          </div>
          <v-progress-linear
            v-if="percent !== undefined"
            :model-value="percent"
            color="primary"
            height="6"
            rounded
          />
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="installing"
          data-testid="voice-runtime-install-cancel"
          @click="emit('update:modelValue', false)"
        >
          {{ t("common.cancel") || "Cancel" }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="installing"
          :disabled="installing"
          data-testid="voice-runtime-install-confirm"
          @click="emit('confirm')"
        >
          {{
            t("aiChatV2.voice.runtime_install_confirm") ||
            "Download and install"
          }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

withDefaults(
  defineProps<{
    open?: boolean;
    installing?: boolean;
    error?: string | null;
    sizeText?: string;
    progressText?: string;
    percent?: number;
  }>(),
  {
    open: false,
    installing: false,
    error: null,
    sizeText: "",
    progressText: "",
    percent: undefined,
  }
);

const emit = defineEmits<{
  (event: "update:modelValue", value: boolean): void;
  (event: "confirm"): void;
}>();

const { t } = useI18n();
</script>
