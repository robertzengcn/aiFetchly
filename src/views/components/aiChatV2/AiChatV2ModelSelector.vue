<template>
  <div class="v2-model-selector">
    <v-select
      :model-value="modelValue"
      :items="selectItems"
      item-value="value"
      item-title="title"
      :placeholder="
        loading
          ? t('aiChatV2.model_loading') || 'Loading models…'
          : t('aiChatV2.model_none_available') || 'No models available'
      "
      density="compact"
      variant="outlined"
      hide-details
      :disabled="disabled || selectItems.length === 0"
      :loading="loading"
      :aria-label="t('aiChatV2.model_selector_label') || 'Model'"
      class="v2-model-selector__select"
      @update:model-value="onChange"
    >
      <template #item="{ item, props }">
        <v-list-item v-bind="props">
          <v-list-item-subtitle
            v-if="item.raw.contextSize"
            class="text-caption text-grey"
          >
            {{ formatContextSize(item.raw.contextSize) }}
          </v-list-item-subtitle>
        </v-list-item>
      </template>
    </v-select>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { OpenAIModel } from "@/api/aiChatApi";

const props = defineProps<{
  modelValue: string | undefined;
  items: OpenAIModel[];
  disabled?: boolean;
  loading?: boolean;
}>();
const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();
const { t } = useI18n();

interface ModelSelectItem {
  value: string;
  title: string;
  contextSize?: number;
}

const selectItems = computed<ModelSelectItem[]>(() =>
  (props.items ?? [])
    .filter((m) => m && typeof m.id === "string" && m.id.length > 0)
    .map((m) => ({
      value: m.id,
      title: m.id,
      contextSize: m.context_size,
    }))
);

const onChange = (value: unknown): void => {
  if (typeof value === "string" && value.length > 0) {
    emit("update:modelValue", value);
  }
};

const formatContextSize = (tokens: number): string => {
  if (tokens >= 1000) {
    const k = tokens / 1000;
    return k % 1 === 0 ? `${k}K context` : `${k.toFixed(1)}K context`;
  }
  return `${tokens} context`;
};
</script>

<style scoped>
.v2-model-selector {
  display: flex;
  align-items: center;
}
.v2-model-selector__select {
  min-width: 130px;
  max-width: 200px;
}
</style>
