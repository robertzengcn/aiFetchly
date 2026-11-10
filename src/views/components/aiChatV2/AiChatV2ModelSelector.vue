<template>
  <div
    class="v2-model-selector"
    :title="noModels ? noModelsHint : undefined"
    :aria-label="noModels ? noModelsHint : undefined"
  >
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
      <template #item="{ item, props: itemProps }">
        <v-list-item v-bind="itemProps">
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
    <!--
      Actionable no-model state (PRD §13.4/§18): once loading has COMPLETED
      with no usable model, an inline provider-settings action replaces the
      dead end. The icon button keeps the toolbar row height unchanged.
    -->
    <v-btn
      v-if="noModels && !loading"
      icon
      size="x-small"
      variant="text"
      class="v2-model-selector__settings"
      data-testid="model-open-settings"
      :aria-label="t('aiChatV2.model_open_settings') || 'Open provider settings'"
      :title="t('aiChatV2.model_open_settings') || 'Open provider settings'"
      @click.stop="emit('open-settings')"
    >
      <v-icon size="small">mdi-cog-outline</v-icon>
    </v-btn>
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
  /** Loading has COMPLETED with no usable model (PRD §13.4 action state). */
  noModels?: boolean;
}>();
const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "open-settings"): void;
}>();
const { t } = useI18n();

const noModelsHint = computed(
  () =>
    t("aiChatV2.model_none_hint") ||
    "No usable model is configured. Open provider settings."
);

interface ModelSelectItem {
  value: string;
  title: string;
  contextSize?: number;
  subtitle?: string;
  isFree?: boolean;
}

/** Sentinel matching the parent's AUTO_MODEL_VALUE. */
const AUTO_MODEL_VALUE = "auto";

/** Show the provider-independent model name without changing its submitted id. */
const getDisplayModelName = (modelId: string): string => {
  const separatorIndex = modelId.lastIndexOf("/");
  return separatorIndex >= 0 ? modelId.slice(separatorIndex + 1) : modelId;
};

const selectItems = computed<ModelSelectItem[]>(() => {
  const modelItems = (props.items ?? [])
    .filter((m) => m && typeof m.id === "string" && m.id.length > 0)
    .map((m) => ({
      value: m.id,
      title: getDisplayModelName(m.id),
      contextSize: m.context_size,
      isFree: m.is_free === true,
    }));
  // Resolve the context size for "Auto" from the default model's entry so
  // the dropdown shows the same context info as the concrete model.
  const defaultEntry = props.defaultModel
    ? (props.items ?? []).find((m) => m.id === props.defaultModel)
    : undefined;
  const autoSubtitle = props.defaultModel
    ? `${t("aiChatV2.model_auto_default") || "Default"}: ${getDisplayModelName(props.defaultModel)}`
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
.v2-model-selector__settings {
  margin-left: 2px;
  /* PRD §16.4: interaction targets at least 40x40. */
  min-width: 40px;
  min-height: 40px;
}
</style>
