<template>
  <v-container fluid class="pa-0">
    <!-- Task Name -->
    <v-row>
      <v-col cols="12">
        <v-text-field
          v-model="formState.name"
          :label="t('schedule.ai_message_task_name') || 'Task Name'"
          :placeholder="t('schedule.ai_message_task_name_hint') || 'Enter a name for this AI message task'"
          density="compact"
          variant="outlined"
          :rules="[rules.required]"
          @update:model-value="emitChange"
        />
      </v-col>
    </v-row>

    <!-- AI Message -->
    <v-row>
      <v-col cols="12">
        <v-textarea
          v-model="formState.message"
          :label="t('schedule.ai_message_task_message') || 'AI Message'"
          :placeholder="t('schedule.ai_message_task_message_hint') || 'The prompt to send to the AI on each scheduled run'"
          rows="4"
          density="compact"
          variant="outlined"
          :rules="[rules.required]"
          @update:model-value="emitChange"
        />
      </v-col>
    </v-row>

    <!-- AI Model -->
    <v-row>
      <v-col cols="12">
        <div class="text-caption text-medium-emphasis mb-1">
          {{ t('schedule.ai_message_task_model') || 'AI Model' }}
        </div>
        <AiChatV2ModelSelector
          v-model="formState.model"
          :items="availableModels"
          :default-model="defaultModelId"
          :loading="modelsLoading"
          @update:model-value="emitChange"
        />
      </v-col>
    </v-row>

    <!-- Allowed Tools -->
    <v-row>
      <v-col cols="12">
        <v-select
          v-model="formState.allowedTools"
          :items="schedulableTools"
          item-title="name"
          item-value="name"
          :label="t('schedule.ai_message_task_allowed_tools') || 'Allowed Tools'"
          :placeholder="t('schedule.ai_message_task_allowed_tools_hint') || 'Select built-in tools the AI can use'"
          multiple
          chips
          closable-chips
          density="compact"
          variant="outlined"
          :loading="toolsLoading"
          :disabled="toolsLoading"
          @update:model-value="emitChange"
        >
          <template v-slot:chip="{ item }">
            <v-chip :color="getRiskColor(item.raw.riskLevel)" size="small">
              {{ item.raw.name }}
            </v-chip>
          </template>
          <template v-slot:item="{ props: itemProps, item }">
            <v-list-item v-bind="itemProps">
              <template v-slot:prepend>
                <v-chip
                  :color="getRiskColor(item.raw.riskLevel)"
                  size="x-small"
                  class="mr-2"
                >
                  {{ getRiskLabel(item.raw.riskLevel) }}
                </v-chip>
              </template>
              <v-list-item-subtitle class="text-caption">
                {{ item.raw.description }}
              </v-list-item-subtitle>
            </v-list-item>
          </template>
        </v-select>
      </v-col>
    </v-row>

    <!-- Auto-Approve Tools -->
    <v-row>
      <v-col cols="12">
        <v-switch
          v-model="formState.autoApproveTools"
          :label="t('schedule.ai_message_task_auto_approve') || 'Auto-Approve Tools'"
          color="warning"
          density="compact"
          hide-details
          @update:model-value="emitChange"
        />
        <v-alert
          v-if="formState.autoApproveTools"
          type="warning"
          variant="tonal"
          density="compact"
          class="mt-2"
        >
          {{ t('schedule.ai_message_task_auto_approve_warning') || 'Warning: Auto-approve allows unattended tool execution. Only select tools you trust.' }}
        </v-alert>
      </v-col>
    </v-row>

    <!-- Safety Limits (collapsible) -->
    <v-row>
      <v-col cols="12">
        <v-expansion-panels flat>
          <v-expansion-panel>
            <v-expansion-panel-title>
              <v-icon class="mr-2">mdi-shield-check</v-icon>
              {{ t('schedule.ai_message_task_safety_limits') || 'Safety Limits' }}
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <v-row>
                <v-col cols="12" md="4">
                  <v-text-field
                    v-model.number="formState.maxToolCalls"
                    :label="t('schedule.ai_message_task_max_tool_calls') || 'Max Tool Calls'"
                    type="number"
                    min="1"
                    density="compact"
                    variant="outlined"
                    @update:model-value="emitChange"
                  />
                </v-col>
                <v-col cols="12" md="4">
                  <v-text-field
                    v-model.number="formState.maxRuntimeMs"
                    :label="t('schedule.ai_message_task_max_runtime') || 'Max Runtime (ms)'"
                    type="number"
                    min="1000"
                    density="compact"
                    variant="outlined"
                    @update:model-value="emitChange"
                  />
                </v-col>
                <v-col cols="12" md="4">
                  <v-text-field
                    v-model.number="formState.maxContinueCalls"
                    :label="t('schedule.ai_message_task_max_continue_calls') || 'Max Continue Calls'"
                    type="number"
                    min="1"
                    density="compact"
                    variant="outlined"
                    @update:model-value="emitChange"
                  />
                </v-col>
              </v-row>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, watch } from "vue";
import { useI18n } from "vue-i18n";
import { listAvailableAiMessageTaskTools } from "@/views/api/aiMessageTask";
import { getOpenAIChatModels } from "@/views/api/aiChatV2";
import { AI_MESSAGE_TASK_DEFAULTS } from "@/entityTypes/aiMessageTaskTypes";
import type { SchedulableAiToolSummary } from "@/entityTypes/aiMessageTaskTypes";
import type { OpenAIModel } from "@/api/aiChatApi";
import AiChatV2ModelSelector from "@/views/components/aiChatV2/AiChatV2ModelSelector.vue";

