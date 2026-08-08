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
          <template #append>
            <v-chip
              v-if="item.raw.isFree"
              size="x-small"
              color="success"
              variant="flat"
              class="ml-2"
            >
              {{ t('aiChatV2.model_free') || 'Free' }}
            </v-chip>
          </template>
          <v-list-item-subtitle
            v-if="item.raw.subtitle"
            class="text-caption text-grey"
          >
            {{ item.raw.subtitle }}
          </v-list-item-subtitle>
          <v-list-item-subtitle
            v-else-if="item.raw.contextSize"
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
  /** Server-reported default model id; shown as the resolved target of "Auto". */
  defaultModel?: string;
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
  subtitle?: string;
  isFree?: boolean;
}

/** Sentinel matching the parent's AUTO_MODEL_VALUE. */
const AUTO_MODEL_VALUE = "auto";

const selectItems = computed<ModelSelectItem[]>(() => {
  const modelItems = (props.items ?? [])
    .filter((m) => m && typeof m.id === "string" && m.id.length > 0)
    .map((m) => ({
      value: m.id,
      title: m.id,
      contextSize: m.context_size,
      isFree: m.is_free === true,
    }));
  // Resolve the context size for "Auto" from the default model's entry so
  // the dropdown shows the same context info as the concrete model.
  const defaultEntry = props.defaultModel
    ? (props.items ?? []).find((m) => m.id === props.defaultModel)
    : undefined;
  const autoSubtitle = props.defaultModel
    ? `${t("aiChatV2.model_auto_default") || "Default"}: ${props.defaultModel}`
    : t("aiChatV2.model_auto") || "Auto";
  return [
    {
      value: AUTO_MODEL_VALUE,
      title: t("aiChatV2.model_auto") || "Auto",
      subtitle: autoSubtitle,
      contextSize: defaultEntry?.context_size,
    },
    ...modelItems,
  ];
});

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
