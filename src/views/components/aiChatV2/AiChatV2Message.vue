<template>
  <!-- Plan approval card renders inline (no bubble wrapper) -->
  <div v-if="isPlanCard" class="v2-message v2-message--plan">
    <AiChatV2PlanApprovalCard
      :plan-state="message.metadata!.planStateView!"
      :disabled="disabled"
      @approve="emit('approve-plan')"
      @reject="(fb) => emit('reject-plan', fb)"
      @request-changes="(fb) => emit('request-plan-changes', fb)"
    />
  </div>
  <div v-else class="v2-message" :class="`v2-message--${message.role}`">
    <div class="v2-message__bubble">
      <div class="v2-message__role">{{ roleLabel }}</div>
      <template v-if="message.messageType === MessageType.TOOL_CALL">
        <div class="v2-message__tool-header">
          <v-icon size="small" color="purple" class="mr-1">mdi-toolbox</v-icon>
          <strong>{{ t("aiChatV2.tool_call_title") || "Tool Call" }}</strong>
        </div>
        <div v-if="message.metadata?.toolName" class="v2-message__tool-field">
          <strong>{{ t("aiChatV2.tool_name") || "Tool" }}:</strong>
          <span>{{ message.metadata.toolName }}</span>
          <span
            v-if="toolProgress"
            class="tool-progress-badge"
            style="margin-left: 8px; display: inline-flex; align-items: center; gap: 4px;"
          >
            <v-icon size="small" class="mdi-spin">mdi-loading</v-icon>
            <span class="text-caption">{{
              toolProgress.message ||
              t("aiChatV2.tool_running") ||
              "Running..."
            }}</span>
            <span
              v-if="
                typeof toolProgress.partialCount === 'number' &&
                typeof toolProgress.expectedCount === 'number'
              "
              class="text-caption"
            >
              ({{ toolProgress.partialCount }}/{{ toolProgress.expectedCount }})
            </span>
          </span>
        </div>
        <v-progress-linear
          v-if="toolProgress && typeof toolProgress.progress === 'number'"
          :model-value="Math.round(toolProgress.progress * 100)"
          height="4"
          style="margin-top: 4px;"
        />
        <details v-if="message.metadata?.toolArguments" class="v2-message__details">
          <summary>{{ t("aiChatV2.tool_arguments") || "Arguments" }}</summary>
          <pre>{{ JSON.stringify(message.metadata.toolArguments, null, 2) }}</pre>
        </details>
      </template>
      <template v-else-if="message.messageType === MessageType.TOOL_RESULT">
        <SkillApprovalCard
          v-if="needsPermissionPrompt"
          :tool-name="String(message.metadata?.toolName || '')"
          :permission-category="String(toolResult.permissionCategory || '')"
          :shell-preview="shellPreview"
          :workspace-root="workspaceRoot"
          @grant="(payload) => emit('grant-permission', message, payload)"
          @deny="emit('deny-permission', message)"
        />
        <template v-else>
          <div class="v2-message__tool-header">
            <v-icon
              size="small"
              :color="message.metadata?.success === false ? 'error' : 'success'"
              class="mr-1"
            >
              {{ message.metadata?.success === false ? 'mdi-alert-circle' : 'mdi-check-circle' }}
            </v-icon>
            <strong>{{ t("aiChatV2.tool_result_title") || "Tool Result" }}</strong>
          </div>
          <div v-if="message.metadata?.toolName" class="v2-message__tool-field">
            <strong>{{ t("aiChatV2.tool_name") || "Tool" }}:</strong>
            <span>{{ message.metadata.toolName }}</span>
          </div>
          <div v-if="message.metadata?.error" class="v2-message__tool-error">
            {{ message.metadata.error }}
          </div>
          <div v-if="message.metadata?.summary" class="v2-message__content">
            {{ message.metadata.summary }}
          </div>
          <details v-if="message.content" class="v2-message__details">
            <summary>{{ t("aiChatV2.tool_result_details") || "Details" }}</summary>
            <pre>{{ message.content }}</pre>
          </details>
        </template>
      </template>
      <div v-else class="v2-message__content">{{ message.content }}</div>
      <AiChatV2StreamStatus
        v-if="message.role === 'assistant' && status !== 'idle'"
        :status="status"
        :error-message="errorMessage"
      />
      <div
        v-if="message.role === 'user' && mentionChips.length > 0"
        class="v2-message__mentions"
      >
        <span
          v-for="(chip, index) in mentionChips"
          :key="`${chip.variant}-${index}`"
          class="v2-mention-chip"
          :class="{ 'v2-mention-chip--warning': chip.variant === 'warning' }"
        >
          <v-icon size="x-small">{{ chip.icon }}</v-icon>
          <span v-if="chip.label" class="v2-mention-chip__label">{{
            chip.label
          }}</span>
          <span
            v-if="chip.reason"
            class="v2-mention-chip__reason"
          >
            {{ chip.reason }}
          </span>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import type { ChatV2AtMentionMetadata } from "@/entityTypes/aiChatAtMentionTypes";
