<template>
  <!-- One evolving row per tool-call identity (FR-042): status changes in
       place; no separate generic result card is appended. -->
  <div
    class="execution-row"
    :class="`status-${execution.status}`"
    :data-testid="`workspace-execution-row-${execution.status}`"
  >
    <WorkspaceStatusIndicator :visual="rowVisual" />
    <span class="row-main">
      <!-- Primary label: human-readable action (FR-045). -->
      <span class="row-label">{{ actionLabel }}</span>
      <!-- Raw tool name: secondary monospace metadata for experts. -->
      <span v-if="rawNameShown" class="row-tool-name">{{ execution.toolName }}</span>
      <SemanticToolResult
        v-if="terminal"
        :output-kind="execution.outputKind"
        :summary="execution.summary"
        :is-error="execution.isError"
      />
    </span>
    <span class="row-meta">
      <span v-if="progressLabel" class="row-progress">{{ progressLabel }}</span>
      <span v-if="execution.durationMs !== undefined" class="row-duration">
        {{ (execution.durationMs / 1000).toFixed(1) }}s
      </span>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ToolExecutionStatus, ToolExecutionView } from "./toolExecutionProjection";
import { actionLabelFor, UNKNOWN_TOOL_LABEL_KEY } from "./toolExecutionProjection";
import WorkspaceStatusIndicator from "./WorkspaceStatusIndicator.vue";
import SemanticToolResult from "./SemanticToolResult.vue";
import { conversationStatusVisual, type ConversationStatusVisual } from "./workspaceStatusUtil";

const props = defineProps<{
  execution: ToolExecutionView;
}>();

const { t } = useI18n();

const TERMINAL: ToolExecutionStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "interrupted",
];

const terminal = computed(() => TERMINAL.includes(props.execution.status));

const actionLabel = computed(() => {
  const known = actionLabelFor(props.execution.toolName);
  if (known) return known;
  if (props.execution.isLegacyUnpaired) {
    return (
      t("workspaceChat.execution.legacyReceipt") || "Previous tool activity"
    );
  }
  return (
    t(UNKNOWN_TOOL_LABEL_KEY, { tool: props.execution.toolName }) ||
    `Running ${props.execution.toolName}`
  );
});

const rawNameShown = computed(
  () => Boolean(props.execution.toolName) && !props.execution.isLegacyUnpaired
);

const progressLabel = computed(() => {
  if (typeof props.execution.progress === "number") {
    return `${Math.round(props.execution.progress * 100)}%`;
  }
  if (
    typeof props.execution.partialCount === "number" &&
    typeof props.execution.expectedCount === "number"
  ) {
    return `${props.execution.partialCount}/${props.execution.expectedCount}`;
  }
  return "";
});

const rowVisual = computed<ConversationStatusVisual>(() => {
  const map: Partial<Record<ToolExecutionStatus, ConversationStatusVisual>> = {
    completed: {
      icon: "mdi-check-circle-outline",
      spinning: false,
      labelKey: "workspaceChat.status.completed",
      fallback: "Completed",
    },
    failed: {
      icon: "mdi-close-circle-outline",
      spinning: false,
      labelKey: "workspaceChat.status.failed",
      fallback: "Failed",
    },
    cancelled: {
      icon: "mdi-stop-circle-outline",
      spinning: false,
      labelKey: "workspaceChat.status.cancelled",
      fallback: "Cancelled",
    },
    interrupted: {
      icon: "mdi-restore",
      spinning: false,
      labelKey: "workspaceChat.status.interrupted",
      fallback: "Interrupted",
    },
  };
  const specific = map[props.execution.status];
  if (specific) return specific;
  return conversationStatusVisual({
    runtimeStatus:
      props.execution.status === "awaiting_permission"
        ? "awaiting_permission"
        : props.execution.status === "awaiting_user"
          ? "awaiting_user"
          : "running",
    attention: "none",
    unread: false,
  });
});
</script>

<style scoped>
.execution-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 2px;
  font-size: 12.5px;
  border-radius: 6px;
}

.row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-tool-name {
  font-family: "JetBrains Mono", "Fira Code", Consolas, monospace;
  font-size: 10.5px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  flex-shrink: 0;
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.status-failed .row-label,
.status-failed .row-tool-name {
  color: rgb(var(--v-theme-error));
}
</style>
