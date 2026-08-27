<template>
  <aside
    class="workspace-sidebar"
    :aria-label="te('workspaceChat.sidebar.region') ? t('workspaceChat.sidebar.region') : 'Chat workspaces'"
  >
    <!-- Zone 1: fixed global navigation (PRD §10.1) -->
    <div class="sidebar-global-nav">
      <button
        type="button"
        class="global-nav-button primary-action"
        data-testid="workspace-new-chat"
        @click="emit('new-chat')"
      >
        <v-icon icon="mdi-plus" size="18" aria-hidden="true" />
        <span>{{ t('workspaceChat.newChat') || 'New chat' }}</span>
      </button>
      <div class="global-nav-search">
        <v-text-field
          v-model="searchModel"
          density="compact"
          variant="outlined"
          hide-details
          prepend-inner-icon="mdi-magnify"
          :aria-label="t('workspaceChat.search.placeholder') || 'Search conversations'"
          :placeholder="t('workspaceChat.search.placeholder') || 'Search conversations'"
          data-testid="workspace-search"
        />
      </div>
      <button
        type="button"
        class="global-nav-button"
        data-testid="workspace-automations"
        @click="goTo('/schedule')"
      >
        <v-icon icon="mdi-clock-fast" size="18" aria-hidden="true" />
        <span>{{ t('workspaceChat.automations') || 'Automations' }}</span>
      </button>
      <button
        type="button"
        class="global-nav-button"
        data-testid="workspace-customize"
        @click="goTo('/systemsetting/mcp')"
      >
        <v-icon icon="mdi-tune-variant" size="18" aria-hidden="true" />
        <span>{{ t('workspaceChat.customize') || 'Customize' }}</span>
      </button>
    </div>

    <!-- Zone 2: independently scrollable workspace hierarchy (PRD §10.2) -->
    <nav
      class="sidebar-tree"
      role="tree"
      :aria-label="t('workspaceChat.sidebar.region') || 'Chat workspaces'"
      data-testid="workspace-tree"
      @keydown="onTreeKeydown"
    >
      <p v-if="bootstrapError" class="sidebar-message error" role="alert">
        {{ t('workspaceChat.sidebar.loadError') || 'Failed to load workspaces' }}
        <button type="button" class="inline-action" @click="emit('retry')">
          {{ t('common.retry') || 'Retry' }}
        </button>
      </p>
      <p
        v-else-if="visibleGroups.length === 0 && visibleUnassigned.length === 0"
        class="sidebar-message"
      >
        {{ t('workspaceChat.sidebar.empty') || 'No conversations yet' }}
      </p>

      <section
        v-for="group in visibleGroups"
        :key="group.workspaceKey"
        class="workspace-group"
      >
        <button
          type="button"
          class="group-header"
          role="treeitem"
          data-nav-row="group"
          :data-workspace-key="group.workspaceKey"
          :aria-expanded="!group.collapsed"
          :aria-label="groupDisplayName(group)"
          @click="workspaceStore.toggleWorkspaceCollapsed(group.workspaceKey)"
        >
          <v-icon
            :icon="group.collapsed ? 'mdi-chevron-right' : 'mdi-chevron-down'"
            size="16"
            aria-hidden="true"
          />
          <span class="group-name" :title="groupDisplayName(group)">
            {{ groupDisplayName(group) }}
          </span>
          <span
            v-if="groupAttentionCount(group) > 0"
            class="group-attention"
            :aria-label="
              t('workspaceChat.sidebar.needsAttentionCount', {
                count: groupAttentionCount(group),
              }) || `${groupAttentionCount(group)} need attention`
            "
          >
            {{ groupAttentionCount(group) }}
          </span>
        </button>
        <ul v-if="!group.collapsed" class="conversation-list">
          <li v-for="conversation in group.conversations" :key="conversation.conversationId">
            <button
              type="button"
              class="conversation-row"
              :class="{ selected: isSelected(conversation) }"
              :data-testid="`workspace-conversation-${conversation.conversationId}`"
              data-nav-row="conversation"
              role="treeitem"
              :aria-level="2"
              :aria-selected="isSelected(conversation)"
              :aria-current="isSelected(conversation) ? 'true' : undefined"
              @click="emit('select', conversation.conversationId)"
            >
              <WorkspaceStatusIndicator
                :visual="statusVisual(conversation)"
                class="row-indicator"
              />
              <span class="row-main">
                <span class="row-title" :title="conversation.title">
                  {{ conversation.title || (t('workspaceChat.newChat') || 'New chat') }}
                </span>
                <span class="row-preview">{{ conversation.preview }}</span>
              </span>
              <span
                v-if="conversation.unread"
                class="unread-dot"
                :aria-label="t('workspaceChat.status.completedUnread') || 'Completed, unread'"
              />
            </button>
          </li>
        </ul>
      </section>

      <section
        v-if="visibleUnassigned.length > 0"
        class="workspace-group"
        aria-label="Unassigned"
      >
        <div class="group-header static">
          <v-icon icon="mdi-folder-outline" size="16" aria-hidden="true" />
          <span class="group-name">
            {{ t('workspaceChat.sidebar.unassigned') || 'Other chats' }}
          </span>
        </div>
        <ul class="conversation-list">
          <li v-for="conversation in visibleUnassigned" :key="conversation.conversationId">
            <button
              type="button"
              class="conversation-row"
              data-nav-row="conversation"
              role="treeitem"
              :aria-level="1"
              :aria-selected="isSelected(conversation)"
              :class="{ selected: isSelected(conversation) }"
              @click="emit('select', conversation.conversationId)"
            >
              <WorkspaceStatusIndicator
                :visual="statusVisual(conversation)"
                class="row-indicator"
              />
              <span class="row-main">
                <span class="row-title">
                  {{ conversation.title || (t('workspaceChat.newChat') || 'New chat') }}
                </span>
                <span class="row-preview">{{ conversation.preview }}</span>
              </span>
              <span v-if="conversation.unread" class="unread-dot" />
            </button>
          </li>
        </ul>
      </section>
    </nav>

    <!-- Zone 3: fixed account/settings zone (PRD §10.1) -->
    <div class="sidebar-footer">
      <!-- Rollout mode toggle (PRD §33): switch between the workspace and the
           classic dock, with a durable rollback path. -->
      <button
        type="button"
        class="global-nav-button"
        :data-testid="
          redesignDefault
            ? 'workspace-mode-classic'
            : 'workspace-mode-default'
        "
        @click="emit('toggle-mode')"
      >
        <v-icon
          :icon="redesignDefault ? 'mdi-chat-outline' : 'mdi-chat-processing-outline'"
          size="18"
          aria-hidden="true"
        />
        <span>{{
          redesignDefault
            ? (t('workspaceChat.mode.classic') || 'Use classic chat')
            : (t('workspaceChat.mode.makeDefault') || 'Make this my default chat')
        }}</span>
      </button>
      <button
        type="button"
        class="global-nav-button"
        data-testid="workspace-back-to-app"
        @click="goTo('/dashboard/home')"
      >
        <v-icon icon="mdi-apps" size="18" aria-hidden="true" />
        <span>{{ t('workspaceChat.backToApp') || 'Back to app' }}</span>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";
