<template>
  <v-dialog
    :model-value="modelValue"
    max-width="620"
    persistent
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2" color="primary">mdi-shield-lock-outline</v-icon>
        <span>
          {{
            t("aiChatV2.scheduledLoop.toolApprovalTitle") ||
            "Approve unattended tools"
          }}
        </span>
        <v-spacer />
        <v-btn
          icon="mdi-close"
          size="small"
          variant="text"
          :disabled="submitting"
          data-testid="scheduled-loop-approval-cancel"
          @click="cancel"
        />
      </v-card-title>
      <v-divider />

      <v-card-text>
        <p class="text-body-2 mb-3">
          {{
            t("aiChatV2.scheduledLoop.toolApprovalIntro") ||
            "Scheduled loops run without supervision. Choose built-in tools and extended capabilities (imported skills, MCP, subagents) below. Shell and mark-processed stay blocked."
          }}
        </p>

        <v-alert type="info" variant="tonal" density="compact" class="mb-3">
          {{ t("aiChatV2.scheduledLoop.toolApprovalCommand") || "Command" }}:
          <code>{{ rawCommand }}</code>
        </v-alert>

        <v-progress-linear
          v-if="loading"
          indeterminate
          color="primary"
          height="2"
          class="mb-2"
        />

        <div
          v-else-if="loadError"
          class="pa-4 text-center text-error text-caption"
        >
          {{ loadError }}
        </div>

        <template v-else>
          <!-- Extended capabilities: skills, MCP, subagents (default on). -->
          <div class="mb-3">
            <div class="text-caption font-weight-bold mb-1">
              {{
                t("aiChatV2.scheduledLoop.extendedCapabilities") ||
                "Extended capabilities"
              }}
            </div>
            <v-switch
              v-model="allowSkills"
              :label="
                t('aiChatV2.scheduledLoop.allowSkills') ||
                'Allow imported skills'
              "
              color="primary"
              density="compact"
              hide-details
              data-testid="scheduled-loop-allow-skills"
            />
            <v-switch
              v-model="allowMcp"
              :label="
                t('aiChatV2.scheduledLoop.allowMcp') || 'Allow MCP tools'
              "
              color="primary"
              density="compact"
              hide-details
              data-testid="scheduled-loop-allow-mcp"
            />
            <v-switch
              v-model="allowSubagents"
              :label="
                t('aiChatV2.scheduledLoop.allowSubagents') ||
                'Allow subagents'
              "
              color="primary"
              density="compact"
              hide-details
              data-testid="scheduled-loop-allow-subagents"
            />
          </div>

          <!-- Master switch: enable the unattended built-in tool layer. -->
          <v-switch
            v-model="toolsEnabled"
            :label="
              t('aiChatV2.scheduledLoop.enableTools') ||
              'Allow built-in tools to run unattended'
            "
            color="primary"
            density="compact"
            hide-details
            data-testid="scheduled-loop-tools-enabled"
          />

          <template v-if="toolsEnabled">
            <!-- Read-only tools: auto-approved, no per-tool action. -->
            <v-alert
              type="success"
              variant="tonal"
              density="compact"
              class="mt-3 mb-2"
            >
              <div class="text-caption">
                <strong>{{
                  t("aiChatV2.scheduledLoop.readOnlyAutoApproved") ||
                  "Read-only tools auto-approve"
                }}</strong>
                —
                {{ readOnlyTools.map((t) => t.name).join(", ") }}
              </div>
            </v-alert>

            <!-- Automation tools: plain selection. -->
            <div v-if="automationTools.length > 0" class="mt-2">
              <div class="text-caption font-weight-bold mb-1">
                {{ t("aiChatV2.scheduledLoop.automationTools") || "Automation tools" }}
              </div>
              <v-select
                v-model="selectedAutomation"
                :items="automationTools"
                item-title="name"
                item-value="name"
                :placeholder="
                  t('aiChatV2.scheduledLoop.automationToolsHint') ||
                  'Optional — select tools that perform network checks'
                "
                multiple
                chips
                closable-chips
                density="compact"
                variant="outlined"
                hide-details
                data-testid="scheduled-loop-automation-select"
              />
            </div>

            <!-- High-impact tools: per-tool typed confirmation required. -->
            <div v-if="highImpactTools.length > 0" class="mt-3">
              <div class="text-caption font-weight-bold mb-1">
                {{
                  t("aiChatV2.scheduledLoop.highImpactTools") ||
                  "Write / email tools — type the name to enable"
                }}
              </div>
              <v-alert
                type="warning"
                variant="tonal"
                density="compact"
                class="mb-2"
              >
                {{
                  t("aiChatV2.scheduledLoop.highImpactWarning") ||
                  "These run unattended on every occurrence. Injected content could overwrite files or send email as you. Type each tool name to confirm."
                }}
              </v-alert>
              <div
                v-for="tool in highImpactTools"
                :key="tool.name"
                class="d-flex align-center mb-2"
              >
                <v-checkbox
                  v-model="pendingHighImpact[tool.name]"
                  hide-details
                  density="compact"
                  class="shrink-0"
                  :data-testid="`high-impact-check-${tool.name}`"
                />
                <div class="ml-2 flex-grow-1">
                  <div class="text-body-2">{{ tool.name }}</div>
                  <div class="text-caption text-medium-emphasis">
                    {{ tool.description }}
                  </div>
                  <v-text-field
                    v-if="pendingHighImpact[tool.name]"
                    v-model="confirmInput[tool.name]"
                    :placeholder="
                      t('aiChatV2.scheduledLoop.typeToConfirm', {
                        name: tool.name,
                      }) || `Type ${tool.name} to confirm`
                    "
                    density="compact"
                    variant="outlined"
                    hide-details
                    :data-testid="`high-impact-confirm-${tool.name}`"
                    @input="onConfirmInput(tool.name)"
                  />
                </div>
              </div>
            </div>
          </template>
        </template>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="submitting" @click="cancel">
          {{ t("common.cancel") || "Cancel" }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="submitting"
          :disabled="loading"
          data-testid="scheduled-loop-approval-confirm"
          @click="confirm"
        >
          {{ t("aiChatV2.scheduledLoop.createLoop") || "Schedule loop" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch, reactive } from "vue";
import { useI18n } from "vue-i18n";
import { listAvailableAiMessageTaskTools } from "@/views/api/aiMessageTask";
import type { SchedulableAiToolSummary } from "@/entityTypes/aiMessageTaskTypes";
import {
  hasScheduledLoopEmailInboxIntent,
} from "@/service/ScheduledAiToolPolicy";

const props = defineProps<{
  modelValue: boolean;
  rawCommand: string;
  /** Loop prompt used to pre-enable tools for matching intents (e.g. inbox check). */
  prompt?: string;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (
    e: "confirm",
    payload: {
      allowedTools: string[];
      autoApproveTools: boolean;
      allowSkills: boolean;
      allowMcp: boolean;
      allowSubagents: boolean;
    }
  ): void;
  (e: "cancel"): void;
}>();

const { t } = useI18n();

const loading = ref(false);
const submitting = ref(false);
const loadError = ref<string | null>(null);
const readOnlyTools = ref<SchedulableAiToolSummary[]>([]);
const automationTools = ref<SchedulableAiToolSummary[]>([]);
const highImpactTools = ref<SchedulableAiToolSummary[]>([]);

const toolsEnabled = ref(true);
const allowSkills = ref(true);
const allowMcp = ref(true);
const allowSubagents = ref(true);
const selectedAutomation = ref<string[]>([]);
// checkbox state per high-impact tool (ticked = user intends to enable)
const pendingHighImpact = reactive<Record<string, boolean>>({});
// typed confirmation text per high-impact tool
const confirmInput = reactive<Record<string, string>>({});

/** The high-impact tools the user has correctly typed-in to confirm. */
function confirmedHighImpact(): string[] {
  return highImpactTools.value
    .filter(
      (tool) =>
        pendingHighImpact[tool.name] && confirmInput[tool.name] === tool.name
    )
    .map((tool) => tool.name);
}

/** Clear the confirmation text if the user edited away from the exact name. */
function onConfirmInput(name: string): void {
  if (confirmInput[name] !== name) {
    // no-op; confirmedHighImpact() re-checks on confirm
  }
}

function applyPromptSuggestions(): void {
  const prompt = props.prompt ?? props.rawCommand ?? "";
  // Inbox-check prompts need built-in tools: fetch_unread_emails is read-only.
  if (hasScheduledLoopEmailInboxIntent(prompt)) {
    toolsEnabled.value = true;
  }
}

async function loadTools(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const all = await listAvailableAiMessageTaskTools();
    readOnlyTools.value = all.filter((tool) => tool.riskLevel === "low");
    automationTools.value = all.filter((tool) => tool.riskLevel === "medium");
    highImpactTools.value = all.filter((tool) => tool.riskLevel === "high");
    applyPromptSuggestions();
  } catch (err) {
    loadError.value =
      err instanceof Error ? err.message : "Failed to load available tools.";
    readOnlyTools.value = [];
    automationTools.value = [];
    highImpactTools.value = [];
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      reset();
      void loadTools();
    }
  },
  { immediate: true }
);

function reset(): void {
  toolsEnabled.value = true;
  allowSkills.value = true;
  allowMcp.value = true;
  allowSubagents.value = true;
  selectedAutomation.value = [];
  for (const key of Object.keys(pendingHighImpact)) delete pendingHighImpact[key];
  for (const key of Object.keys(confirmInput)) delete confirmInput[key];
}

function close(): void {
  emit("update:modelValue", false);
}

function cancel(): void {
  if (submitting.value) return;
  close();
  emit("cancel");
}

function confirm(): void {
  const allowedTools = [...selectedAutomation.value, ...confirmedHighImpact()];
  emit("confirm", {
    allowedTools,
    autoApproveTools: toolsEnabled.value,
    allowSkills: allowSkills.value,
    allowMcp: allowMcp.value,
    allowSubagents: allowSubagents.value,
  });
}

// Exposed for component tests (drive approval state without DOM interaction).
defineExpose({
  toolsEnabled,
  allowSkills,
  allowMcp,
  allowSubagents,
  selectedAutomation,
  pendingHighImpact,
  confirmInput,
  confirmedHighImpact,
});
</script>
