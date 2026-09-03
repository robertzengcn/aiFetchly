<template>
  <div class="context-panel" data-testid="workspace-context-panel">
    <div class="panel-toolbar">
      <span class="panel-title">
        {{ t('workspaceChat.inspector.context') || 'Context' }}
      </span>
    </div>

    <p v-if="!conversationId" class="panel-empty">
      {{ t('workspaceChat.context.selectConversation') || 'Select a conversation to see its context.' }}
    </p>

    <template v-else>
      <!-- Workspace binding + trust (PRD §14.4). -->
      <section class="context-section">
        <h3 class="section-title">
          {{ t('workspaceChat.context.workspace') || 'Workspace' }}
        </h3>
        <p v-if="workspaceName" class="context-line" :title="workspacePath ?? workspaceName">
          <v-icon icon="mdi-folder-outline" size="16" aria-hidden="true" />
          {{ workspaceName }}
          <span v-if="trustLabel" class="trust-badge">{{ trustLabel }}</span>
        </p>
        <p v-else class="panel-empty">
          {{ t('workspaceChat.context.noWorkspace') || 'No workspace is bound to this chat.' }}
        </p>
      </section>

      <!-- Context usage (PRD §13.2 — details live here, indicator in composer). -->
      <section class="context-section">
        <h3 class="section-title">
          {{ t('workspaceChat.context.usage') || 'Context usage' }}
        </h3>
        <div
          class="usage-meter"
          role="meter"
          :aria-valuenow="contextPercent"
          :aria-valuemin="0"
          :aria-valuemax="100"
          :aria-label="usageLabel"
        >
          <div class="usage-bar">
            <div class="usage-fill" :style="{ width: `${contextPercent}%` }" />
          </div>
          <span class="usage-label">{{ usageLabel }}</span>
        </div>
      </section>

      <!-- Attached context summary (PRD §14.4). -->
      <section class="context-section">
        <h3 class="section-title">
          {{ t('workspaceChat.context.attachmentsSection') || 'Attached context' }}
        </h3>
        <p v-if="attachmentCount === 0" class="panel-empty">
          {{ t('workspaceChat.context.noAttachments') || 'No attachments or mentions in this conversation yet.' }}
        </p>
        <ul v-else class="attachment-list">
          <li v-for="item in attachmentItems" :key="item" class="context-line">
            <v-icon icon="mdi-paperclip" size="14" aria-hidden="true" />
            {{ item }}
          </li>
        </ul>
      </section>

      <!-- Compaction action (PRD §15 matrix: Context inspector + overflow). -->
      <section class="context-section">
        <button
          type="button"
          class="compact-action"
          data-testid="workspace-context-compact"
          @click="emit('compact')"
        >
          <v-icon icon="mdi-collapse-all-outline" size="16" aria-hidden="true" />
          {{ t('workspaceChat.context.compact') || 'Compact conversation' }}
        </button>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";
import {
  computeContextPercent,
} from "@/views/components/aiChatV2/contextUsageUtil";

const props = defineProps<{
  conversationId: string | null;
  messages: readonly ChatV2MessageView[];
}>();

const emit = defineEmits<{
  (e: "compact"): void;
}>();

const { t } = useI18n();
const workspaceStore = useChatWorkspaceStore();

const conversationSummary = computed(() =>
  props.conversationId
    ? workspaceStore.conversationsById.get(props.conversationId)
    : undefined
);

const workspaceGroup = computed(() =>
  workspaceStore.workspaces.find(
    (group) => group.workspaceKey === conversationSummary.value?.workspaceKey
  )
);

const workspaceName = computed(() => {
  const group = workspaceGroup.value;
  if (!group) return null;
  if (group.displayName) return group.displayName;
  if (group.canonicalRootPath) {
    const parts = group.canonicalRootPath.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? group.canonicalRootPath;
  }
  return null;
});

const workspacePath = computed(
  () => workspaceGroup.value?.canonicalRootPath ?? null
);

const trustLabel = computed(() => {
  const state = workspaceGroup.value?.approvalState;
  if (state === "approved") {
    return t("workspaceChat.context.trusted") || "Trusted";
  }
  if (state === "revoked") {
    return t("workspaceChat.context.revoked") || "Revoked";
  }
  return "";
});

const lastKnownTokens = computed(() => {
  for (let i = props.messages.length - 1; i >= 0; i -= 1) {
    const tokens = props.messages[i].tokensUsed;
    if (typeof tokens === "number" && tokens > 0) return tokens;
  }
  return undefined;
});

const contextPercent = computed(() =>
  computeContextPercent({
    modelContextWindows: new Map(),
    lastTotalTokens: lastKnownTokens.value,
    streamingEstimatedTokens: 0,
  })
);

const usageLabel = computed(
  () =>
    `${t("workspaceChat.context.used") || "Used"} ${contextPercent.value}%` +
    (lastKnownTokens.value
      ? ` · ${lastKnownTokens.value} ${t("workspaceChat.context.tokens") || "tokens"}`
      : "")
);

const attachmentItems = computed(() => {
  const items: string[] = [];
  for (const message of props.messages) {
    for (const attachment of message.metadata?.attachments ?? []) {
      items.push(`${attachment.fileName} (${attachment.kind})`);
    }
    for (const mention of message.metadata?.atMentions ?? []) {
      void mention;
      items.push(t("workspaceChat.context.atMention") || "File @-mention");
    }
  }
  return [...new Set(items)].slice(0, 20);
});

const attachmentCount = computed(() => attachmentItems.value.length);
</script>

<style scoped>
.context-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  padding-bottom: 16px;
}

.panel-toolbar {
  padding: 8px 12px;
}

.panel-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.context-section {
  padding: 4px 14px 8px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.65);
  margin: 8px 0 6px;
}

.panel-empty {
  font-size: 12.5px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.context-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  padding: 2px 0;
}

.trust-badge {
  font-size: 10.5px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.25);
  border-radius: 999px;
  padding: 0 8px;
}

.usage-meter {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.usage-bar {
  height: 6px;
  border-radius: 3px;
  background: rgba(var(--v-theme-on-surface), 0.12);
  overflow: hidden;
}

.usage-fill {
  height: 100%;
  border-radius: 3px;
  background: rgb(var(--v-theme-primary));
  transition: width 200ms ease;
}

@media (prefers-reduced-motion: reduce) {
  .usage-fill {
    transition: none;
  }
}

.usage-label {
  font-size: 11.5px;
  color: rgba(var(--v-theme-on-surface), 0.65);
}

.attachment-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.compact-action {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid rgba(var(--v-border-color, 0, 0, 0), 0.2);
  border-radius: 6px;
  background: transparent;
  padding: 6px 12px;
  font-size: 12.5px;
  cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

.compact-action:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.compact-action:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}
</style>
