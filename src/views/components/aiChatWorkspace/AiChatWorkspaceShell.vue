<template>
  <div class="workspace-shell" data-testid="workspace-shell">
    <AiChatWorkspaceSidebar
      @select="onSelectConversation"
      @new-chat="onNewChat"
      @retry="workspaceStore.bootstrap()"
    />

    <main class="workspace-center">
      <AiChatConversationHeader
        :title="headerTitle"
        :runtime-status="selectedStore.runtimeStatus"
        :recovering="recovering"
        :active-tool-count="activeToolCount"
        :inspector-open="workspaceStore.inspectorOpen"
        :has-conversation="Boolean(conversationId)"
        @toggle-inspector="workspaceStore.toggleInspector()"
        @open-status="workspaceStore.openInspector('activity')"
        @rename="onRename"
        @compact="onCompact"
        @clear="onClear"
        @delete="onClear"
      />

      <AiChatRunStrip
        :runtime-status="selectedStore.runtimeStatus"
        :recovering="recovering"
        @stop="selectedStore.stopActiveRun()"
        @open-details="workspaceStore.openInspector('activity')"
      />

      <div class="workspace-messages">
        <!-- Loading / empty / error states (PRD §23). -->
        <p v-if="selectedStore.loading" class="center-state">
          {{ t('common.loading') || 'Loading…' }}
        </p>
        <p
          v-else-if="selectedStore.loadError"
          class="center-state error"
          role="alert"
        >
          {{ selectedStore.loadError }}
        </p>
        <div
          v-else-if="!conversationId"
          class="center-state empty"
          data-testid="workspace-empty-state"
        >
          <v-icon icon="mdi-chat-outline" size="40" aria-hidden="true" />
          <p>
            {{
              t('workspaceChat.empty.title') ||
              'Ask anything, or pick a conversation on the left.'
            }}
          </p>
          <v-btn color="primary" data-testid="workspace-empty-new-chat" @click="onNewChat">
            {{ t('workspaceChat.newChat') || 'New chat' }}
          </v-btn>
        </div>
        <AiChatV2Messages
          v-else
          :messages="[...selectedStore.messages]"
          :active-assistant-message-id="selectedStore.activeAssistantMessageId"
          :stream-status="streamStatusForMessages"
          :error-message="selectedStore.errorMessage ?? undefined"
          :show-typing-indicator="selectedStore.streamStatus === 'streaming'"
          @grant-permission="onGrantPermission"
          @deny-permission="onDenyPermission"
          @approve-plan="onLegacyPlanAction('approve-plan', $event)"
          @reject-plan="onLegacyPlanAction('reject-plan', $event)"
          @request-plan-changes="onLegacyPlanAction('request-plan-changes', $event)"
          @open-artifact="onOpenArtifact"
          @copy-artifact-html="onCopyArtifactHtml"
        />
        <button
          v-if="selectedStore.hasOlder && conversationId"
          type="button"
          class="load-older"
          :disabled="selectedStore.loadingOlder"
          data-testid="workspace-load-older"
          @click="selectedStore.loadOlder()"
        >
          {{ t('workspaceChat.loadOlder') || 'Load older messages' }}
        </button>
      </div>

      <AiChatV2Composer
        :is-streaming="selectedStore.isBusy"
        :conversation-id="conversationId"
        @send="onComposerSend"
        @stop="selectedStore.stopActiveRun()"
      />
    </main>

    <AiChatInspector
      v-if="workspaceStore.inspectorOpen"
      :active-tab="workspaceStore.inspectorTab"
      :width="workspaceStore.inspectorWidth"
      :conversation-id="conversationId"
      :messages="[...selectedStore.messages]"
      @update:tab="workspaceStore.setInspectorTab"
      @update:width="workspaceStore.setInspectorWidth"
      @compact="onCompact"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import AiChatV2Messages from "@/views/components/aiChatV2/AiChatV2Messages.vue";
import AiChatV2Composer from "@/views/components/aiChatV2/AiChatV2Composer.vue";
import {
  approveChatV2Plan,
  rejectChatV2Plan,
  requestChatV2PlanChanges,
  clearChatV2Conversation,
  compactChatV2Conversation,
} from "@/views/api/aiChatV2";
import { windowInvoke } from "@/views/utils/apirequest";
import { AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION } from "@/config/channellist";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";
import { useSelectedConversationStore } from "@/views/store/selectedConversation";
import {
  createWorkspaceConversationId,
  renameConversation,
} from "@/views/api/aiChatWorkspace";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import AiChatWorkspaceSidebar from "./AiChatWorkspaceSidebar.vue";
import AiChatConversationHeader from "./AiChatConversationHeader.vue";
import AiChatRunStrip from "./AiChatRunStrip.vue";
import AiChatInspector from "./AiChatInspector.vue";

const { t } = useI18n();
const workspaceStore = useChatWorkspaceStore();
const selectedStore = useSelectedConversationStore();

const conversationId = computed(() => workspaceStore.selectedConversationId);

const headerTitle = computed(() => {
  const summary = workspaceStore.selectedConversation;
  return summary?.title || selectedStore.selectedTitle;
});

const streamStatusForMessages = computed<
  "idle" | "streaming" | "cancelled" | "error"
>(() => {
  if (selectedStore.streamStatus === "streaming") return "streaming";
  if (selectedStore.streamStatus === "error") return "error";
  if (selectedStore.streamStatus === "cancelled") return "cancelled";
  if (selectedStore.runtimeStatus === "running") return "streaming";
  return "idle";
});

