<template>
  <div class="v2-mode-selector">
    <v-select
      :model-value="modelValue"
      :items="modeItems"
      item-value="value"
      item-title="title"
      density="compact"
      variant="outlined"
      hide-details
      :disabled="disabled"
      class="v2-mode-selector__select"
      @update:model-value="onChange"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
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

const modeItems = computed(() => [
  {
    value: "chat" as ChatV2Mode,
    title: t("aiChatV2Plan.mode_chat") || "Chat",
  },
  {
    value: "plan" as ChatV2Mode,
    title: t("aiChatV2Plan.mode_plan") || "Plan",
  },
]);

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
.v2-mode-selector__select {
  min-width: 90px;
  max-width: 110px;
}
</style>
