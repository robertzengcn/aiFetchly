<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
    max-width="640"
  >
    <v-card>
      <v-card-title>
        {{ mode === 'create' ? t('aiMemory.dialog_title_create') : t('aiMemory.dialog_title_edit') }}
      </v-card-title>
      <v-card-text>
        <v-select
          v-model="form.type"
          :items="typeOptions"
          :label="t('aiMemory.field_type')"
          item-title="label"
          item-value="value"
          density="compact"
          class="mb-2"
        />
        <v-text-field
          v-model="form.title"
          :label="t('aiMemory.field_title')"
          :error-messages="errors.title"
          density="compact"
          class="mb-2"
        />
        <v-textarea
          v-model="form.content"
          :label="t('aiMemory.field_content')"
          :error-messages="errors.content"
          auto-grow
          rows="3"
          density="compact"
          class="mb-2"
        />
        <v-select
          v-if="mode === 'edit'"
          v-model="form.status"
          :items="statusOptions"
          :label="t('aiMemory.field_status')"
          item-title="label"
          item-value="value"
          density="compact"
          class="mb-2"
        />
        <v-slider
          v-model="form.confidence"
          :min="0"
          :max="100"
          :step="1"
          :label="t('aiMemory.field_confidence')"
          thumb-label
          class="mb-2"
        />
        <div v-if="mode === 'edit'" class="text-caption text-grey mt-2">
          {{ t('aiMemory.field_source') }}: {{ sourceLabel }}
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">{{ t('aiMemory.button_cancel') }}</v-btn>
        <v-btn color="primary" :loading="saving" @click="submit">
          {{ t('aiMemory.button_save') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { reactive, ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { aiUserMemoryApi } from "@/views/api/aiUserMemory";
import {
  AI_USER_MEMORY_TYPES,
  AI_USER_MEMORY_STATUSES,
  isAIUserMemoryType,
  type AIUserMemoryView,
  type AIUserMemoryType,
  type AIUserMemoryStatus,
  type AIUserMemorySourceKind,
} from "@/entityTypes/aiUserMemoryTypes";

const props = defineProps<{
  modelValue: boolean;
  mode: "create" | "edit";
  memory: AIUserMemoryView | null;
}>();
const emit = defineEmits<{
  "update:modelValue": [boolean];
  saved: [AIUserMemoryView];
}>();
const { t } = useI18n();

interface FormState {
  type: AIUserMemoryType;
  title: string;
  content: string;
  status: AIUserMemoryStatus;
  confidence: number;
  sourceKind: AIUserMemorySourceKind | "";
}

const form = reactive<FormState>({
  type: "preference",
  title: "",
  content: "",
  status: "active",
  confidence: 100,
  sourceKind: "",
});
const errors = reactive<{ title: string; content: string }>({
  title: "",
  content: "",
});
const saving = ref(false);

watch(
  () => props.memory,
  (m) => {
    if (props.mode === "edit" && m) {
      form.type = m.type;
      form.title = m.title;
      form.content = m.content;
      form.status = m.status;
      form.confidence = m.confidence;
      form.sourceKind = m.sourceKind ?? "";
    } else {
      form.type = "preference";
      form.title = "";
      form.content = "";
      form.status = "active";
      form.confidence = 100;
      form.sourceKind = "";
    }
    errors.title = "";
    errors.content = "";
  },
  { immediate: true }
);

const typeOptions = computed(() =>
  AI_USER_MEMORY_TYPES.map((v) => ({ value: v, label: t(`aiMemory.type_${v}`) }))
);
const statusOptions = computed(() =>
  AI_USER_MEMORY_STATUSES.map((v) => ({ value: v, label: t(`aiMemory.status_${v}`) }))
);
const sourceLabel = computed(() =>
  form.sourceKind ? t(`aiMemory.source_${form.sourceKind}`) : t("aiMemory.source_manual")
);

function validate(): boolean {
  errors.title = form.title.trim() ? "" : t("aiMemory.err_title_required");
  errors.content = form.content.trim() ? "" : t("aiMemory.err_content_required");
  return isAIUserMemoryType(form.type) && !errors.title && !errors.content;
}

function close(): void {
  emit("update:modelValue", false);
}

async function submit(): Promise<void> {
  if (!validate()) return;
  saving.value = true;
  try {
    if (props.mode === "create") {
      const res = await aiUserMemoryApi.create({
        type: form.type,
        title: form.title.trim(),
        content: form.content.trim(),
        confidence: form.confidence,
      });
      if (!res.status || !res.data) {
        errors.title = res.msg;
        return;
      }
      emit("saved", res.data);
    } else {
      const memoryId = props.memory?.memoryId ?? "";
      const res = await aiUserMemoryApi.update({
        memoryId,
        type: form.type,
        title: form.title.trim(),
        content: form.content.trim(),
        status: form.status,
        confidence: form.confidence,
      });
      if (!res.status || !res.data) {
        errors.title = res.msg;
        return;
      }
      emit("saved", res.data);
    }
  } finally {
    saving.value = false;
  }
}

defineExpose({ form, submit, validate });
</script>
