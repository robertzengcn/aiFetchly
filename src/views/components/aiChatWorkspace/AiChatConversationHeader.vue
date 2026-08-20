<template>
  <header class="conversation-header" data-testid="workspace-conversation-header">
    <!-- FR-008: real title with New chat fallback. No robot icon, no
         "AI Assistant" string (FR-007). -->
    <h1 class="header-title" :title="displayTitle" data-testid="workspace-header-title">
      {{ displayTitle }}
    </h1>

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
            :title="t('workspaceChat.header.compact') || 'Compact conversation'"
            prepend-icon="mdi-collapse-all-outline"
            data-testid="workspace-overflow-compact"
            @click="emit('compact')"
          />
          <v-divider role="separator" />
          <v-list-item
            role="menuitem"
            class="destructive"
            :title="t('workspaceChat.header.clear') || 'Clear messages'"
            prepend-icon="mdi-eraser-variant"
            data-testid="workspace-overflow-clear"
            @click="emit('clear')"
          />
          <v-list-item
            role="menuitem"
            class="destructive"
            :title="t('workspaceChat.header.delete') || 'Delete chat'"
            prepend-icon="mdi-delete-outline"
            data-testid="workspace-overflow-delete"
            @click="emit('delete')"
          />
        </v-list>
      </v-menu>
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
}>();

const emit = defineEmits<{
  (e: "toggle-inspector"): void;
  (e: "open-status"): void;
  (e: "rename"): void;
  (e: "compact"): void;
  (e: "clear"): void;
  (e: "delete"): void;
}>();

const { t } = useI18n();

const displayTitle = computed(
  () => props.title?.trim() || (t("workspaceChat.newChat") || "New chat")
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
