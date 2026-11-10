<template>
  <!-- Ambiguity chooser (capability-parity FR-IMG-006): several generated
       images could match the request; the user picks one to proceed as the
       sole reference. Persistent so an outside click cannot dismiss it and
       strand a stale pending send. Extracted from AiChatV2.vue — testids
       are unchanged so both surfaces share one contract. -->
  <v-dialog
    :model-value="modelValue"
    max-width="420"
    persistent
    data-testid="ai-chat-generated-chooser"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2" color="primary">mdi-image-multiple-outline</v-icon>
        <span>
          {{
            t("aiChatV2.generatedImageRefs.referenceTrayTitle") ||
            "Reference images"
          }}
        </span>
      </v-card-title>
      <v-card-text>
        <p class="text-body-2 mb-3">
          {{
            t("aiChatV2.generatedImageRefs.errors.generated_image_ambiguous") ||
            "Several images could match your request."
          }}
        </p>
        <div class="d-flex flex-wrap ga-2">
          <v-btn
            v-for="(candidate, idx) in candidates"
            :key="`${candidate.reference.messageId}:${candidate.reference.imageIndex}`"
            variant="outlined"
            size="small"
            :data-testid="`ai-chat-generated-candidate-${idx}`"
            @click="emit('select', candidate)"
          >
            <img
              v-if="candidate.thumbUrl"
              :src="candidate.thumbUrl"
              :alt="
                candidate.fileName ||
                t('aiChatV2.generatedImageRefs.useAsReference') ||
                'Reference image'
              "
              class="mr-1"
              style="max-height: 32px; max-width: 48px; border-radius: 4px"
            />
            <v-icon v-else size="small" class="mr-1">mdi-image-outline</v-icon>
            {{ candidate.fileName || `#${idx + 1}` }}
          </v-btn>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          data-testid="ai-chat-generated-chooser-cancel"
          @click="emit('cancel')"
        >
          {{ t("aiChatV2.cancel") || "Cancel" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { GeneratedImageReferenceView } from "@/views/components/aiChatV2/generatedImageReferenceView";

defineProps<{
  modelValue: boolean;
  /** Candidate tiles (reference + resolved thumb/name). */
  candidates: readonly GeneratedImageReferenceView[];
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "select", candidate: GeneratedImageReferenceView): void;
  (e: "cancel"): void;
}>();

const { t } = useI18n();
</script>
