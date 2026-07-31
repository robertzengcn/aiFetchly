<template>
  <v-dialog
    :model-value="true"
    max-width="780"
    @update:model-value="$emit('close')"
  >
    <v-card>
      <v-card-title>
        {{ agent ? t("subagents.edit_title") : t("subagents.create_title") }}
      </v-card-title>
      <v-card-text>
        <v-text-field
          v-model="form.name"
          :label="t('subagents.field_name')"
          :rules="[required]"
          @update:model-value="maybeDeriveSlug"
        />
        <v-text-field
          v-model="form.idSlug"
          :label="t('subagents.field_id_slug')"
          :disabled="!!agent"
          :rules="[required]"
          :hint="agent ? t('subagents.hint_id_locked') : ''"
          persistent-hint
        />
        <v-textarea
          v-model="form.description"
          :label="t('subagents.field_description')"
          :rules="[required]"
          rows="2"
        />
        <v-select
          v-model="form.mode"
          :items="modes"
          :label="t('subagents.field_mode')"
        />
        <v-textarea
          v-model="form.systemPrompt"
          :label="t('subagents.field_system_prompt')"
          :rules="[required]"
          rows="6"
        />
        <v-text-field
          v-model="toolsText"
          :label="t('subagents.field_tools')"
          :hint="t('subagents.hint_tools_comma')"
          persistent-hint
        />
        <v-text-field
          v-model="form.defaultModel"
          :label="t('subagents.field_model')"
        />
        <v-row>
          <v-col cols="4">
            <v-text-field
              v-model.number="form.maxToolCalls"
              type="number"
              :label="t('subagents.field_max_tool_calls')"
              :rules="[positiveInt]"
            />
          </v-col>
          <v-col cols="4">
            <v-text-field
              v-model.number="form.maxRuntimeSeconds"
              type="number"
              :label="t('subagents.field_max_runtime_seconds')"
              :rules="[positiveInt]"
            />
          </v-col>
          <v-col cols="4">
            <v-text-field
              v-model.number="form.maxContinueCalls"
              type="number"
              :label="t('subagents.field_max_continue_calls')"
              :rules="[positiveInt]"
            />
          </v-col>
        </v-row>
        <v-textarea
          v-model="outputSchemaText"
          :label="t('subagents.field_output_schema')"
          :hint="t('subagents.hint_output_schema_json')"
          persistent-hint
          rows="3"
        />
        <v-switch
          v-model="form.enabled"
          :label="t('subagents.field_enabled')"
          color="success"
          hide-details
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="$emit('close')">
          {{ t("subagents.button_cancel") }}
        </v-btn>
        <v-btn color="primary" :loading="saving" @click="onSave">
          {{ t("subagents.button_save") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  createAgentDefinition,
  updateAgentDefinition,
  type AgentDefinitionView,
  type AgentMode,
} from "@/views/api/agents";

const props = defineProps<{ agent?: AgentDefinitionView }>();
const emit = defineEmits<{
  close: [];
  saved: [AgentDefinitionView];
}>();
const { t } = useI18n();

const modes: AgentMode[] = ["coordinator", "specialist", "verifier", "formatter"];

interface FormState {
  name: string;
  idSlug: string;
  description: string;
  mode: AgentMode;
  systemPrompt: string;
  defaultModel: string;
  maxToolCalls: number;
  maxRuntimeSeconds: number;
  maxContinueCalls: number;
  enabled: boolean;
}

const form = ref<FormState>(
  props.agent
    ? {
        name: props.agent.name,
        idSlug: props.agent.id.replace(/^user:/, ""),
        description: props.agent.description,
        mode: props.agent.mode,
        systemPrompt: props.agent.systemPrompt,
        defaultModel: props.agent.defaultModel ?? "",
        maxToolCalls: props.agent.maxToolCalls,
        maxRuntimeSeconds: Math.round(props.agent.maxRuntimeMs / 1000),
        maxContinueCalls: props.agent.maxContinueCalls,
        enabled: props.agent.status === "active",
      }
    : {
        name: "",
        idSlug: "",
        description: "",
        mode: "specialist",
        systemPrompt: "",
        defaultModel: "",
        maxToolCalls: 8,
        maxRuntimeSeconds: 300,
        maxContinueCalls: 8,
        enabled: true,
      }
);

const toolsText = ref((props.agent?.allowedTools ?? []).join(", "));
const outputSchemaText = ref(
  props.agent && Object.keys(props.agent.outputSchema).length > 0
    ? JSON.stringify(props.agent.outputSchema, null, 2)
    : ""
);
const slugTouched = ref(!!props.agent);
const saving = ref(false);

function maybeDeriveSlug(): void {
  if (slugTouched.value) return;
  form.value.idSlug = form.value.name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
}

const required = (v: string) =>
  (!!v && v.trim().length > 0) || t("subagents.validation_required");
const positiveInt = (v: number) =>
  (Number.isInteger(v) && v > 0) || t("subagents.validation_positive");

const parsedOutputSchema = computed<Record<string, unknown> | undefined>(() => {
  const text = outputSchemaText.value.trim();
  if (!text) return undefined;
  try {
    const obj = JSON.parse(text);
    return obj && typeof obj === "object" && !Array.isArray(obj)
      ? (obj as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
});

async function onSave(): Promise<void> {
  if (!form.value.name || !form.value.description || !form.value.systemPrompt) {
    return;
  }
  if (outputSchemaText.value.trim() && parsedOutputSchema.value === undefined) {
    return;
  }
  const allowedTools = toolsText.value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  saving.value = true;
  try {
    if (props.agent) {
      const saved = await updateAgentDefinition(props.agent.id, {
        name: form.value.name,
        description: form.value.description,
        systemPrompt: form.value.systemPrompt,
        allowedTools,
        defaultModel: form.value.defaultModel || null,
        mode: form.value.mode,
        maxToolCalls: form.value.maxToolCalls,
        maxRuntimeMs: form.value.maxRuntimeSeconds * 1000,
        maxContinueCalls: form.value.maxContinueCalls,
        ...(parsedOutputSchema.value
          ? { outputSchema: parsedOutputSchema.value }
          : {}),
        enabled: form.value.enabled,
      });
      if (saved) emit("saved", saved);
    } else {
      const saved = await createAgentDefinition({
        idSlug: form.value.idSlug,
        name: form.value.name,
        description: form.value.description,
        systemPrompt: form.value.systemPrompt,
        allowedTools,
        ...(form.value.defaultModel
          ? { defaultModel: form.value.defaultModel }
          : {}),
        mode: form.value.mode,
        maxToolCalls: form.value.maxToolCalls,
        maxRuntimeMs: form.value.maxRuntimeSeconds * 1000,
        maxContinueCalls: form.value.maxContinueCalls,
        ...(parsedOutputSchema.value
          ? { outputSchema: parsedOutputSchema.value }
          : {}),
        enabled: form.value.enabled,
      });
      if (saved) emit("saved", saved);
    }
    emit("close");
  } finally {
    saving.value = false;
  }
}
</script>