import type { WorkspaceConversationSummary } from "@/entityTypes/aiChatWorkspaceTypes";
import WorkspaceStatusIndicator from "./WorkspaceStatusIndicator.vue";
import { conversationStatusVisual } from "./workspaceStatusUtil";

const props = defineProps<{
  /** Whether the workspace is the user's durable default chat (flag on). */
  redesignDefault?: boolean;
}>();

const emit = defineEmits<{
  (e: "select", conversationId: string): void;
  (e: "new-chat"): void;
  (e: "retry"): void;
  (e: "toggle-mode"): void;
}>();

const { t, te } = useI18n();
const router = useRouter();
const workspaceStore = useChatWorkspaceStore();

const redesignDefault = computed(() => props.redesignDefault === true);

const searchModel = computed({
  get: () => workspaceStore.searchQuery,
  set: (value: string) => {
    workspaceStore.searchQuery = value;
  },
});

const visibleGroups = computed(() => workspaceStore.visibleWorkspaceGroups);
const visibleUnassigned = computed(() => workspaceStore.visibleUnassigned);
const bootstrapError = computed(() => workspaceStore.bootstrapError);

function isSelected(conversation: WorkspaceConversationSummary): boolean {
  return workspaceStore.selectedConversationId === conversation.conversationId;
}

