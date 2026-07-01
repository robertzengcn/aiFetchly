<template>
  <div class="v2-tool-approval-selector">
    <v-select
      :model-value="modelValue"
      :items="modeItems"
      item-value="value"
      item-title="title"
      density="compact"
      variant="outlined"
      hide-details
      :disabled="disabled"
      class="v2-tool-approval-selector__select"
      @update:model-value="onChange"
    >
      <template #prepend-item>
        <v-list-item disabled density="compact" class="text-caption text-medium-emphasis">
          <v-icon start size="small">mdi-shield-check</v-icon>
          {{ t("aiChatV2.tool_approval_mode_label") || "Tool Approval" }}
        </v-list-item>
        <v-divider class="mt-1 mb-1" />
      </template>
    </v-select>

    <v-dialog v-model="showFullAccessConfirm" max-width="420">
      <v-card>
        <v-card-title>
          {{ t("aiChatV2.tool_approval_mode_full_confirm_title") || "Enable Full Access?" }}
        </v-card-title>
        <v-card-text class="text-body-2">
          {{ t("aiChatV2.tool_approval_mode_full_confirm_text") || "Registered tools will run without approval prompts in this chat. Dependency installs and hard safety blocks still require your approval." }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="cancelFullAccess">
            {{ t("aiChatV2.tool_approval_mode_full_cancel") || "Cancel" }}
          </v-btn>
          <v-btn color="warning" variant="flat" @click="confirmFullAccess">
            {{ t("aiChatV2.tool_approval_mode_full_enable") || "Enable Full Access" }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { ChatToolApprovalMode } from "@/entityTypes/aiChatV2Types";

const props = defineProps<{
  modelValue: ChatToolApprovalMode;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: ChatToolApprovalMode): void;
}>();

const { t } = useI18n();

const showFullAccessConfirm = ref(false);
let pendingMode: ChatToolApprovalMode | null = null;

const modeItems = computed(() => [
  {
    value: "ask_for_approval" as ChatToolApprovalMode,
    title: t("aiChatV2.tool_approval_mode_ask") || "Ask for approval",
  },
  {
    value: "approve_for_me" as ChatToolApprovalMode,
    title: t("aiChatV2.tool_approval_mode_auto") || "Approve for me",
  },
  {
    value: "full_access" as ChatToolApprovalMode,
    title: t("aiChatV2.tool_approval_mode_full") || "Full access",
  },
]);

const onChange = (value: unknown): void => {
  if (
    value !== "ask_for_approval" &&
    value !== "approve_for_me" &&
    value !== "full_access"
  ) {
    return;
  }
  if (value === "full_access" && props.modelValue !== "full_access") {
    pendingMode = value;
    showFullAccessConfirm.value = true;
    return;
  }
  emit("update:modelValue", value);
};

function confirmFullAccess(): void {
  showFullAccessConfirm.value = false;
  if (pendingMode) {
    emit("update:modelValue", pendingMode);
    pendingMode = null;
  }
}

function cancelFullAccess(): void {
  showFullAccessConfirm.value = false;
  pendingMode = null;
}
</script>

<style scoped>
.v2-tool-approval-selector {
  display: flex;
  align-items: center;
}
.v2-tool-approval-selector__select {
  min-width: 100px;
  max-width: 140px;
}
</style>
