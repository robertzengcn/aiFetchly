<template>
  <v-dialog :model-value="modelValue" max-width="640" @update:model-value="onToggle">
    <v-card v-if="form" data-testid="workspace-memory-editor">
      <v-card-title>
        {{ isEdit ? editTitle : createTitle }}
      </v-card-title>
      <v-card-text>
        <v-select
          v-model="form.type"
          :items="typeOptions"
          :label="typeLabel"
          item-title="label"
          item-value="value"
          density="compact"
          class="mb-3"
        />
        <v-text-field
          v-model="form.title"
          :label="titleLabel"
          density="compact"
          counter="200"
          maxlength="200"
          class="mb-3"
        />
        <v-textarea
          v-model="form.content"
          :label="contentLabel"
          density="compact"
          rows="4"
          counter="8000"
          auto-grow
          class="mb-3"
        />
        <div class="editor-row">
          <span class="editor-row__label">{{ confidenceLabel }}: {{ form.confidence }}</span>
          <v-slider
            v-model="form.confidence"
            min="0"
            max="100"
            step="1"
            color="primary"
            hide-details
          />
        </div>
        <v-select
          v-if="isEdit"
          v-model="form.status"
          :items="statusOptions"
          :label="statusLabel"
          item-title="label"
          item-value="value"
          density="compact"
          class="mt-3"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="onCancel">{{ cancelText }}</v-btn>
        <v-btn color="primary" variant="flat" @click="onSave">{{ saveText }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import { useI18n } from "vue-i18n";
import type {
  AIWorkspaceMemoryType,
  AIWorkspaceMemoryStatus,
  AIWorkspaceMemoryView,
} from "@/entityTypes/aiWorkspaceMemoryTypes";

type EditorResult = {
  type: AIWorkspaceMemoryType;
  title: string;
  content: string;
  confidence: number;
  status?: AIWorkspaceMemoryStatus;
};

const props = defineProps<{
  modelValue: boolean;
  /** When provided, the dialog edits this memory; otherwise it creates a new one. */
  memory?: AIWorkspaceMemoryView | null;
  defaultType?: AIWorkspaceMemoryType;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "save", value: EditorResult): void;
  (e: "cancel"): void;
}>();

const { t } = useI18n();

interface FormState {
  type: AIWorkspaceMemoryType;
  title: string;
  content: string;
  confidence: number;
  status: AIWorkspaceMemoryStatus;
}

const form = reactive<FormState>({
  type: "decision",
  title: "",
  content: "",
  confidence: 90,
  status: "active",
});

const isEdit = computed(() => !!props.memory);

function resetFromMemory(): void {
  const m = props.memory;
  if (m) {
    form.type = m.type;
    form.title = m.title;
    form.content = m.content;
    form.confidence = m.confidence;
    form.status = m.status;
  } else {
    form.type = props.defaultType ?? "decision";
    form.title = "";
    form.content = "";
    form.confidence = 90;
    form.status = "active";
  }
}

watch(
  () => [props.modelValue, props.memory, props.defaultType] as const,
  () => {
    if (props.modelValue) resetFromMemory();
  },
  { immediate: true }
);

const typeOptions = computed(() => [
  { label: t("workspaceMemory.typeProject") || "Project", value: "project" },
  { label: t("workspaceMemory.typeDecision") || "Decision", value: "decision" },
  { label: t("workspaceMemory.typeWorkflow") || "Workflow", value: "workflow" },
  { label: t("workspaceMemory.typeConvention") || "Convention", value: "convention" },
  { label: t("workspaceMemory.typeReference") || "Reference", value: "reference" },
  { label: t("workspaceMemory.typeWarning") || "Warning", value: "warning" },
]);

const statusOptions = computed(() => [
  { label: t("workspaceMemory.statusActive") || "Active", value: "active" },
  { label: t("workspaceMemory.statusArchived") || "Archived", value: "archived" },
  { label: t("workspaceMemory.statusContradicted") || "Contradicted", value: "contradicted" },
]);

const editTitle = computed(() => t("workspaceMemory.edit") || "Edit memory");
const createTitle = computed(() => t("workspaceMemory.create") || "Create memory");
const typeLabel = computed(() => t("workspaceMemory.typeField") || "Type");
const titleLabel = computed(() => t("workspaceMemory.titleField") || "Title");
const contentLabel = computed(() => t("workspaceMemory.contentField") || "Content");
const statusLabel = computed(() => t("workspaceMemory.statusField") || "Status");
const confidenceLabel = computed(() => t("workspaceMemory.confidence") || "Confidence");
const cancelText = computed(() => t("workspaceMemory.cancel") || "Cancel");
const saveText = computed(() => t("workspaceMemory.save") || "Save");

function onToggle(v: boolean): void {
  emit("update:modelValue", v);
}

function onCancel(): void {
  emit("update:modelValue", false);
  emit("cancel");
}

function onSave(): void {
  const result: EditorResult = {
    type: form.type,
    title: form.title,
    content: form.content,
    confidence: form.confidence,
  };
  if (isEdit.value) result.status = form.status;
  emit("save", result);
}
</script>

<style scoped>
.editor-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.editor-row__label {
  font-size: 12px;
  opacity: 0.7;
  white-space: nowrap;
}
</style>