import { MessageType } from "@/entityTypes/commonType";
import SkillApprovalCard from "@/views/components/aiChat/SkillApprovalCard.vue";
import AiChatV2StreamStatus from "./AiChatV2StreamStatus.vue";
import AiChatV2PlanApprovalCard from "./AiChatV2PlanApprovalCard.vue";

type Status = "idle" | "streaming" | "cancelled" | "error";
type ShellPreview = {
  command: string;
  cwd?: string;
  shell: string;
  timeout_ms: number;
};

const props = defineProps<{
  message: ChatV2MessageView;
  status?: Status;
  errorMessage?: string;
  disabled?: boolean;
  workspaceRoot?: string;
}>();
const emit = defineEmits<{
  (
    e: "grant-permission",
    message: ChatV2MessageView,
    payload: { persistent: boolean }
  ): void;
  (e: "deny-permission", message: ChatV2MessageView): void;
  (e: "approve-plan"): void;
  (e: "reject-plan", feedback: string): void;
  (e: "request-plan-changes", feedback: string): void;
}>();
const { t, te } = useI18n();

const isPlanCard = computed(
  () => props.message.metadata?.planStateView !== undefined
);

const roleLabel = computed(() => {
  if (props.message.role === "user") {
    return te("common.user") ? t("common.user") : "You";
  }
  if (props.message.role === "assistant") return "AI";
  return props.message.role;
});

const status = computed<Status>(() => props.status ?? "idle");
const disabled = computed(() => props.disabled ?? false);

const toolResult = computed<Record<string, unknown>>(
  () => props.message.metadata?.toolResult ?? {}
);

interface ToolProgressView {
  phase: string;
  message?: string;
  progress: number | null;
  partialCount: number | null;
  expectedCount: number | null;
  updatedAt: number;
}

const toolProgress = computed<ToolProgressView | null>(() => {
  const meta = props.message.metadata as
    | { toolProgress?: ToolProgressView }
    | undefined;
  return meta?.toolProgress ?? null;
});

const needsPermissionPrompt = computed(
  () => toolResult.value.needsPermissionPrompt === true
);

const shellPreview = computed<ShellPreview | undefined>(() => {
  const preview = toolResult.value.shellPreview;
  if (!preview || typeof preview !== "object") {
    return undefined;
  }
  const shellData = preview as Record<string, unknown>;
  if (
    typeof shellData.command !== "string" ||
    typeof shellData.shell !== "string" ||
    typeof shellData.timeout_ms !== "number"
  ) {
    return undefined;
  }
  return {
    command: shellData.command,
    cwd: typeof shellData.cwd === "string" ? shellData.cwd : undefined,
    shell: shellData.shell,
    timeout_ms: shellData.timeout_ms,
  };
});

interface MentionChip {
  variant: "resolved" | "warning";
  icon: string;
  label: string;
  reason?: string;
}

