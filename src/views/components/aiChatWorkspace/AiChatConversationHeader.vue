<template>
  <header class="conversation-header" data-testid="workspace-conversation-header">
    <!-- FR-008: real title with New chat fallback. No robot icon, no
         "AI Assistant" string (FR-007). -->
    <h1 class="header-title" :title="displayTitle" data-testid="workspace-header-title">
      {{ displayTitle }}
    </h1>

    <!-- Run-strip removal (2026-10-26 design): goal/loop state keep their
         home here as display-only chips beside the title, reusing the
         strip's i18n keys so the six-language translations stay stable. -->
    <span
      v-if="goalObjective"
      class="header-chip"
      data-testid="workspace-header-goal"
      >{{ t("workspaceChat.runStrip.goal", { objective: goalObjective }) || `Goal: ${goalObjective}` }}</span
    >
    <span
      v-if="loopLabel"
      class="header-chip"
      data-testid="workspace-header-loop"
      >{{ loopLabel }}</span
    >

    <!-- FR-009: at most ONE summarized status, clickable into Activity. -->
    <button
      v-if="statusLabel"
      type="button"
      class="header-status"
      data-testid="workspace-header-status"
      @click="emit('open-status')"
    >
      <WorkspaceStatusIndicator :visual="statusVisual" />
      <span>{{ statusLabel }}</span>
    </button>

    <div class="header-actions">
      <!-- FR-010/FR-011: infrequent conversation actions only; destructive
           actions live in a separated section (PRD §11.5). -->
      <v-menu location="bottom end">
        <template #activator="{ props: menuProps }">
          <button
            v-bind="menuProps"
            type="button"
            class="icon-button"
            :aria-label="t('workspaceChat.header.overflow') || 'Conversation menu'"
            data-testid="workspace-header-overflow"
          >
            <v-icon icon="mdi-dots-horizontal" size="20" aria-hidden="true" />
          </button>
        </template>
        <v-list density="compact" role="menu">
          <v-list-item
            role="menuitem"
            :title="t('workspaceChat.header.rename') || 'Rename chat'"
            prepend-icon="mdi-pencil-outline"
            data-testid="workspace-overflow-rename"
            @click="emit('rename')"
          />
          <v-list-item
            role="menuitem"
            :title="t('workspaceChat.header.export') || 'Export conversation'"
            prepend-icon="mdi-download-outline"
            data-testid="workspace-overflow-export"
            @click="emit('export')"
          />
          <v-list-item
            role="menuitem"
            :title="t('workspaceChat.header.duplicate') || 'Duplicate conversation'"
            prepend-icon="mdi-content-copy"
            data-testid="workspace-overflow-duplicate"
            @click="emit('duplicate')"
          />
          <v-list-item
            role="menuitem"
            :title="t('workspaceChat.header.compact') || 'Compact conversation'"
            prepend-icon="mdi-collapse-all-outline"
            data-testid="workspace-overflow-compact"
            @click="emit('compact')"
          />
          <v-list-item
            role="menuitem"
            :title="
              t('workspaceChat.header.backgroundAgents') || 'Background Agents'
            "
            prepend-icon="mdi-account-group"
            data-testid="workspace-overflow-agent-tasks"
            @click="emit('open-agent-tasks')"
          />
          <v-divider role="separator" />
          <v-list-item
            role="menuitem"
            class="destructive"
            :title="t('workspaceChat.header.clear') || 'Clear messages'"
            prepend-icon="mdi-eraser-variant"
            data-testid="workspace-overflow-clear"
            :disabled="isWriteDisabled"
            @click="emit('clear')"
          />
          <v-list-item
            role="menuitem"
            class="destructive"
            :title="t('workspaceChat.header.delete') || 'Delete chat'"
            prepend-icon="mdi-delete-outline"
            data-testid="workspace-overflow-delete"
            :disabled="isWriteDisabled"
            @click="emit('delete')"
          />
        </v-list>
      </v-menu>

      <!-- Sidebar (inspector) toggle — moved RIGHT of the "..." menu
           (run-strip removal, 2026-10-26 design): one always-rendered
           affordance that opens/hides the right-hand side panel. -->
      <v-tooltip :text="inspectorTooltip" location="bottom">
        <template #activator="{ props: tooltipProps }">
          <button
            v-bind="tooltipProps"
            type="button"
            class="icon-button"
            :aria-label="inspectorTooltip"
            :aria-pressed="inspectorOpen"
            data-testid="workspace-inspector-toggle"
            @click="emit('toggle-inspector')"
          >
            <v-icon
              :icon="inspectorOpen ? 'mdi-panel-right' : 'mdi-panel-right-close'"
              size="20"
              aria-hidden="true"
            />
          </button>
        </template>
      </v-tooltip>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ConversationRuntimeStatus } from "@/entityTypes/aiChatWorkspaceTypes";
