<template>
  <!-- Batch confirmation (capability-parity FR-IMG-008): more than the
       direct-reference maximum inferred; confirm sends plain text (the main
       process runs them as a trusted background batch), decline aborts.
       Extracted from AiChatV2.vue — testids are unchanged so both surfaces
       share one contract. -->
  <v-dialog
    :model-value="modelValue"
    max-width="420"
    persistent
    data-testid="ai-chat-generated-batch-confirm"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2" color="primary">mdi-image-multiple-outline</v-icon>
        <span>
          {{
            t("aiChatV2.generatedImageRefs.batchConfirmTitle") ||
            "Process as batch?"
          }}
        </span>
      </v-card-title>
      <v-card-text>
        <p class="text-body-2 mb-3">
          {{
            t("aiChatV2.generatedImageRefs.batchConfirmBody", {
              count,
            }) ||
            "Each selected image will be edited independently in a background batch. This may take a while."
          }}
        </p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          data-testid="ai-chat-generated-batch-decline"
          @click="emit('decline')"
        >
          {{ t("aiChatV2.cancel") || "Cancel" }}
        </v-btn>
        <v-btn
          color="primary"
          data-testid="ai-chat-generated-batch-confirm-accept"
          @click="emit('confirm')"
        >
          {{ t("aiChatV2.generatedImageRefs.send") || "Send" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

defineProps<{
  modelValue: boolean;
  /** Number of references shown in the confirmation copy. */
  count: number;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "confirm"): void;
  (e: "decline"): void;
}>();

const { t } = useI18n();
</script>