const { t } = useI18n();

export interface AiMessageTaskFormState {
  name: string;
  message: string;
  systemPrompt: string;
  model: string;
  autoApproveTools: boolean;
  allowedTools: string[];
  maxToolCalls: number;
  maxRuntimeMs: number;
  maxContinueCalls: number;
}

interface Props {
  initialTaskData?: {
    name?: string;
    message?: string;
    system_prompt?: string;
    model?: string;
    allowed_tools_json?: string;
    auto_approve_tools?: boolean;
    max_tool_calls?: number;
    max_runtime_ms?: number;
    max_continue_calls?: number;
  };
  isEdit?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isEdit: false,
});

const emit = defineEmits<{
  (e: "change", formData: AiMessageTaskFormState | undefined): void;
}>();

// Parse allowed tools from JSON string
function parseAllowedTools(json?: string): string[] {
  if (!json) return [];
  try {
    return JSON.parse(json) as string[];
  } catch {
    return [];
  }
}

// Form state
const formState = reactive<AiMessageTaskFormState>({
  name: props.initialTaskData?.name ?? "",
  message: props.initialTaskData?.message ?? "",
  systemPrompt: props.initialTaskData?.system_prompt ?? "",
  model: props.initialTaskData?.model ?? AI_MESSAGE_TASK_DEFAULTS.model,
  autoApproveTools: props.initialTaskData?.auto_approve_tools ?? AI_MESSAGE_TASK_DEFAULTS.autoApproveTools,
  allowedTools: parseAllowedTools(props.initialTaskData?.allowed_tools_json),
  maxToolCalls: props.initialTaskData?.max_tool_calls ?? AI_MESSAGE_TASK_DEFAULTS.maxToolCalls,
  maxRuntimeMs: props.initialTaskData?.max_runtime_ms ?? AI_MESSAGE_TASK_DEFAULTS.maxRuntimeMs,
  maxContinueCalls: props.initialTaskData?.max_continue_calls ?? AI_MESSAGE_TASK_DEFAULTS.maxContinueCalls,
});

// Watch for initialTaskData changes (async load after component mount)
watch(() => props.initialTaskData, (newData) => {
  if (newData) {
    formState.name = newData.name ?? ''
    formState.message = newData.message ?? ''
    formState.systemPrompt = newData.system_prompt ?? ''
    formState.model = newData.model ?? AI_MESSAGE_TASK_DEFAULTS.model
    formState.autoApproveTools = newData.auto_approve_tools ?? AI_MESSAGE_TASK_DEFAULTS.autoApproveTools
    formState.allowedTools = parseAllowedTools(newData.allowed_tools_json)
    formState.maxToolCalls = newData.max_tool_calls ?? AI_MESSAGE_TASK_DEFAULTS.maxToolCalls
    formState.maxRuntimeMs = newData.max_runtime_ms ?? AI_MESSAGE_TASK_DEFAULTS.maxRuntimeMs
    formState.maxContinueCalls = newData.max_continue_calls ?? AI_MESSAGE_TASK_DEFAULTS.maxContinueCalls
    emitChange()
  }
})

// Tools catalog
const schedulableTools = ref<SchedulableAiToolSummary[]>([]);
const toolsLoading = ref(false);

// Models catalog
const availableModels = ref<OpenAIModel[]>([]);
const defaultModelId = ref<string | undefined>(undefined);
const modelsLoading = ref(false);

// Validation
const rules = {
  required: (value: string): boolean | string =>
    !!value?.trim() || (t('schedule.ai_message_task_name_hint') || 'This field is required'),
};

// Risk helpers
function getRiskColor(level: string): string {
  switch (level) {
    case "low": return "success";
    case "medium": return "warning";
    case "high": return "error";
    default: return "grey";
  }
}

function getRiskLabel(level: string): string {
  switch (level) {
    case "low": return t('schedule.ai_message_task_risk_low') || "Low";
    case "medium": return t('schedule.ai_message_task_risk_medium') || "Med";
    case "high": return t('schedule.ai_message_task_risk_high') || "High";
    default: return t('schedule.ai_message_task_risk_blocked') || "Blocked";
  }
}

// Emit form data to parent
function emitChange(): void {
  if (!formState.name?.trim() || !formState.message?.trim()) {
    emit("change", undefined);
    return;
  }
  emit("change", { ...formState });
}

// Load tools catalog
onMounted(async (): Promise<void> => {
  toolsLoading.value = true;
  try {
    const tools = await listAvailableAiMessageTaskTools();
    schedulableTools.value = tools.filter((tool) => tool.schedulable);
  } catch (error) {
    console.error("Failed to load tools catalog:", error);
  } finally {
    toolsLoading.value = false;
  }

  // Load models catalog
  modelsLoading.value = true;
  try {
    const resp = await getOpenAIChatModels();
    if (resp) {
      availableModels.value = resp.data ?? [];
      defaultModelId.value = resp.default_model;
    }
  } catch (error) {
    console.error("Failed to load models catalog:", error);
  } finally {
    modelsLoading.value = false;
  }

  // Emit initial state if pre-populated from edit mode
  if (props.initialTaskData) {
    emitChange();
  }
});
</script>
