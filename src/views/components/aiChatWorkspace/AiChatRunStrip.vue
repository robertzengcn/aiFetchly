<template>
  <!-- Contextual run strip (PRD §13.3): appears only when relevant. -->
  <div
    v-if="visible"
    class="run-strip"
    role="status"
    data-testid="workspace-run-strip"
  >
    <WorkspaceStatusIndicator :visual="visual" />
    <span class="run-strip-label">{{ label }}</span>
    <div class="run-strip-actions">
      <button
        v-if="cancellable"
        type="button"
        class="strip-action"
        data-testid="workspace-run-strip-stop"
        @click="emit('stop')"
      >
        {{ t('workspaceChat.runStrip.stop') || 'Stop' }}
      </button>
      <button
        type="button"
        class="strip-action disclosure"
        data-testid="workspace-run-strip-details"
        @click="emit('open-details')"
      >
        {{ t('workspaceChat.runStrip.details') || 'Details' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ConversationRuntimeStatus } from "@/entityTypes/aiChatWorkspaceTypes";
import WorkspaceStatusIndicator from "./WorkspaceStatusIndicator.vue";
import {
  conversationStatusVisual,
  type ConversationStatusVisual,
} from "./workspaceStatusUtil";

const props = defineProps<{
  runtimeStatus: ConversationRuntimeStatus;
  recovering: boolean;
}>();

const emit = defineEmits<{
  (e: "stop"): void;
  (e: "open-details"): void;
}>();

const { t } = useI18n();

/** The strip disappears when no special run state exists (PRD §13.3.3). */
const visible = computed(
  () =>
    props.runtimeStatus === "running" ||
    props.runtimeStatus === "queued" ||
    props.runtimeStatus === "awaiting_permission" ||
    props.runtimeStatus === "awaiting_user" ||
    props.runtimeStatus === "failed" ||
    props.runtimeStatus === "interrupted" ||
    props.recovering
);

const cancellable = computed(
  () => props.runtimeStatus === "running" || props.runtimeStatus === "queued"
);

const visual = computed<ConversationStatusVisual>(() =>
  conversationStatusVisual({
    runtimeStatus: props.runtimeStatus,
    attention: "none",
    unread: false,
  })
);

const label = computed(() => {
  if (props.recovering) {
    return t("workspaceChat.runStrip.recovering") || "Recovering";
  }
  const map: Record<string, { key: string; fallback: string }> = {
    running: { key: "workspaceChat.runStrip.running", fallback: "Working…" },
    queued: { key: "workspaceChat.runStrip.queued", fallback: "Queued" },
    awaiting_permission: {
      key: "workspaceChat.runStrip.permission",
      fallback: "Waiting for approval",
    },
    awaiting_user: {
      key: "workspaceChat.runStrip.userInput",
      fallback: "Waiting for your answer",
    },
    failed: { key: "workspaceChat.runStrip.failed", fallback: "Failed" },
    interrupted: {
      key: "workspaceChat.runStrip.interrupted",
      fallback: "Interrupted",
    },
  };
  const entry = map[props.runtimeStatus];
  if (!entry) return "";
  return t(entry.key) || entry.fallback;
});
</script>

<style scoped>
.run-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 12px;
  padding: 6px 12px;
  border: 1px solid rgba(var(--v-theme-primary), 0.35);
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.07);
  font-size: 13px;
  flex-shrink: 0;
}

.run-strip-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-strip-actions {
  display: flex;
  gap: 6px;
}

.strip-action {
  border: none;
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

.strip-action.disclosure {
  background: transparent;
  color: rgb(var(--v-theme-primary));
  border: 1px solid rgba(var(--v-theme-primary), 0.4);
}

.strip-action:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}
</style>