import WorkspaceStatusIndicator from "./WorkspaceStatusIndicator.vue";
import {
  conversationStatusVisual,
  headerStatusFor,
  type ConversationStatusVisual,
} from "./workspaceStatusUtil";

const props = defineProps<{
  title: string | null;
  runtimeStatus: ConversationRuntimeStatus;
  recovering: boolean;
  activeToolCount: number;
  inspectorOpen: boolean;
  hasConversation: boolean;
  /** Active goal objective, when shared orchestration exposes one. */
  goalObjective?: string | null;
  /** Active/paused scheduled-loop status, when one exists. */
  loopStatus?: string | null;
}>();

const emit = defineEmits<{
  (e: "toggle-inspector"): void;
  (e: "open-status"): void;
  (e: "rename"): void;
  (e: "compact"): void;
  (e: "export"): void;
  (e: "duplicate"): void;
  (e: "open-agent-tasks"): void;
  (e: "clear"): void;
  (e: "delete"): void;
}>();

const { t } = useI18n();

const displayTitle = computed(
  () => props.title?.trim() || (t("workspaceChat.newChat") || "New chat")
);

// B03 + P1-1 (FR-LIF-005): disable Delete AND Clear while the conversation
// can still receive writes (running, queued, parked on permission/question).
// The main-process IPC guard (getConversationBusyReason) is authoritative;
// this only prevents the unsafe click. Matches the center surface's
// onDelete/onClear busy+parked checks (selectedStore.isBusy / isParked).
const isWriteDisabled = computed(() =>
  ["running", "queued", "awaiting_permission", "awaiting_user"].includes(
    props.runtimeStatus
  )
);

const headerStatus = computed(() =>
  headerStatusFor({
    runtimeStatus: props.runtimeStatus,
    recovering: props.recovering,
    activeToolCount: props.activeToolCount,
  })
);

const statusLabel = computed(
  () =>
    (headerStatus.value &&
      (t(headerStatus.value.labelKey) || headerStatus.value.fallback)) ||
    ""
);

const statusVisual = computed<ConversationStatusVisual>(() => {
  const base = conversationStatusVisual({
    runtimeStatus: props.runtimeStatus,
    attention: "none",
    unread: false,
  });
  if (props.runtimeStatus === "running") return base;
  if (props.runtimeStatus === "awaiting_permission") return base;
  if (props.runtimeStatus === "awaiting_user") return base;
  if (props.runtimeStatus === "failed") return base;
  if (props.runtimeStatus === "queued") return base;
  return {
    icon: "",
    spinning: false,
    labelKey: "workspaceChat.status.idle",
    fallback: "",
  };
});

const inspectorTooltip = computed(() =>
  t("workspaceChat.inspector.toggle") || "Toggle inspector"
);

/** Scheduled-loop state wording (moved out of the deleted run strip). */
const loopLabel = computed(() => {
  if (!props.loopStatus) return "";
  const map: Record<string, { key: string; fallback: string }> = {
    running: {
      key: "workspaceChat.runStrip.loopRunning",
      fallback: "Scheduled loop running",
    },
    paused: {
      key: "workspaceChat.runStrip.loopPaused",
      fallback: "Scheduled loop paused",
    },
  };
  const entry = map[props.loopStatus];
  return entry ? t(entry.key) || entry.fallback : props.loopStatus;
});
</script>

<style scoped>
.conversation-header {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 0 12px;
  border-bottom: 1px solid rgba(var(--v-border-color, 0, 0, 0), 0.12);
  flex-shrink: 0;
}

.header-title {
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 40%;
  margin: 0;
}

.header-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(var(--v-border-color, 0, 0, 0), 0.15);
  border-radius: 999px;
  background: rgba(var(--v-theme-surface), 1);
  color: rgba(var(--v-theme-on-surface), 0.8);
  font-size: 12px;
  padding: 3px 10px;
  cursor: pointer;
}

.header-status:hover {
  background: rgba(var(--v-theme-on-surface), 0.05);
}

/* Display-only chip (goal / scheduled-loop state moved out of the run
   strip): the status-pill visual language minus any interaction affordance
   — no hover, no pointer cursor, text carries the meaning (non-color). */
.header-chip {
  display: inline-flex;
  align-items: center;
  border: 1px solid rgba(var(--v-border-color, 0, 0, 0), 0.15);
  border-radius: 999px;
  background: rgba(var(--v-theme-surface), 1);
  color: rgba(var(--v-theme-on-surface), 0.75);
  font-size: 11.5px;
  font-weight: 500;
  padding: 3px 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}

.header-status:focus-visible,
.icon-button:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}

.header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
}

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.75);
  cursor: pointer;
}

.icon-button:hover {
  background: rgba(var(--v-theme-on-surface), 0.07);
}

.destructive {
  color: rgb(var(--v-theme-error));
}
</style>
