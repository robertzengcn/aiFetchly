<template>
  <div class="v2-tool-approval-selector">
    <v-select
      :model-value="modelValue"
      :items="modeItems"
      item-value="value"
      item-title="title"
      density="compact"
      :variant="compact ? 'solo' : 'outlined'"
      :flat="compact"
      :prepend-inner-icon="compact ? selectedIcon : undefined"
      :menu-icon="compact ? 'mdi-chevron-down' : undefined"
      :menu-props="compact ? { location: 'top start', minWidth: 272, maxWidth: 340 } : undefined"
      :list-props="compact ? { lines: false } : undefined"
      hide-details
      :disabled="disabled"
      :aria-label="compact ? approvalLabel : undefined"
      :data-testid="compact ? 'chat-permission-selector' : undefined"
      class="v2-tool-approval-selector__select"
      :class="{
        'chat-composer-select': compact,
        'v2-tool-approval-selector__select--full': compact && modelValue === 'full_access',
      }"
      @update:model-value="onChange"
    >
      <template #prepend-item>
        <v-list-item disabled density="compact" class="text-caption text-medium-emphasis">
          <v-icon start size="small">mdi-shield-check</v-icon>
          {{ approvalLabel }}
        </v-list-item>
        <v-divider class="mt-1 mb-1" />
      </template>
      <template v-if="compact" #selection="{ item }">
        <span class="chat-composer-select__label" :title="item.title">{{ item.title }}</span>
      </template>
      <template v-if="compact" #item="{ item, props: itemProps }">
        <v-list-item
          v-bind="itemProps"
          role="option"
          :aria-selected="item.value === modelValue"
        >
          <template #subtitle>
            <span class="v2-tool-approval-selector__description">{{ item.raw.description }}</span>
          </template>
        </v-list-item>
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
  compact?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: ChatToolApprovalMode): void;
}>();

const { t } = useI18n();

const showFullAccessConfirm = ref(false);
let pendingMode: ChatToolApprovalMode | null = null;

interface ApprovalModeItem {
  value: ChatToolApprovalMode;
  title: string;
  description: string;
  icon: string;
}

const approvalLabel = computed(
  (): string => t("aiChatV2.tool_approval_mode_label") || "Tool Approval",
);
const modeItems = computed((): ApprovalModeItem[] => [
  {
    value: "ask_for_approval",
    title: t("aiChatV2.tool_approval_mode_ask") || "Ask for approval",
    description:
      t("aiChatV2.tool_approval_mode_ask_desc") ||
      "Ask before tools that need permission.",
    icon: "mdi-shield-outline",
  },
  {
    value: "approve_for_me",
    title: t("aiChatV2.tool_approval_mode_auto") || "Approve for me",
    description:
      t("aiChatV2.tool_approval_mode_auto_desc") ||
      "Auto-approve trusted non-shell tools in this chat.",
    icon: "mdi-shield-check-outline",
  },
  {
    value: "full_access",
    title: t("aiChatV2.tool_approval_mode_full") || "Full access",
    description:
      t("aiChatV2.tool_approval_mode_full_desc") ||
      "Auto-approve registered tools in this chat. Safety blocks still apply.",
    icon: "mdi-shield-alert-outline",
  },
]);
const selectedIcon = computed(
  (): string | undefined =>
    modeItems.value.find((item) => item.value === props.modelValue)?.icon,
);

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
.v2-tool-approval-selector__select.chat-composer-select {
  min-inline-size: 0;
  max-inline-size: min(100%, 14rem);
}
.v2-tool-approval-selector__select--full {
  --chat-select-icon-color: var(--app-warning);
}
.v2-tool-approval-selector__description {
  display: block;
  white-space: normal;
  line-height: 1.4;
}
</style>

<style scoped src="./composerSelect.css"></style>
