<template>
  <div class="v2-mode-selector">
    <v-btn-toggle
      :model-value="modelValue"
      density="compact"
      size="small"
      color="primary"
      mandatory
      :disabled="disabled"
      divided
      @update:model-value="onChange"
    >
      <v-btn value="chat" size="small">
        <v-icon start size="small">mdi-chat-outline</v-icon>
        {{ t("aiChatV2Plan.mode_chat") || "Chat" }}
      </v-btn>
      <v-btn value="plan" size="small">
        <v-icon start size="small">mdi-clipboard-list-outline</v-icon>
        {{ t("aiChatV2Plan.mode_plan") || "Plan" }}
      </v-btn>
    </v-btn-toggle>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { ChatV2Mode } from "@/entityTypes/aiChatPlanTypes";

defineProps<{
  modelValue: ChatV2Mode;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  (e: "update:modelValue", value: ChatV2Mode): void;
}>();
const { t } = useI18n();

const onChange = (value: unknown): void => {
  if (value === "chat" || value === "plan") {
    emit("update:modelValue", value);
  }
};
</script>

<style scoped>
.v2-mode-selector {
  display: flex;
  align-items: center;
}
</style>
