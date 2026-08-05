<template>
  <v-dialog
    :model-value="modelValue"
    max-width="560"
    persistent
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2" color="primary">mdi-shield-lock-outline</v-icon>
        <span>
          {{ t("aiChatV2.scheduledLoop.toolApprovalTitle") || "Approve unattended tools" }}
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
            "Scheduled loops run without supervision. Optionally approve read-only tools the loop may use. Sending email, drafts, shell, file writes, and subagents stay blocked."
          }}
        </p>

        <v-alert type="info" variant="tonal" density="compact" class="mb-3">
          {{
            t("aiChatV2.scheduledLoop.toolApprovalCommand") || "Command"
          }}: <code>{{ rawCommand }}</code>
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
          <div
            v-if="readOnlyTools.length === 0"
            class="pa-4 text-center text-grey text-caption"
          >
            {{
              t("aiChatV2.scheduledLoop.noReadOnlyTools") ||
              "No read-only tools are available."
            }}
          </div>
          <v-select
            v-else
            v-model="selectedTools"
            :items="readOnlyTools"
            item-title="name"
            item-value="name"
            :label="
              t('aiChatV2.scheduledLoop.allowedTools') || 'Allowed read-only tools'
            "
            :placeholder="
              t('aiChatV2.scheduledLoop.allowedToolsHint') ||
              'Optionally select tools the loop may run'
            "
            multiple
            chips
            closable-chips
            density="compact"
            variant="outlined"
          >
            <template v-slot:item="{ props: itemProps, item }">
              <v-list-item v-bind="itemProps">
                <v-list-item-subtitle class="text-caption">
                  {{ item.raw.description }}
                </v-list-item-subtitle>
              </v-list-item>
            </template>
          </v-select>

          <v-switch
            v-model="autoApprove"
            :disabled="selectedTools.length === 0"
            :label="
              t('aiChatV2.scheduledLoop.autoApprove') ||
              'Run approved tools without asking'
            "
            color="warning"
            density="compact"
            hide-details
          />
          <v-alert
            v-if="autoApprove && selectedTools.length > 0"
            type="warning"
            variant="tonal"
            density="compact"
            class="mt-2"
          >
            {{
              t("aiChatV2.scheduledLoop.autoApproveWarning") ||
              "These tools will run automatically on every occurrence while the loop is active."
            }}
          </v-alert>
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
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { listAvailableAiMessageTaskTools } from "@/views/api/aiMessageTask";
import type { SchedulableAiToolSummary } from "@/entityTypes/aiMessageTaskTypes";

const props = defineProps<{
  modelValue: boolean;
  rawCommand: string;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (
    e: "confirm",
    payload: { allowedTools: string[]; autoApproveTools: boolean }
  ): void;
  (e: "cancel"): void;
}>();

const { t } = useI18n();

const loading = ref(false);
const submitting = ref(false);
const loadError = ref<string | null>(null);
const readOnlyTools = ref<SchedulableAiToolSummary[]>([]);
const selectedTools = ref<string[]>([]);
const autoApprove = ref(false);

async function loadTools(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const all = await listAvailableAiMessageTaskTools();
    readOnlyTools.value = all.filter((tool) => tool.schedulable);
  } catch (err) {
    loadError.value =
      err instanceof Error ? err.message : "Failed to load available tools.";
    readOnlyTools.value = [];
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      selectedTools.value = [];
      autoApprove.value = false;
      void loadTools();
    }
  },
  { immediate: true }
);

function close(): void {
  emit("update:modelValue", false);
}

function cancel(): void {
  if (submitting.value) return;
  close();
  emit("cancel");
}

function confirm(): void {
  emit("confirm", {
    allowedTools: selectedTools.value,
    autoApproveTools: autoApprove.value && selectedTools.value.length > 0,
  });
}

// Exposed for component tests (drive the approval state without a full DOM
// interaction). Not part of the public dialog contract.
defineExpose({ selectedTools, autoApprove });
</script>