const activeToolCount = computed(() => {
  let count = 0;
  for (let i = selectedStore.messages.length - 1; i >= 0; i -= 1) {
    const message = selectedStore.messages[i];
    if (message.role === "user") break;
    if (
      message.messageType === MessageType.TOOL_CALL ||
      message.messageType === MessageType.TOOL_RESULT
    ) {
      count += 1;
    }
  }
  return count;
});

// Recovery metadata wiring lands with Stage 6; the strip already renders it.
const recovering = computed((): boolean => false);

/** Newest plan state carried by message metadata (durable authority). */
const latestPlanState = computed(() => {
  for (let i = selectedStore.messages.length - 1; i >= 0; i -= 1) {
    const state = selectedStore.messages[i].metadata?.planStateView;
    if (state) return state;
  }
  return null;
});

async function onSelectConversation(id: string): Promise<void> {
  await selectedStore.loadSelection(id);
}

async function onNewChat(): Promise<void> {
  const id = createWorkspaceConversationId();
  workspaceStore.upsertLocalConversation({
    conversationId: id,
    workspaceKey: null,
    title: "",
    preview: "",
    lastActivityAt: new Date().toISOString(),
    unread: false,
    attention: "none",
    runtimeStatus: "idle",
    activeRunId: null,
  });
  await selectedStore.loadSelection(id);
}

async function onComposerSend(
  text: string,
  files: File[]
): Promise<void> {
  if (files.length > 0) {
    // Attachments still flow through the legacy stream path in this phase;
    // workspace runs take text-only sends until attachment staging moves.
    return;
  }
  await selectedStore.sendMessage(text);
}

async function onRename(): Promise<void> {
  if (!conversationId.value) return;
  const next = window.prompt(
    t("workspaceChat.header.renamePrompt") || "Rename chat",
    headerTitle.value ?? ""
  );
  if (!next || !next.trim()) return;
  try {
    await renameConversation({
      conversationId: conversationId.value,
      title: next.trim(),
    });
    await workspaceStore.bootstrap();
  } catch {
    // Non-fatal — the title stays unchanged.
  }
}

async function onCompact(): Promise<void> {
  if (!conversationId.value) return;
  try {
    await compactChatV2Conversation(conversationId.value);
  } catch {
    // Non-fatal — the run strip still shows progress.
  }
}

async function onClear(): Promise<void> {
  if (!conversationId.value) return;
  const confirmed = window.confirm(
    t("workspaceChat.header.clearConfirm") ||
      "Clear all messages in this conversation?"
  );
  if (!confirmed) return;
  try {
    await clearChatV2Conversation(conversationId.value);
    await workspaceStore.bootstrap();
    await selectedStore.loadSelection(conversationId.value);
  } catch {
    // Non-fatal — deletion can be retried.
  }
}

/**
 * Grant resumes the EXACT run (PRD §22.3): the decision card carries the
 * tool-call identity; the main process records the permission and resumes.
 */
async function onGrantPermission(
  message: ChatV2MessageView,
  persistent: boolean
): Promise<void> {
  void persistent;
  const toolId = message.metadata?.toolCallId;
  if (!conversationId.value || !toolId) return;
  try {
    await windowInvoke(AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION, {
      toolId,
      conversationId: conversationId.value,
    });
  } catch {
    // The decision card remains actionable on failure.
  }
}

/** Denial terminates the exact run (PRD §22.3). */
async function onDenyPermission(): Promise<void> {
  await selectedStore.stopActiveRun();
}

/** Plan decisions flow through the existing durable plan APIs. */
async function onLegacyPlanAction(
  action: "approve-plan" | "reject-plan" | "request-plan-changes",
  feedback = ""
): Promise<void> {
  if (!conversationId.value) return;
  const plan = latestPlanState.value;
  const version = plan?.latestVersion?.version ?? plan?.currentVersion;
  if (!plan?.planId || version === undefined) return;
  try {
    if (action === "approve-plan") {
      await approveChatV2Plan(conversationId.value, plan.planId, version);
    } else if (action === "reject-plan") {
      await rejectChatV2Plan(
        conversationId.value,
        plan.planId,
        version,
        feedback
      );
    } else {
      await requestChatV2PlanChanges(
        conversationId.value,
        plan.planId,
        version,
        feedback
      );
    }
  } catch {
    // Decision cards remain actionable on failure.
  }
}

function onOpenArtifact(artifactId: string): void {
  // FR-026: artifact output opens the right inspector.
  workspaceStore.openInspector("artifacts");
  void artifactId;
}

async function onCopyArtifactHtml(artifactId: string): Promise<void> {
  void artifactId;
}

onMounted(() => {
  void workspaceStore.bootstrap();
});

onUnmounted(() => {
  selectedStore.teardown();
  workspaceStore.teardown();
});
</script>

<style scoped>
.workspace-shell {
  display: flex;
  height: 100vh;
  width: 100%;
  overflow: hidden;
  background: rgb(var(--v-theme-background));
  color: rgba(var(--v-theme-on-surface), 0.9);
}

.workspace-center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.workspace-messages {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding-top: 6px;
}

.center-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin: 0;
}

.center-state.error {
  color: rgb(var(--v-theme-error));
}

.center-state.empty {
  flex-direction: column;
  gap: 12px;
}

.load-older {
  align-self: center;
  margin: 4px 0 8px;
  border: 1px solid rgba(var(--v-border-color, 0, 0, 0), 0.2);
  border-radius: 999px;
  background: transparent;
  padding: 4px 16px;
  font-size: 12px;
  cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.75);
}

.load-older:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}

.load-older:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