function mentionChipLabel(m: ChatV2AtMentionMetadata): string {
  let label = m.relativePath;
  if (m.kind === "directory" && !label.endsWith("/")) label += "/";
  if (m.lineStart) {
    label +=
      m.lineEnd && m.lineEnd !== m.lineStart
        ? ` L${m.lineStart}-${m.lineEnd}`
        : ` L${m.lineStart}`;
  }
  return label;
}

function mentionWarningReason(
  status: ChatV2AtMentionMetadata["status"]
): string | undefined {
  switch (status) {
    case "missing":
      return (
        t("aiChatV2.atMentions.fileNotFound") ||
        "File not found in this workspace."
      );
    case "rejected":
      return (
        t("aiChatV2.atMentions.outsideWorkspace") ||
        "Mention is outside the approved workspace."
      );
    case "invalid_line_range":
      return (
        t("aiChatV2.atMentions.invalidLineRange") ||
        "Line range must start before it ends."
      );
    case "binary":
      return t("aiChatV2.atMentions.binaryFile") || "Binary file";
    case "too_large":
      return t("aiChatV2.atMentions.tooLarge") || "File is too large to include.";
    case "workspace_required":
      return (
        t("aiChatV2.atMentions.noWorkspace") ||
        "Choose a workspace to mention files."
      );
    case "too_many_mentions":
      return (
        t("aiChatV2.atMentions.tooManyMentions") || "Too many mentions."
      );
    default:
      return "Could not be resolved.";
  }
}

const mentionChips = computed<MentionChip[]>(() => {
  if (props.message.role !== "user") return [];
  const meta = props.message.metadata as
    | { atMentions?: ChatV2AtMentionMetadata[] }
    | undefined;
  const mentions = meta?.atMentions;
  if (!mentions || mentions.length === 0) return [];
  return mentions.map(
    (m): MentionChip => {
      const label = mentionChipLabel(m);
      if (m.status === "resolved") {
        return {
          variant: "resolved",
          icon:
            m.kind === "directory"
              ? "mdi-folder-outline"
              : "mdi-file-document-outline",
          label,
        };
      }
      return {
        variant: "warning",
        icon: "mdi-alert-circle-outline",
        label,
        reason: mentionWarningReason(m.status),
      };
    }
  );
});
</script>

<style scoped>
.v2-message {
  display: flex;
  margin: 8px 0;
}
.v2-message--plan {
  justify-content: stretch;
}
.v2-message--user {
  justify-content: flex-end;
}
.v2-message--assistant,
.v2-message--system,
.v2-message--tool {
  justify-content: flex-start;
}
.v2-message__bubble {
  max-width: 80%;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.04);
  word-break: break-word;
}
.v2-message--user .v2-message__bubble {
  background: rgba(25, 118, 210, 0.12);
}
.v2-message__role {
  font-size: 11px;
  opacity: 0.6;
  margin-bottom: 2px;
}
.v2-message__content {
  white-space: pre-wrap;
  line-height: 1.45;
}
.v2-message__tool-header {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}
.v2-message__tool-field {
  display: flex;
  gap: 6px;
  font-size: 13px;
  margin-bottom: 6px;
}
.v2-message__tool-error {
  color: rgb(var(--v-theme-error));
  margin-bottom: 6px;
  white-space: pre-wrap;
}
.v2-message__details summary {
  cursor: pointer;
  font-size: 13px;
  margin-bottom: 4px;
}
.v2-message__details pre {
  margin: 0;
  white-space: pre-wrap;
  font-size: 12px;
}
.v2-message__mentions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
.v2-mention-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 11px;
  background: rgba(25, 118, 210, 0.12);
  color: rgba(0, 0, 0, 0.7);
}
.v2-mention-chip--warning {
  background: rgba(var(--v-theme-error), 0.12);
}
.v2-mention-chip__label {
  font-family: monospace;
}
.v2-mention-chip__reason {
  opacity: 0.75;
  font-size: 10px;
}
</style>