function statusVisual(conversation: WorkspaceConversationSummary) {
  return conversationStatusVisual({
    runtimeStatus: conversation.runtimeStatus,
    attention: conversation.attention,
    unread: conversation.unread,
  });
}

function groupDisplayName(group: {
  displayName: string;
  canonicalRootPath: string | null;
}): string {
  if (group.displayName) return group.displayName;
  if (group.canonicalRootPath) {
    const parts = group.canonicalRootPath.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? group.canonicalRootPath;
  }
  return t("workspaceChat.sidebar.workspace") || "Workspace";
}

function groupAttentionCount(group: {
  conversations: readonly WorkspaceConversationSummary[];
}): number {
  return group.conversations.filter(
    (c) => c.attention !== "none" || c.unread
  ).length;
}

function goTo(path: string): void {
  void router.push(path);
}

/**
 * Roving keyboard model (FR-038, design §22.1): ArrowUp/Down move between
 * rows, ArrowLeft/Right collapse/expand groups (Left on a conversation
 * returns focus to its group header), Enter selects (native button).
 */
function onTreeKeydown(event: KeyboardEvent): void {
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
    return;
  }
  const tree = event.currentTarget as HTMLElement;
  const rows = Array.from(
    tree.querySelectorAll<HTMLElement>("button[data-nav-row]")
  );
  const active = document.activeElement as HTMLElement | null;
  const index = active ? rows.indexOf(active) : -1;
  if (index === -1 && rows.length > 0 && event.key !== "ArrowLeft") {
    event.preventDefault();
    rows[0].focus();
    return;
  }
  const row = rows[index];
  if (!row) return;

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const next = index + (event.key === "ArrowDown" ? 1 : -1);
    if (next >= 0 && next < rows.length) {
      rows[next].focus();
    }
    return;
  }
  const workspaceKey = row.dataset.workspaceKey;
  if (row.dataset.navRow === "group" && workspaceKey) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      workspaceStore.toggleWorkspaceCollapsed(workspaceKey);
    }
    return;
  }
  if (event.key === "ArrowLeft" && row.dataset.navRow === "conversation") {
    event.preventDefault();
    // Focus the nearest preceding group header.
    for (let i = index - 1; i >= 0; i -= 1) {
      if (rows[i].dataset.navRow === "group") {
        rows[i].focus();
        return;
      }
    }
  }
}

</script>

<style scoped>
.workspace-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 260px;
  max-width: 340px;
  border-right: 1px solid rgba(var(--v-border-color, 0, 0, 0), 0.12);
  background: rgb(var(--v-theme-surface));
}

.sidebar-global-nav {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 10px 6px;
  flex-shrink: 0;
}

.global-nav-button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.85);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.global-nav-button:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.global-nav-button.primary-action {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}

.sidebar-tree {
  flex: 1;
  overflow-y: auto;
  padding: 4px 6px;
}

.sidebar-footer {
  flex-shrink: 0;
  border-top: 1px solid rgba(var(--v-border-color, 0, 0, 0), 0.12);
  padding: 6px 10px;
}

.workspace-group {
  margin-bottom: 4px;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  border-radius: 6px;
}

.group-header.static {
  cursor: default;
}

.group-header:hover {
  background: rgba(var(--v-theme-on-surface), 0.05);
}

.group-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-attention {
  background: rgba(var(--v-theme-primary), 0.15);
  color: rgb(var(--v-theme-primary));
  border-radius: 999px;
  font-size: 11px;
  padding: 0 6px;
  min-width: 18px;
  text-align: center;
}

.conversation-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.conversation-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px 6px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.9);
  text-align: left;
  cursor: pointer;
}

.conversation-row:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.conversation-row.selected {
  background: rgba(var(--v-theme-primary), 0.12);
}

.conversation-row:focus-visible,
.group-header:focus-visible,
.global-nav-button:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}

.row-indicator {
  flex-shrink: 0;
}

.row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.row-title {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-preview {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.unread-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary));
  flex-shrink: 0;
}

.sidebar-message {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  padding: 10px 8px;
}

.sidebar-message.error {
  color: rgb(var(--v-theme-error));
}

.inline-action {
  border: none;
  background: none;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
  font-size: 12px;
  text-decoration: underline;
  padding: 0 4px;
}

@media (prefers-reduced-motion: reduce) {
  .global-nav-button,
  .conversation-row,
  .group-header {
    transition: none;
  }
}
</style>
