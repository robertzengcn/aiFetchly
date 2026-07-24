<template>
  <div class="v2-shell">
    <!-- Header with icon actions like old AiChatBox -->
    <div class="v2-shell__header">
      <div class="v2-shell__header-left">
        <v-icon class="mr-2">mdi-robot</v-icon>
        <span class="v2-shell__title">{{
          t("aiChatV2.title") || "AI Assistant"
        }}</span>
        <AiChatV2PlanStatusBadge
          v-if="planState"
          :status="planState.status"
          class="ml-2"
        />
      </div>
      <div class="v2-shell__header-actions">
        <AiChatV2ContextBadge
          :percent="contextPercent"
          :used-tokens="contextUsedTokens"
          :total-tokens="contextTotalTokens"
          class="mx-2"
        />
        <v-btn
          icon
          size="small"
          variant="text"
          :loading="isCompacting"
          :disabled="
            !activeConversationId || messages.length === 0 || chatIsRunning
          "
          @click="handleCompactConversation"
          :title="
            t('aiChatV2.compact_conversation') || 'Compact conversation'
          "
        >
          <v-icon size="small">mdi-arrow-collapse</v-icon>
        </v-btn>
        <v-btn
          icon
          size="small"
          variant="text"
          @click="showConversationsDialog = true"
          :title="t('aiChatV2.conversation_history') || 'Conversation history'"
        >
          <v-icon size="small">mdi-history</v-icon>
        </v-btn>
        <v-btn
          icon
          size="small"
          variant="text"
          @click="showMCPToolManager = true"
          :title="t('aiChatV2.manage_mcp_tools') || 'Manage MCP Tools'"
        >
          <v-icon size="small">mdi-toolbox</v-icon>
        </v-btn>
        <v-btn
          icon
          size="small"
          variant="text"
          @click="onNewConversation"
          :title="t('aiChatV2.new_conversation') || 'New conversation'"
        >
          <v-icon size="small">mdi-plus-circle</v-icon>
        </v-btn>
        <v-btn
          icon
          size="small"
          variant="text"
          @click="onClearMessages"
          :disabled="messages.length === 0"
          :title="t('aiChatV2.clear_chat') || 'Clear chat'"
        >
          <v-icon size="small">mdi-delete-outline</v-icon>
        </v-btn>
        <AgentTaskListDialog @cancel-task="handleAgentTaskCancel" />
      </div>
    </div>

    <!-- Main content (no sidebar) -->
    <div class="v2-shell__body">
      <AiChatV2Messages
        :messages="visibleMessages"
        :active-assistant-message-id="activeAssistantMessageId"
        :stream-status="streamStatus"
        :error-message="streamError ?? undefined"
        :show-typing-indicator="showTypingIndicator"
        :is-streaming="chatIsRunning"
        :retry-info="retryInfo"
        :recovery-info="recoveryInfo"
        :workspace-root="activeWorkspace?.rootPath ?? ''"
        @grant-permission="handleSkillPermissionGrant"
        @deny-permission="handleSkillPermissionDeny"
        @approve-plan="handleApprovePlan"
        @reject-plan="handleRejectPlan"
        @request-plan-changes="handleRequestPlanChanges"
        @open-artifact="(id: string) => emit('open-artifact', id)"
        @copy-artifact-html="(id: string) => emit('copy-artifact-html', id)"
      />

      <!-- Pinned action cards: permission + question + plan approval while awaiting user input.
           After the user approves/rejects/requests changes, the plan card moves
           into the message flow (see handleApprovePlan et al.). -->
      <div
        v-if="
          pinnedPermissionPrompt ||
          (mode === 'plan' && (pendingQuestion || pendingPlanApproval))
        "
        class="v2-shell__plan-panel"
      >
        <SkillApprovalCard
          v-if="pinnedPermissionPrompt"
          :tool-name="pinnedPermissionToolName"
          :permission-category="pinnedPermissionCategory"
          :shell-preview="pinnedPermissionShellPreview"
          :workspace-root="activeWorkspace?.rootPath ?? ''"
          :disabled="pinnedPermissionResumeInFlight"
          :loading="pinnedPermissionResumeInFlight"
          @grant="handlePinnedPermissionGrant"
          @deny="handlePinnedPermissionDeny"
        />
        <AiChatV2QuestionCard
          v-if="pendingQuestion"
          :question="pendingQuestion"
          @answered="handleQuestionAnswered"
        />
        <AiChatV2PlanApprovalCard
          v-if="pendingPlanApproval"
          :plan-state="pendingPlanApproval"
          :disabled="chatIsRunning"
          @approve="handleApprovePlan"
          @reject="handleRejectPlan"
          @request-changes="handleRequestPlanChanges"
        />
      </div>

      <!-- File Operations Summary Panel: lists files created/modified by the
           AI during tool execution in the active conversation. -->
      <div v-if="currentFileOps.length > 0" class="v2-shell__file-ops-panel">
        <div
          class="v2-shell__file-ops-header"
          @click="showFileOpsPanel = !showFileOpsPanel"
        >
          <v-icon size="small" class="mr-1" color="primary">
            mdi-file-document-edit-outline
          </v-icon>
          <span class="v2-shell__file-ops-summary">
            {{ currentFileOps.length }}
            {{
              currentFileOps.length === 1
                ? t("aiChatV2.file_change_one") || "file change"
                : t("aiChatV2.file_changes_other") || "file changes"
            }}
          </span>
          <span class="v2-shell__file-ops-counts">
            <v-chip
              v-if="createCount > 0"
              size="x-small"
              variant="tonal"
              color="success"
              class="ml-1"
            >
              +{{ createCount }}
            </v-chip>
            <v-chip
              v-if="editCount > 0"
              size="x-small"
              variant="tonal"
              color="info"
              class="ml-1"
            >
              ~{{ editCount }}
            </v-chip>
            <v-chip
              v-if="overwriteCount > 0"
              size="x-small"
              variant="tonal"
              color="warning"
              class="ml-1"
            >
              ~{{ overwriteCount }}
            </v-chip>
          </span>
          <v-spacer />
          <v-icon size="small">
            {{ showFileOpsPanel ? "mdi-chevron-up" : "mdi-chevron-down" }}
          </v-icon>
        </div>
        <div v-if="showFileOpsPanel" class="v2-shell__file-ops-body">
          <FileOperationBadge :records="currentFileOps" />
        </div>
      </div>

      <!-- Workspace badge + required card: pinned above the composer so the
           user can see/set the workspace for the active conversation. The
           badge shows the current workspace path (or "No workspace set"),
           and the required card prompts the user to pick a folder when no
           workspace exists yet. -->
      <div class="v2-shell__workspace-panel">
        <WorkspaceBadge
          :workspace="activeWorkspace"
          :memory-count="workspaceMemoryCount"
          class="mb-1"
          @request-set-workspace="handleWorkspaceSetupRequest"
          @request-open-memory="openWorkspaceMemory"
        />
        <WorkspaceRequiredCard
          v-if="showWorkspaceRequired && activeConversationId"
          :conversation-id="activeConversationId"
          @approved="onWorkspaceApproved"
          @cancel="showWorkspaceRequired = false"
        />
      </div>

      <v-alert
        v-if="localToolsUnsupported"
        type="warning"
        variant="tonal"
        density="compact"
        class="mb-2"
      >
        {{ t('aiProvider.tool_warning') || 'This local provider has not confirmed tool support. Tools are disabled for this conversation.' }}
      </v-alert>

      <v-dialog v-model="showWorkspaceMemory" max-width="760">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2">mdi-brain</v-icon>
            <span>{{
              t("workspaceMemory.panelTitle") || "Workspace memory"
            }}</span>
            <v-spacer />
            <v-btn icon="mdi-close" variant="text" size="small" @click="showWorkspaceMemory = false" />
          </v-card-title>
          <v-divider />
          <WorkspaceMemoryPanel
            v-if="activeConversationId"
            :conversation-id="activeConversationId"
            :workspace="activeWorkspace"
            @change="refreshWorkspaceMemoryCount"
          />
        </v-card>
      </v-dialog>

      <v-alert
        v-if="voiceMissingModel"
        type="warning"
        variant="tonal"
        density="compact"
        class="mb-2 text-body-2"
      >
        <v-icon start size="small">mdi-alert-outline</v-icon>
        {{ t("aiChatV2.voice.model_missing") || "Voice model is not installed." }}
      </v-alert>
      <AiChatV2Composer
        :is-streaming="chatIsRunning"
        :is-processing="isPreparingAttachments"
        :voice-enabled="voiceInputEnabled"
        :voice-auto-send="voiceAutoSend"
        :conversation-id="activeConversationId"
        @send="onSend"
        @stop="onStop"
      >
        <template #prepend>
          <AiChatV2ModeSelector v-model="mode" :disabled="chatIsRunning" />
          <AiChatV2ModelSelector
            v-model="selectedModel"
            :items="availableModels"
            :default-model="defaultModelId"
            :disabled="chatIsRunning"
            :loading="availableModels.length === 0"
            class="ml-2"
          />
          <AiChatV2ToolApprovalModeSelector
            v-model="toolApprovalMode"
            :disabled="chatIsRunning"
            class="ml-2"
            @update:model-value="onToolApprovalModeChange"
          />
          <v-tooltip location="bottom">
            <template #activator="{ props }">
              <v-chip
                v-if="providerLabel"
                v-bind="props"
                size="x-small"
                :color="providerChipColor"
                variant="tonal"
                class="ml-2 cursor-pointer"
                @click="openAIProviderSettings"
              >
                <v-icon start size="small">mdi-robot-outline</v-icon>
                {{ providerLabel }}
              </v-chip>
            </template>
            <span>{{ t('aiProvider.title') || 'AI Provider' }}</span>
          </v-tooltip>
        </template>
      </AiChatV2Composer>
    </div>

    <!-- MCP Tool Manager Dialog -->
    <MCPToolManager v-model="showMCPToolManager" />



    <v-snackbar v-model="compactNotice" timeout="3000" location="bottom">
      {{
        t("aiChatV2.compact_completed") ||
        "Conversation compacted into memory."
      }}
    </v-snackbar>

    <!-- Conversation history dialog -->
    <v-dialog v-model="showConversationsDialog" max-width="500" scrollable>
      <v-card>
        <v-card-title class="d-flex align-center justify-space-between">
          <span>{{
            t("aiChatV2.conversation_history") || "Conversation History"
          }}</span>
          <v-btn
            icon
            size="small"
            variant="text"
            @click="showConversationsDialog = false"
          >
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-card-title>
        <v-divider></v-divider>
        <div class="px-3 pt-3">
          <v-text-field
            v-model="conversationSearch"
            :placeholder="
              t('aiChatV2.search_conversations') || 'Search conversations...'
            "
            prepend-inner-icon="mdi-magnify"
            density="compact"
            variant="outlined"
            clearable
            hide-details
            @click:clear="conversationSearch = ''"
          />
          <v-progress-linear
            v-if="searchingConversations"
            indeterminate
            color="primary"
            height="2"
            class="mt-1"
          />
        </div>
        <v-card-text style="padding: 0">
          <div
            v-if="conversations.length === 0 && !searchingConversations"
            class="pa-4 text-center"
          >
            <v-icon size="48" color="grey-lighten-2">mdi-chat-outline</v-icon>
            <p class="mt-4 text-grey">
              {{
                conversationSearch
                  ? t("aiChatV2.no_search_results") || "No conversations found"
                  : t("aiChatV2.no_conversations") || "No conversations yet"
              }}
            </p>
          </div>
          <v-list v-else density="comfortable">
            <v-list-item
              v-for="conv in conversations"
              :key="conv.conversationId"
              :class="{
                'bg-primary-lighten-5':
                  conv.conversationId === activeConversationId,
              }"
              @click="onSelectConversation(conv.conversationId)"
            >
              <template v-slot:prepend>
                <v-icon color="primary">mdi-chat</v-icon>
              </template>
              <v-list-item-title>{{
                truncateText(conv.title, 60)
              }}</v-list-item-title>
              <v-list-item-subtitle>
                <div class="d-flex align-center mt-1">
                  <v-icon size="x-small" class="mr-1">mdi-clock-outline</v-icon>
                  <span>{{ formatTimestamp(conv.lastMessageTimestamp) }}</span>
                </div>
              </v-list-item-subtitle>
              <template v-slot:append>
                <v-progress-circular
                  v-if="isConversationRunning(conv.conversationId)"
                  indeterminate
                  size="16"
                  width="2"
                  color="primary"
                  class="ml-2"
                  :title="
                    t('aiChatV2.conversation_running') ||
                    'Conversation is running'
                  "
                />
              </template>
            </v-list-item>
          </v-list>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  nextTick,
  onMounted,
  onBeforeUnmount,
} from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { handleAiNavigationToolResult } from "@/views/utils/aiNavigationResultHandler";
import { MessageType } from "@/entityTypes/commonType";
import type {
  ChatV2MessageView,
  ChatV2ConversationSummary,
  ChatV2StreamChunk,
  ChatV2StreamRequest,
  ChatV2MessageMetadata,
  ChatV2UploadedAttachment,
  ChatV2AttachmentKind,
  ChatV2AttachmentMetadata,
  ChatToolApprovalMode,
} from "@/entityTypes/aiChatV2Types";
import type {
  AIChatPlanStateView,
  AIChatPlanQuestionView,
  AskUserQuestionAnswer,
  ChatV2Mode,
} from "@/entityTypes/aiChatPlanTypes";
import {
  windowInvoke,
} from "@/views/utils/apirequest";
import {
  AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION,
} from "@/config/channellist";
import {
  clearChatV2StreamListeners,
  clearChatV2Conversation,
  getChatV2Conversations,
  getChatV2History,
  streamChatV2Message,
  stopChatV2Stream,
  getChatV2PlanState,
  compactChatV2Conversation,
  answerChatV2Question,
  approveChatV2Plan,
  rejectChatV2Plan,
  requestChatV2PlanChanges,
  getOpenAIChatModels,
  getChatV2ToolApprovalMode,
  setChatV2ToolApprovalMode,
} from "@/views/api/aiChatV2";
import {
  AI_CHAT_V2_VOICE_SETTINGS_CHANGED_EVENT,
  getVoiceSettings,
  getVoiceStatus,
} from "@/views/api/aiChatV2Voice";
import type { AiChatVoiceRuntimeStatus } from "@/entityTypes/aiChatVoiceTypes";
import { SpeechResponseController } from "./voice/SpeechResponseController";
import {
  AI_PROVIDER_SETTINGS_CHANGED_EVENT,
  getAIProviderSettings,
} from "@/views/api/aiProvider";
import type { AIProviderSettingsView } from "@/entityTypes/aiProviderTypes";
import { dispatchSlashCommand } from "@/views/api/slashCommands";
import AiChatV2Messages from "./AiChatV2Messages.vue";
import AiChatV2Composer from "./AiChatV2Composer.vue";
import AiChatV2ModeSelector from "./AiChatV2ModeSelector.vue";
import AiChatV2ModelSelector from "./AiChatV2ModelSelector.vue";
import AiChatV2ToolApprovalModeSelector from "./AiChatV2ToolApprovalModeSelector.vue";
import AiChatV2QuestionCard from "./AiChatV2QuestionCard.vue";
import AiChatV2PlanApprovalCard from "./AiChatV2PlanApprovalCard.vue";
import AiChatV2PlanStatusBadge from "./AiChatV2PlanStatusBadge.vue";
import AiChatV2ContextBadge from "./AiChatV2ContextBadge.vue";
import FileOperationBadge from "../aiChat/FileOperationBadge.vue";
import SkillApprovalCard from "../aiChat/SkillApprovalCard.vue";
import MCPToolManager from "../aiChat/MCPToolManager.vue";
import AgentTaskListDialog from "./AgentTaskListDialog.vue";
import WorkspaceBadge from "./WorkspaceBadge.vue";
import WorkspaceRequiredCard from "./WorkspaceRequiredCard.vue";
import WorkspaceMemoryPanel from "./WorkspaceMemoryPanel.vue";
import { getWorkspace } from "@/views/api/workspace";
import { workspaceMemoryApi } from "@/views/api/aiWorkspaceMemory";
import type { WorkspaceSummary } from "@/entityTypes/workspaceTypes";
import type { FileOperationRecord } from "@/entityTypes/fileOperationTypes";
import { extractArtifactMetadata, ensureArtifactMetadata } from "./artifactMetadata";
import {
  subscribeToFileOperations,
  unsubscribeFromFileOperations,
} from "@/views/api/aiChat";
import type { OpenAIModel } from "@/api/aiChatApi";
import {
  computeContextPercent,
  resolveContextWindow,
  DEFAULT_CONTEXT_WINDOW,
} from "./contextUsageUtil";
import { hasPendingToolExecution } from "./toolExecutionStateUtil";
import {
  downscaleImageAttachment,
  arrayBufferToBase64,
} from "./imageScaleUtil";
import { QUOTA_EXHAUSTED_SENTINEL } from "@/service/AIChatErrorMapper";

/**
 * Rough chars→tokens ratio used to drive a live-updating estimate while
 * tokens stream. Real usage from the server overrides this on turn end.
 */
const CHARS_PER_TOKEN_ESTIMATE = 4;

/**
 * Sentinel value used in the model selector for the "Auto" option.
 * When selected, the actual model sent to the server resolves to the
 * API's `default_model`, and the context badge reads the default model's
 * context_size from the model list.
 */
const AUTO_MODEL_VALUE = "auto";

type Status = "idle" | "streaming" | "cancelled" | "error";
type ShellPreview = {
  command: string;
  cwd?: string;
  shell: string;
  timeout_ms: number;
};

const emit = defineEmits<{
  (e: "open-artifact", artifactId: string): void;
  (e: "copy-artifact-html", artifactId: string): void;
}>();

const { t } = useI18n();
const router = useRouter();

interface AiPromptRequest {
  id: number;
  text: string;
}

const props = defineProps<{
  promptRequest?: AiPromptRequest | null;
}>();

const lastHandledPromptRequestId = ref<number | null>(null);
const conversations = ref<ChatV2ConversationSummary[]>([]);
const activeConversationId = ref<string | null>(null);
const messages = ref<ChatV2MessageView[]>([]);
const isStreaming = ref(false);
const streamError = ref<string | null>(null);
const activeAssistantMessageId = ref<string | null>(null);
// Flipped to true once the first visible AI chunk (token/tool_call/etc)
// arrives. Drives the typing indicator while we wait for the AI response.
const receivedFirstResponse = ref(false);
// Tracks the active reconnection attempt when the AI server connection
// drops and is being retried. Null when no retry is in progress.
type RetryInfo = {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
};
const retryInfo = ref<RetryInfo | null>(null);
// Active seven-layer recovery status. Null when no recovery layer is
// running. Cleared on token/tool_call/complete/cancelled/error.
type RecoveryInfo = {
  layer: import("@/service/AIChatRecoveryTypes").AIChatRecoveryLayer;
  reason: import("@/service/AIChatRecoveryTypes").AIChatRecoveryReason;
  attempt?: number;
  maxAttempts?: number;
  delayMs?: number;
  elapsedMs?: number;
  originalModel?: string;
  currentModel?: string;
  fallbackModel?: string;
  message?: string;
};
const recoveryInfo = ref<RecoveryInfo | null>(null);
const showConversationsDialog = ref(false);
const showMCPToolManager = ref(false);
const isCompacting = ref(false);
const compactNotice = ref(false);
const stoppedPendingToolConversationIds = ref<Set<string>>(new Set());

interface MessageListController {
  get(): ChatV2MessageView[];
  set(nextMessages: ChatV2MessageView[]): void;
}

interface ConversationRuntimeState {
  messages: ChatV2MessageView[];
  isStreaming: boolean;
  activeAssistantMessageId: string | null;
  receivedFirstResponse: boolean;
  streamError: string | null;
  retryInfo: RetryInfo | null;
  recoveryInfo: RecoveryInfo | null;
}

const conversationRuntime = ref<Map<string, ConversationRuntimeState>>(
  new Map()
);

const createIdleRuntimeState = (): ConversationRuntimeState => ({
  messages: [],
  isStreaming: false,
  activeAssistantMessageId: null,
  receivedFirstResponse: false,
  streamError: null,
  retryInfo: null,
  recoveryInfo: null,
});

const getConversationRuntimeState = (
  conversationId: string
): ConversationRuntimeState => {
  return (
    conversationRuntime.value.get(conversationId) ?? createIdleRuntimeState()
  );
};

const applyRuntimeFieldsToActive = (
  state: ConversationRuntimeState,
  options: { applyMessages?: boolean } = {}
): void => {
  if (options.applyMessages) {
    messages.value = state.messages;
  }
  isStreaming.value = state.isStreaming;
  activeAssistantMessageId.value = state.activeAssistantMessageId;
  receivedFirstResponse.value = state.receivedFirstResponse;
  streamError.value = state.streamError;
  retryInfo.value = state.retryInfo;
  recoveryInfo.value = state.recoveryInfo;
};

const resetActiveRuntimeFields = (): void => {
  isStreaming.value = false;
  activeAssistantMessageId.value = null;
  receivedFirstResponse.value = false;
  streamError.value = null;
  retryInfo.value = null;
  recoveryInfo.value = null;
};

const patchConversationRuntimeState = (
  conversationId: string,
  patch: Partial<ConversationRuntimeState>
): ConversationRuntimeState => {
  const current = getConversationRuntimeState(conversationId);
  const nextState: ConversationRuntimeState = {
    ...current,
    ...patch,
  };
  const nextMap = new Map(conversationRuntime.value);
  nextMap.set(conversationId, nextState);
  conversationRuntime.value = nextMap;
  if (activeConversationId.value === conversationId) {
    applyRuntimeFieldsToActive(nextState, {
      applyMessages: patch.messages !== undefined,
    });
  }
  return nextState;
};

const clearConversationRuntimeState = (conversationId: string): void => {
  if (!conversationRuntime.value.has(conversationId)) return;
  const nextMap = new Map(conversationRuntime.value);
  nextMap.delete(conversationId);
  conversationRuntime.value = nextMap;
};

const markConversationRuntimeStopped = (
  conversationId: string | null | undefined,
  errorMessage?: string
): void => {
  if (!conversationId) {
    resetActiveRuntimeFields();
    if (errorMessage) {
      streamError.value = errorMessage;
    }
    return;
  }
  patchConversationRuntimeState(conversationId, {
    isStreaming: false,
    activeAssistantMessageId: null,
    retryInfo: null,
    recoveryInfo: null,
    streamError: errorMessage ?? null,
  });
};

const markActiveConversationRuntimeStopped = (errorMessage?: string): void => {
  markConversationRuntimeStopped(activeConversationId.value, errorMessage);
};

const activeMessageListController: MessageListController = {
  get: () => messages.value,
  set: (nextMessages: ChatV2MessageView[]): void => {
    messages.value = nextMessages;
  },
};

const hasEquivalentPersistedMessage = (
  persistedMessages: ChatV2MessageView[],
  liveMessage: ChatV2MessageView
): boolean => {
  const liveToolCallId = liveMessage.metadata?.toolCallId;
  return persistedMessages.some((persisted) => {
    if (persisted.id === liveMessage.id) return true;
    if (
      liveToolCallId &&
      persisted.messageType === liveMessage.messageType &&
      persisted.metadata?.toolCallId === liveToolCallId
    ) {
      return true;
    }
    return (
      persisted.role === liveMessage.role &&
      persisted.messageType === liveMessage.messageType &&
      persisted.content === liveMessage.content &&
      liveMessage.content.length > 0
    );
  });
};

const mergePersistedAndLiveMessages = (
  persistedMessages: ChatV2MessageView[],
  liveMessages: ChatV2MessageView[]
): ChatV2MessageView[] => {
  const merged = [...persistedMessages];
  const indexById = new Map<string, number>();
  merged.forEach((message, index) => {
    indexById.set(message.id, index);
  });

  for (const liveMessage of liveMessages) {
    const existingIndex = indexById.get(liveMessage.id);
    if (existingIndex !== undefined) {
      const persistedMessage = merged[existingIndex];
      if (liveMessage.content.length > persistedMessage.content.length) {
        const metadataSource =
          liveMessage.metadata?.source ?? persistedMessage.metadata?.source;
        const mergedMetadata =
          metadataSource &&
          (persistedMessage.metadata || liveMessage.metadata)
            ? {
                ...persistedMessage.metadata,
                ...liveMessage.metadata,
                source: metadataSource,
              }
            : undefined;
        merged[existingIndex] = {
          ...persistedMessage,
          ...liveMessage,
          metadata: mergedMetadata,
        };
      }
      continue;
    }
    if (hasEquivalentPersistedMessage(merged, liveMessage)) {
      continue;
    }
    merged.push(liveMessage);
    indexById.set(liveMessage.id, merged.length - 1);
  }

  return merged;
};

// ---------------------------------------------------------------------------
// Attachment upload state
// ---------------------------------------------------------------------------
const isPreparingAttachments = ref(false);
const attachmentError = ref<string | null>(null);

const MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024;

function classifyAttachment(fileName: string, mimeType: string): ChatV2AttachmentKind | null {
  const name = fileName.toLowerCase();
  const mime = mimeType.toLowerCase();

  if (mime.startsWith("image/")) return "image";
  if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image";
  if (name.endsWith(".webp") || name.endsWith(".gif")) return "image";

  if (mime === "application/pdf" || name.endsWith(".pdf")) return "document";
  if (mime === "text/csv" || mime === "application/csv" || name.endsWith(".csv")) return "document";
  if (name.endsWith(".docx") || mime.includes("wordprocessingml.document")) return "document";
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || mime.includes("spreadsheetml.sheet")) return "document";

  return null;
}

function defaultPromptForAttachments(files: File[]): string {
  const images = files.filter((f) => classifyAttachment(f.name, f.type) === "image");
  if (images.length > 0 && files.every((f) => classifyAttachment(f.name, f.type) === "image")) {
    return "What is in this image?";
  }
  return "";
}

function resolveMimeType(file: File): string {
  if (file.type && file.type !== "application/octet-stream") {
    return file.type;
  }
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".csv")) return "text/csv";
  if (name.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (name.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (name.endsWith(".xls")) return "application/vnd.ms-excel";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  return file.type || "application/octet-stream";
}

async function buildUploadedAttachments(files: File[]): Promise<ChatV2UploadedAttachment[]> {
  const out: ChatV2UploadedAttachment[] = [];
  for (const file of files) {
    const kind = classifyAttachment(file.name, file.type);
    if (!kind) throw new Error(`Unsupported file type: ${file.name}`);
    if (file.size > MAX_UPLOAD_FILE_BYTES) throw new Error(`File too large: ${file.name}`);

    if (kind === "image") {
      // Downscale + recompress before base64 so the inline data URL stays
      // small enough for the AI server's request-body limit (large photos
      // otherwise trip HTTP 413 "Request Entity Too Large"). Falls back to
      // the original bytes if canvas processing fails.
      const processed = await downscaleImageAttachment(file);
      out.push({
        fileName: file.name,
        mimeType: processed.mimeType,
        sizeBytes: processed.sizeBytes,
        contentBase64: processed.contentBase64,
        kind,
      });
    } else {
      const buffer = await file.arrayBuffer();
      out.push({
        fileName: file.name,
        mimeType: resolveMimeType(file),
        sizeBytes: file.size,
        contentBase64: arrayBufferToBase64(buffer),
        kind,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tool approval mode
// ---------------------------------------------------------------------------
const toolApprovalMode = ref<ChatToolApprovalMode>("ask_for_approval");

async function loadToolApprovalMode(conversationId: string | null): Promise<void> {
  if (!conversationId) {
    toolApprovalMode.value = "ask_for_approval";
    return;
  }
  try {
    const mode = await getChatV2ToolApprovalMode(conversationId);
    toolApprovalMode.value = mode;
  } catch {
    toolApprovalMode.value = "ask_for_approval";
  }
}

function handleAgentTaskCancel(agentTaskId: string): void {
  // Agent task cancellation is wired in a later milestone.
  console.log("[AiChatV2] cancel-task requested:", agentTaskId);
}

async function onToolApprovalModeChange(mode: ChatToolApprovalMode): Promise<void> {
  toolApprovalMode.value = mode;
  if (!activeConversationId.value) return;
  try {
    const saved = await setChatV2ToolApprovalMode(activeConversationId.value, mode);
    toolApprovalMode.value = saved;
  } catch (err) {
    console.error("[AiChatV2] failed to save tool approval mode:", err);
    toolApprovalMode.value = "ask_for_approval";
  }
}

// ---------------------------------------------------------------------------
// Workspace tracking
// ---------------------------------------------------------------------------
// Active workspace for the current conversation. Null when no conversation is
// selected or the conversation has no workspace yet. Drives the badge.
const activeWorkspace = ref<WorkspaceSummary | null>(null);
// True when the active conversation has no workspace — shows the pick card.
const showWorkspaceRequired = ref(false);

// Workspace memory panel + count for the active approved workspace.
const showWorkspaceMemory = ref(false);
const workspaceMemoryCount = ref(0);

function openWorkspaceMemory(): void {
  if (!activeWorkspace.value || activeWorkspace.value.approvalState !== "approved") {
    showWorkspaceMemory.value = false;
    return;
  }
  showWorkspaceMemory.value = true;
}

async function refreshWorkspaceMemoryCount(): Promise<void> {
  if (!activeConversationId.value || !activeWorkspace.value || activeWorkspace.value.approvalState !== "approved") {
    workspaceMemoryCount.value = 0;
    return;
  }
  try {
    // One IPC + DB round-trip: fetch up to 200 active memories and use the
    // returned length as the badge count (capped at 200, which is plenty for
    // a badge — beyond that the exact number doesn't matter to the user).
    const resp = await workspaceMemoryApi.list({
      conversationId: activeConversationId.value,
      status: "active",
      limit: 200,
    });
    workspaceMemoryCount.value =
      resp.status && Array.isArray(resp.data) ? resp.data.length : 0;
  } catch {
    workspaceMemoryCount.value = 0;
  }
}

function createLocalConversationId(): string {
  const randomId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `v2-${randomId}`;
}

function ensureWorkspaceConversationId(): string {
  if (activeConversationId.value) {
    return activeConversationId.value;
  }
  const conversationId = createLocalConversationId();
  activeConversationId.value = conversationId;
  messages.value = [];
  streamError.value = null;
  applyPlanState(null);
  pendingQuestion.value = null;
  pendingPlanApproval.value = null;
  return conversationId;
}

function handleWorkspaceSetupRequest(): void {
  if (activeWorkspace.value) return;
  ensureWorkspaceConversationId();
  showWorkspaceRequired.value = true;
}

/**
 * Fetch the workspace (if any) for the given conversation and update the
 * badge/required-card state. Called on mount and whenever the active
 * conversation changes.
 */
async function refreshWorkspace(conversationId: string | null): Promise<void> {
  if (!conversationId) {
    activeWorkspace.value = null;
    showWorkspaceRequired.value = false;
    void refreshWorkspaceMemoryCount();
    return;
  }
  try {
    const ws = await getWorkspace(conversationId);
    activeWorkspace.value = ws
      ? {
          id: ws.id,
          conversationId: ws.conversationId,
          rootPath: ws.rootPath,
          label: ws.label,
          approvalState: ws.approvalState,
        }
      : null;
    showWorkspaceRequired.value = false;
  } catch {
    // non-fatal; treat as no workspace
    activeWorkspace.value = null;
    showWorkspaceRequired.value = false;
  }
  void refreshWorkspaceMemoryCount();
}

/**
 * Handler for the WorkspaceRequiredCard's `approved` event. Updates the badge
 * to reflect the newly-created + approved workspace and hides the card.
 */
function onWorkspaceApproved(
  workspaceId: number,
  rootPath: string
): void {
  activeWorkspace.value = {
    id: workspaceId,
    conversationId: activeConversationId.value ?? "",
    rootPath,
    label: null,
    approvalState: "approved",
  };
  showWorkspaceRequired.value = false;
}

// Refresh the workspace badge whenever the active conversation changes.
watch(activeConversationId, (id) => {
  void refreshWorkspace(id);
});

// Conversation search state
const conversationSearch = ref("");
const searchingConversations = ref(false);
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Context usage tracking
// ---------------------------------------------------------------------------
// Map of model id → context window size (tokens), populated from the models
// API on mount. Falls back to DEFAULT_CONTEXT_WINDOW when unknown.
const modelContextWindows = ref<Map<string, number>>(new Map());
// Last real usage report from the server for the active conversation.
const lastUsage = ref<{
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model?: string;
} | null>(null);
// Live-running estimate of context tokens; updated on each streamed token
// delta and snapped back to the real value when usage arrives. This is what
// the badge displays while a turn is in progress.
const streamingEstimatedTokens = ref(0);
// Model id currently in use (tracked from start/usage events), used to look
// up the context window denominator.
const activeModel = ref<string | undefined>(undefined);
// Server-reported default model id from /api/ai/v1/models. Used to resolve
// the "Auto" selector option to a concrete model for stream requests and
// for context-window lookup.
const defaultModelId = ref<string | undefined>(undefined);

// ---------------------------------------------------------------------------
// Model selector
// ---------------------------------------------------------------------------
// localStorage key for the user's last-chosen model. Survives app restarts.
const LAST_MODEL_STORAGE_KEY = "ai-chat-v2-last-model";
// Available models for the dropdown. Populated from the same /api/ai/v1/models
// call that feeds modelContextWindows, so we only fetch once.
const availableModels = ref<OpenAIModel[]>([]);
// User's selected model id. Sent on every stream request. Resolved on mount
// via: saved localStorage choice → server default_model → first model id.
const selectedModel = ref<string | undefined>(undefined);

const resolveContextWindowLocal = (model?: string): number =>
  resolveContextWindow(modelContextWindows.value, model);

/**
 * The concrete model id used for context-window lookup. Prefers the model
 * the server actually used (reported via usage_update/start); falls back to
 * the user's explicit selection; finally resolves "Auto" to the server's
 * default_model so the badge shows a meaningful denominator before the
 * first response arrives.
 */
const effectiveModel = computed(() => {
  if (lastUsage.value?.model) return lastUsage.value.model;
  if (activeModel.value) return activeModel.value;
  const sel = selectedModel.value;
  if (sel && sel !== AUTO_MODEL_VALUE) return sel;
  return defaultModelId.value;
});

const contextPercent = computed(() =>
  computeContextPercent({
    modelContextWindows: modelContextWindows.value,
    lastTotalTokens: lastUsage.value?.totalTokens,
    streamingEstimatedTokens: streamingEstimatedTokens.value,
    model: effectiveModel.value,
  })
);

const contextUsedTokens = computed(
  () =>
    streamingEstimatedTokens.value ||
    lastUsage.value?.totalTokens ||
    0
);

const contextTotalTokens = computed(() =>
  resolveContextWindowLocal(effectiveModel.value)
);

const loadModelContextWindows = async (
  options: { resetSelection?: boolean } = {}
): Promise<void> => {
  try {
    if (options.resetSelection) {
      availableModels.value = [];
      defaultModelId.value = undefined;
      modelContextWindows.value = new Map();
      selectedModel.value = undefined;
      activeModel.value = undefined;
      lastUsage.value = null;
      streamingEstimatedTokens.value = 0;
    }
    const resp = await getOpenAIChatModels();
    const data = resp?.data;
    if (!Array.isArray(data)) return;
    const validModels = data.filter(
      (m) => m && typeof m.id === "string" && m.id.length > 0
    );
    availableModels.value = validModels;
    defaultModelId.value = resp?.default_model;
    const map = new Map<string, number>();
    for (const model of validModels) {
      if (!model || typeof model.id !== "string") continue;
      // The AI server reports context size as `context_size`; older
      // OpenAI-compatible servers use `context_window` or `context_length`.
      const window =
        model.context_size ??
        model.context_window ??
        model.context_length ??
        DEFAULT_CONTEXT_WINDOW;
      if (typeof window === "number" && window > 0) {
        map.set(model.id, window);
      }
    }
    modelContextWindows.value = map;
    // Resolve the initial model selection once the list is available. Don't
    // override a selection that was already made (e.g. restored from storage
    // before this async load completed, or changed by the user).
    if (options.resetSelection || selectedModel.value === undefined) {
      selectedModel.value = resolveInitialModel(validModels);
    }
  } catch {
    // non-fatal; denominator falls back to DEFAULT_CONTEXT_WINDOW
  }
};

/**
 * Pick the initial model for the selector. Priority:
 *   1. Saved localStorage choice — "auto" is always valid; a concrete id
 *      must still be present in the available list.
 *   2. "Auto" — lets the server pick default_model for us.
 */
const resolveInitialModel = (models: OpenAIModel[]): string => {
  const ids = new Set(models.map((m) => m.id));
  try {
    const saved = window.localStorage.getItem(LAST_MODEL_STORAGE_KEY);
    if (saved === AUTO_MODEL_VALUE) return AUTO_MODEL_VALUE;
    if (typeof saved === "string" && saved.length > 0 && ids.has(saved)) {
      return saved;
    }
  } catch {
    // localStorage may be unavailable (private mode, etc.) — ignore.
  }
  return AUTO_MODEL_VALUE;
};

/**
 * Resolve the model id to send in stream requests. A concrete selection is
 * passed through; "Auto" resolves to the server's default_model. If the
 * default is unknown (e.g. models API failed), undefined is sent so the
 * server falls back to its own default.
 */
const resolveModelForRequest = (): string | undefined => {
  const sel = selectedModel.value;
  if (typeof sel === "string" && sel.length > 0 && sel !== AUTO_MODEL_VALUE) {
    return sel;
  }
  return defaultModelId.value;
};

// Persist the user's model choice so it survives app restarts.
watch(selectedModel, (val) => {
  if (typeof val !== "string" || val.length === 0) return;
  try {
    window.localStorage.setItem(LAST_MODEL_STORAGE_KEY, val);
  } catch {
    // non-fatal; selection still works for the session
  }
});

// ---------------------------------------------------------------------------
// Provider indicator (Hosted vs Local). Loaded once on mount; the chip near
// the model selector reflects which provider is active and links to settings.
// ---------------------------------------------------------------------------
// `router` is shared with the rest of the component (declared above).
const providerSettings = ref<AIProviderSettingsView | null>(null);

const providerLabel = computed<string>(() => {
  const view = providerSettings.value;
  if (!view) return "";
  if (view.mode === "hosted") {
    return t("aiProvider.indicator_hosted") || "Hosted";
  }
  if (view.localProvider) {
    const name = view.localProvider.name || view.localProvider.preset;
    return `${t("aiProvider.indicator_local") || "Local"}: ${name}`;
  }
  return t("aiProvider.indicator_offline") || "Local offline";
});

const providerChipColor = computed<string>(() => {
  const view = providerSettings.value;
  if (!view) return "grey";
  if (view.mode === "hosted") return "primary";
  return view.localProvider ? "success" : "warning";
});

/** Local providers use tools only when capability is explicitly supported. */
const localToolsUnsupported = computed<boolean>(() => {
  const view = providerSettings.value;
  return (
    !!view &&
    view.mode === "local" &&
    view.localProvider?.capabilities?.tools !== "supported"
  );
});

async function loadProviderSettings(): Promise<void> {
  try {
    providerSettings.value = await getAIProviderSettings();
  } catch {
    // Non-fatal: indicator simply stays blank.
  }
}

function isAIProviderSettingsView(value: unknown): value is AIProviderSettingsView {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AIProviderSettingsView>;
  return candidate.mode === "hosted" || candidate.mode === "local";
}

async function refreshProviderStateAfterChange(
  view?: AIProviderSettingsView
): Promise<void> {
  if (view) {
    providerSettings.value = view;
  } else {
    await loadProviderSettings();
  }
  await loadModelContextWindows({ resetSelection: true });
}

function handleProviderSettingsChanged(event: Event): void {
  const detail = event instanceof CustomEvent ? event.detail : undefined;
  const view = isAIProviderSettingsView(detail) ? detail : undefined;
  void refreshProviderStateAfterChange(view);
}

function openAIProviderSettings(): void {
  router.push({ name: "system_setting_ai_provider" });
}

const hasLoadedPendingToolExecution = computed(() => {
  const conversationId = activeConversationId.value;
  if (!conversationId) return false;
  if (stoppedPendingToolConversationIds.value.has(conversationId)) {
    return false;
  }
  return hasPendingToolExecution(messages.value);
});

const chatIsRunning = computed(
  () => isStreaming.value || hasLoadedPendingToolExecution.value
);

const hasAnyActiveStream = computed(() => {
  for (const state of conversationRuntime.value.values()) {
    if (state.isStreaming) return true;
  }
  return false;
});

/**
 * A conversation shows a running indicator if it owns a live stream, even when
 * the user has switched away from it. Pending tool execution is only known for
 * the currently loaded conversation history, so that remains active-only.
 */
const isConversationRunning = (conversationId: string): boolean =>
  conversationRuntime.value.get(conversationId)?.isStreaming === true ||
  (conversationId === activeConversationId.value &&
    hasLoadedPendingToolExecution.value);

const isPermissionPromptMessage = (message: ChatV2MessageView): boolean => {
  if (message.messageType !== MessageType.TOOL_RESULT) return false;
  return message.metadata?.toolResult?.needsPermissionPrompt === true;
};

const pinnedPermissionPrompt = computed<ChatV2MessageView | null>(() => {
  for (let i = messages.value.length - 1; i >= 0; i -= 1) {
    const message = messages.value[i];
    if (isPermissionPromptMessage(message)) {
      return message;
    }
  }
  return null;
});

const visibleMessages = computed<ChatV2MessageView[]>(() => {
  const pinnedId = pinnedPermissionPrompt.value?.id;
  if (!pinnedId) return messages.value;
  return messages.value.filter((message) => message.id !== pinnedId);
});

const pinnedPermissionToolResult = computed<Record<string, unknown>>(
  () => pinnedPermissionPrompt.value?.metadata?.toolResult ?? {}
);

const pinnedPermissionToolName = computed(() => {
  const toolName = pinnedPermissionPrompt.value?.metadata?.toolName;
  return typeof toolName === "string" ? toolName : "";
});

const pinnedPermissionCategory = computed(() => {
  const category = pinnedPermissionToolResult.value.permissionCategory;
  return typeof category === "string" ? category : "";
});

const pinnedPermissionShellPreview = computed<ShellPreview | undefined>(() => {
  const preview = pinnedPermissionToolResult.value.shellPreview;
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

const permissionResumeInFlightToolIds = ref<Set<string>>(new Set());

const setPermissionResumeInFlight = (
  toolId: string,
  inFlight: boolean
): void => {
  const next = new Set(permissionResumeInFlightToolIds.value);
  if (inFlight) {
    next.add(toolId);
  } else {
    next.delete(toolId);
  }
  permissionResumeInFlightToolIds.value = next;
};

const pinnedPermissionResumeInFlight = computed(() => {
  const toolId = pinnedPermissionPrompt.value
    ? resolveToolIdForPermissionMessage(pinnedPermissionPrompt.value)
    : undefined;
  return !!toolId && permissionResumeInFlightToolIds.value.has(toolId);
});

// True only between clicking send and the first visible AI chunk. Auto-clears
// when streaming ends for any reason (complete/error/stop/permission deny).
// Also shows during tool execution rounds (after tool_call/tool_result, before
// the next text token) so the user sees the AI is still working.
const showTypingIndicator = computed(() => {
  if (hasLoadedPendingToolExecution.value) return true;
  if (!isStreaming.value) return false;
  if (!receivedFirstResponse.value) return true;
  // Between tool rounds: last message is a tool call/result with no
  // active text streaming — show dots so the user knows the AI is processing.
  const last = messages.value[messages.value.length - 1];
  if (!last) return true;
  return (
    last.messageType === MessageType.TOOL_CALL ||
    last.messageType === MessageType.TOOL_RESULT
  );
});

// Plan Mode state
const mode = ref<ChatV2Mode>("chat");
const planState = ref<AIChatPlanStateView | null>(null);
const pendingQuestion = ref<AIChatPlanQuestionView | null>(null);
// While a plan is awaiting the user's decision, its approval card is pinned
// at the bottom of the chat (alongside the question card). Once the user
// approves/rejects/requests changes, it is moved into the message flow and
// this ref is cleared.
const pendingPlanApproval = ref<AIChatPlanStateView | null>(null);

// ---------------------------------------------------------------------------
// File operation tracking
// ---------------------------------------------------------------------------
// Map of conversationId → file operation records emitted via IPC during
// tool execution (create/overwrite/edit). Shown as a collapsible summary
// panel above the composer so the user can see what the AI changed.
const fileOps = ref<Map<string, readonly FileOperationRecord[]>>(new Map());
const showFileOpsPanel = ref(true);
const currentFileOps = computed<readonly FileOperationRecord[]>(() => {
  if (!activeConversationId.value) return [];
  return fileOps.value.get(activeConversationId.value) ?? [];
});
const createCount = computed(
  () => currentFileOps.value.filter((r) => r.type === "create").length
);
const editCount = computed(
  () => currentFileOps.value.filter((r) => r.type === "edit").length
);
const overwriteCount = computed(
  () => currentFileOps.value.filter((r) => r.type === "overwrite").length
);

const applyPlanState = (state: AIChatPlanStateView | null): void => {
  planState.value = state;
  if (
    state &&
    state.status !== "completed" &&
    state.status !== "cancelled" &&
    state.status !== "rejected"
  ) {
    mode.value = "plan";
  }
};

const streamStatus = computed<Status>(() => {
  if (chatIsRunning.value) return "streaming";
  if (streamError.value) return "error";
  const last = messages.value[messages.value.length - 1];
  if (last?.metadata?.cancelled) return "cancelled";
  return "idle";
});

const truncateText = (text: string | undefined, max: number): string => {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "..." : text;
};

const formatTimestamp = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return "";
  }
};

/**
 * Map a backend-mapped error string to a user-facing, translated message.
 * The backend {@link userSafeError} returns sentinel codes for known error
 * classes (e.g. QUOTA_EXHAUSTED for HTTP 402); unknown strings pass through
 * verbatim so ad-hoc server messages still surface.
 */
const mapStreamErrorMessage = (raw: string): string => {
  if (raw === QUOTA_EXHAUSTED_SENTINEL) {
    return (
      t("aiChatV2.quota_exhausted") ||
      "The AI tokens included in your subscription plan have been exhausted. Please recharge your account to continue using AI features."
    );
  }
  return raw;
};

const loadConversations = async (): Promise<void> => {
  try {
    conversations.value = await getChatV2Conversations();
  } catch {
    // non-fatal; leave list empty
  }
};

/**
 * Debounced conversation search. Empty query reloads the full list;
 * non-empty query filters conversations by message content server-side.
 */
const runConversationSearch = (query: string): void => {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
  searchDebounceTimer = setTimeout(async () => {
    searchDebounceTimer = null;
    searchingConversations.value = true;
    try {
      const q = query.trim();
      conversations.value = await getChatV2Conversations(
        q.length > 0 ? q : undefined
      );
    } catch {
      // non-fatal; keep previous list
    } finally {
      searchingConversations.value = false;
    }
  }, 300);
};

// Debounced search as the user types
watch(conversationSearch, (val) => {
  const query = (val ?? "").trim();
  runConversationSearch(query);
});

// Reset search when the dialog opens
watch(showConversationsDialog, (open) => {
  if (open) {
    conversationSearch.value = "";
    void loadConversations();
  }
});

const loadHistory = async (conversationId: string): Promise<void> => {
  try {
    const resp = await getChatV2History(conversationId);
    if (activeConversationId.value !== conversationId) return;
    // Persisted tool-result rows store only the raw `toolResult` (with the
    // artifact nested under .artifact), not the renderer's `metadata.artifact`
    // shortcut. Re-derive it on load so artifact cards reappear on history
    // reopen (PRD ART-009). Auto-open is NOT triggered here — only live
    // tool_result chunks auto-open.
    const persistedMessages = (resp?.messages ?? []).map(
      ensureArtifactMetadata
    );
    const runtime = conversationRuntime.value.get(conversationId);
    messages.value =
      runtime?.isStreaming && runtime.messages.length > 0
        ? mergePersistedAndLiveMessages(persistedMessages, runtime.messages)
        : persistedMessages;
    if (runtime?.isStreaming) {
      patchConversationRuntimeState(conversationId, {
        messages: messages.value,
      });
    }
    // Reset context-usage tracking for the loaded conversation. If any
    // history rows carry tokensUsed, seed the baseline estimate from the
    // most recent assistant message; otherwise start at zero until the
    // next server usage_update arrives.
    lastUsage.value = null;
    const latestWithTokens = [...messages.value]
      .reverse()
      .find(
        (m) =>
          m.role === "assistant" &&
          typeof m.tokensUsed === "number" &&
          m.tokensUsed > 0
      );
    streamingEstimatedTokens.value =
      typeof latestWithTokens?.tokensUsed === "number"
        ? latestWithTokens.tokensUsed
        : 0;
    if (latestWithTokens?.model) {
      activeModel.value = latestWithTokens.model;
    }
    // Load plan state for this conversation.
    try {
      const nextPlanState = await getChatV2PlanState(conversationId);
      if (activeConversationId.value !== conversationId) return;
      applyPlanState(nextPlanState);
      if (planState.value?.pendingQuestion) {
        pendingQuestion.value = planState.value.pendingQuestion;
      } else {
        pendingQuestion.value = null;
      }
      // If the plan has content, decide where to render it:
      //  - awaiting_approval → pin at the bottom so the user can act on it
      //  - any other status → render inline as part of the history
      pendingPlanApproval.value = null;
      if (planState.value?.latestVersion) {
        if (planState.value.status === "awaiting_approval") {
          pendingPlanApproval.value = planState.value;
        } else {
          upsertPlanMessage(planState.value);
        }
      }
    } catch {
      applyPlanState(null);
      pendingQuestion.value = null;
      pendingPlanApproval.value = null;
    }
    // Load tool approval mode for this conversation
    void loadToolApprovalMode(conversationId);
  } catch (err) {
    if (activeConversationId.value !== conversationId) return;
    streamError.value = err instanceof Error ? err.message : String(err);
  }
};

const onNewConversation = (): void => {
  activeConversationId.value = null;
  messages.value = [];
  resetActiveRuntimeFields();
  applyPlanState(null);
  pendingQuestion.value = null;
  pendingPlanApproval.value = null;
  // Reset context-usage tracking for the new conversation.
  lastUsage.value = null;
  streamingEstimatedTokens.value = 0;
  activeModel.value = undefined;
  toolApprovalMode.value = "ask_for_approval";
};

const onClearMessages = (): void => {
  onNewConversation();
};

async function clearCurrentConversation(): Promise<void> {
  const conversationId = activeConversationId.value;
  if (conversationId) {
    try {
      await clearChatV2Conversation(conversationId);
      clearConversationRuntimeState(conversationId);
    } catch (err) {
      streamError.value = err instanceof Error ? err.message : String(err);
      return;
    }
  }
  onNewConversation();
}

const onSelectConversation = (conversationId: string): void => {
  speechController.stop();
  detachActiveStreamView();
  activeConversationId.value = conversationId;
  const runtime = conversationRuntime.value.get(conversationId);
  if (runtime) {
    applyRuntimeFieldsToActive(runtime, { applyMessages: true });
  } else {
    messages.value = [];
    resetActiveRuntimeFields();
  }
  showConversationsDialog.value = false;
  void loadHistory(conversationId);
};

const detachActiveStreamView = (): void => {
  clearChatV2StreamListeners();
  resetActiveRuntimeFields();
};

const onStop = (): void => {
  speechController.stop();
  stopChatV2Stream();
  clearChatV2StreamListeners();
  const conversationId = activeConversationId.value;
  if (conversationId) {
    markActiveConversationRuntimeStopped();
    stoppedPendingToolConversationIds.value = new Set([
      ...stoppedPendingToolConversationIds.value,
      conversationId,
    ]);
  }
};

const resolveToolIdForPermissionMessage = (
  message: ChatV2MessageView
): string | undefined => {
  const direct = message.metadata?.toolCallId;
  if (typeof direct === "string" && direct.length > 0) {
    return direct;
  }
  const toolName = message.metadata?.toolName;
  if (!toolName) {
    return undefined;
  }
  const idx = messages.value.findIndex((m) => m.id === message.id);
  for (let i = idx - 1; i >= 0; i -= 1) {
    const candidate = messages.value[i];
    if (
      candidate.messageType === MessageType.TOOL_CALL &&
      candidate.metadata?.toolName === toolName &&
      candidate.metadata?.toolCallId
    ) {
      return candidate.metadata.toolCallId;
    }
  }
  return undefined;
};

const upsertToolProgress = (
  chunk: ChatV2StreamChunk,
  conversationId: string,
  list: MessageListController = activeMessageListController
): void => {
  if (!chunk.toolCallId) return;
  const currentMessages = list.get();
  const idx = currentMessages.findIndex(
    (m) =>
      m.messageType === MessageType.TOOL_CALL &&
      m.metadata?.toolCallId === chunk.toolCallId
  );
  if (idx === -1) {
    return;
  }
  const existing = currentMessages[idx];
  const nextProgress: {
    phase?: "queued" | "running" | "fetching" | "extracting" | "finalizing";
    message?: string;
    progress: number | null;
    partialCount: number | null;
    expectedCount: number | null;
    updatedAt: number;
  } = {
    phase: chunk.phase,
    message: chunk.progressMessage,
    progress:
      typeof chunk.progressFraction === "number" ? chunk.progressFraction : null,
    partialCount: chunk.partialCount ?? null,
    expectedCount: chunk.expectedCount ?? null,
    updatedAt: chunk.progressTimestamp ?? Date.now(),
  };
  const updatedMessage: ChatV2MessageView = {
    ...existing,
    metadata: {
      ...existing.metadata,
      toolProgress: nextProgress,
    } as ChatV2MessageMetadata,
  };
  list.set([
    ...currentMessages.slice(0, idx),
    updatedMessage,
    ...currentMessages.slice(idx + 1),
  ]);
};

const upsertToolResultMessage = (
  chunk: ChatV2StreamChunk,
  conversationId: string,
  insertBeforeAssistantId?: string,
  list: MessageListController = activeMessageListController
): void => {
  const currentMessages = list.get();
  const toolResult = chunk.toolResult ?? {};
  if (
    chunk.toolCallId &&
    toolResult.needsPermissionPrompt !== true &&
    permissionResumeInFlightToolIds.value.has(chunk.toolCallId)
  ) {
    setPermissionResumeInFlight(chunk.toolCallId, false);
  }
  const content =
    typeof chunk.fullContent === "string" && chunk.fullContent.trim().length > 0
      ? chunk.fullContent
      : JSON.stringify(toolResult, null, 2);
  const existingIdx = chunk.replacesPermissionPromptForToolId
    ? currentMessages.findIndex(
        (message) =>
          message.messageType === MessageType.TOOL_RESULT &&
          message.metadata?.toolCallId ===
            chunk.replacesPermissionPromptForToolId
      )
    : -1;

  const metadata = {
    source: "chat-v2" as const,
    toolCallId: chunk.toolCallId,
    toolName: chunk.toolName,
    toolResult,
    toolResultStatus:
      toolResult.success === false ? ("error" as const) : ("success" as const),
    toolResultSummary:
      typeof toolResult.summary === "string" ? toolResult.summary : undefined,
    success: toolResult.success !== false,
    executionTimeMs:
      typeof toolResult.executionTimeMs === "number"
        ? toolResult.executionTimeMs
        : undefined,
    summary:
      typeof toolResult.summary === "string" ? toolResult.summary : undefined,
    error: typeof toolResult.error === "string" ? toolResult.error : undefined,
    artifact: extractArtifactMetadata(toolResult),
  };

  if (existingIdx !== -1) {
    const updatedMessages = [...currentMessages];
    updatedMessages[existingIdx] = {
      ...updatedMessages[existingIdx],
      content,
      metadata: {
        ...updatedMessages[existingIdx].metadata,
        ...metadata,
      },
    };
    list.set(updatedMessages);
    return;
  }

  if (
    chunk.toolCallId &&
    currentMessages.some(
      (message) =>
        message.messageType === MessageType.TOOL_RESULT &&
        message.metadata?.toolCallId === chunk.toolCallId
    )
  ) {
    return;
  }

  const toolResultMsg: ChatV2MessageView = {
    id: `tool-result-${chunk.toolCallId || Date.now()}`,
    conversationId,
    role: "assistant",
    content,
    timestamp: new Date().toISOString(),
    messageType: MessageType.TOOL_RESULT,
    metadata,
  };
  // Insert before the assistant placeholder so tool results always
  // appear before the assistant's text response.
  if (insertBeforeAssistantId) {
    const aIdx = currentMessages.findIndex(
      (m) => m.id === insertBeforeAssistantId
    );
    if (aIdx !== -1) {
      list.set([
        ...currentMessages.slice(0, aIdx),
        toolResultMsg,
        ...currentMessages.slice(aIdx),
      ]);
      return;
    }
  }
  list.set([...currentMessages, toolResultMsg]);
};

const handleSkillPermissionGrant = async (
  message: ChatV2MessageView,
  _persistent?: boolean
): Promise<void> => {
  const toolId = resolveToolIdForPermissionMessage(message);
  if (!toolId) {
    const errMsg =
      t("aiChatV2.permission_resume_no_tool_id") ||
      "Missing tool call information; cannot continue execution.";
    markConversationRuntimeStopped(message.conversationId, errMsg);
    return;
  }

  if (permissionResumeInFlightToolIds.value.has(toolId)) {
    return;
  }

  setPermissionResumeInFlight(toolId, true);

  try {
    const raw = await windowInvoke(AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION, {
      toolId,
      conversationId: message.conversationId || activeConversationId.value,
    });
    const res = raw as { ok: boolean; error?: string } | null;
    if (!res?.ok) {
      const errMsg =
        res?.error ||
        t("aiChatV2.permission_resume_failed") ||
        "Could not continue the tool after permission was granted.";
      const idx = messages.value.findIndex((m) => m.id === message.id);
      if (idx !== -1) {
        messages.value[idx] = {
          ...messages.value[idx],
          content: errMsg,
          metadata: {
            ...messages.value[idx].metadata,
            source: "chat-v2",
            toolResult: { error: errMsg, success: false },
            success: false,
            error: errMsg,
          },
        };
      }
      markConversationRuntimeStopped(message.conversationId, errMsg);
      setPermissionResumeInFlight(toolId, false);
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    markConversationRuntimeStopped(message.conversationId, errMsg);
    setPermissionResumeInFlight(toolId, false);
  }
};

const handlePinnedPermissionGrant = (payload: { persistent: boolean }): void => {
  const message = pinnedPermissionPrompt.value;
  if (!message) return;
  void handleSkillPermissionGrant(message, payload.persistent);
};

const handleSkillPermissionDeny = (message: ChatV2MessageView): void => {
  const idx = messages.value.findIndex((m) => m.id === message.id);
  const deniedMessage =
    t("aiChatV2.permission_denied") ||
    "Permission denied. The tool will not be executed.";
  if (idx !== -1) {
    messages.value[idx] = {
      ...messages.value[idx],
      content: deniedMessage,
      metadata: {
        ...messages.value[idx].metadata,
        source: "chat-v2",
        toolResult: undefined,
        success: false,
      },
    };
  }
  clearChatV2StreamListeners();
  stopChatV2Stream();
  markConversationRuntimeStopped(message.conversationId);
};

const handlePinnedPermissionDeny = (): void => {
  const message = pinnedPermissionPrompt.value;
  if (!message) return;
  handleSkillPermissionDeny(message);
};

// ---------------------------------------------------------------------------
// Plan Mode handlers
// ---------------------------------------------------------------------------

const isSubmitPlanToolMessage = (message: ChatV2MessageView): boolean =>
  message.metadata?.toolName === "SubmitPlanForApproval";

const readPlanToolResultVersion = (
  message: ChatV2MessageView
): { planId?: string; version?: number } | null => {
  if (message.messageType !== MessageType.TOOL_RESULT) return null;
  const result = message.metadata?.toolResult;
  if (result) {
    return {
      planId: typeof result.planId === "string" ? result.planId : undefined,
      version: typeof result.version === "number" ? result.version : undefined,
    };
  }
  try {
    const parsed = JSON.parse(message.content) as Record<string, unknown>;
    return {
      planId: typeof parsed.planId === "string" ? parsed.planId : undefined,
      version: typeof parsed.version === "number" ? parsed.version : undefined,
    };
  } catch {
    return null;
  }
};

const findPlanMessageInsertionIndex = (
  state: AIChatPlanStateView,
  existingPlanIndex: number,
  list: MessageListController = activeMessageListController
): number => {
  const currentMessages = list.get();
  let fallbackIndex = -1;
  for (let i = currentMessages.length - 1; i >= 0; i -= 1) {
    if (i === existingPlanIndex) continue;
    const message = currentMessages[i];
    if (!isSubmitPlanToolMessage(message)) continue;
    fallbackIndex = i + 1;
    const versionInfo = readPlanToolResultVersion(message);
    if (
      versionInfo?.planId === state.planId &&
      versionInfo.version === state.currentVersion
    ) {
      return i + 1;
    }
  }
  if (fallbackIndex !== -1) return fallbackIndex;

  const planCreatedAt = state.latestVersion
    ? Date.parse(state.latestVersion.createdAt)
    : NaN;
  if (!Number.isNaN(planCreatedAt)) {
    const chronologicalIndex = currentMessages.findIndex((message, index) => {
      if (index === existingPlanIndex) return false;
      const messageTime = Date.parse(message.timestamp);
      return !Number.isNaN(messageTime) && messageTime > planCreatedAt;
    });
    if (chronologicalIndex !== -1) return chronologicalIndex;
  }

  return currentMessages.length;
};

/**
 * Insert or update the inline plan-approval message row so the card appears
 * in the conversation flow (not pinned at the bottom). After approval/reject
 * the row stays in place; later messages render below it.
 */
const upsertPlanMessage = (
  state: AIChatPlanStateView,
  list: MessageListController = activeMessageListController
): void => {
  const currentMessages = list.get();
  const planMsgId = `plan-${state.planId}`;
  const existingIdx = currentMessages.findIndex((m) => m.id === planMsgId);
  const insertIdx = findPlanMessageInsertionIndex(state, existingIdx, list);
  const metadata = {
    source: "chat-v2" as const,
    planEventType: "plan_submitted" as const,
    planId: state.planId,
    planStateView: state,
  };
  const planMessage: ChatV2MessageView = {
    id: planMsgId,
    conversationId: state.conversationId,
    role: "assistant",
    content: "",
    timestamp: state.latestVersion?.createdAt ?? new Date().toISOString(),
    messageType: "message" as MessageType,
    metadata,
  };
  if (existingIdx !== -1) {
    const existingMessage = currentMessages[existingIdx];
    planMessage.timestamp = currentMessages[existingIdx].timestamp;
    planMessage.metadata = {
      ...existingMessage.metadata,
      ...metadata,
    };
    const withoutExisting = currentMessages.filter((m) => m.id !== planMsgId);
    const adjustedInsertIdx =
      existingIdx < insertIdx ? insertIdx - 1 : insertIdx;
    const targetIdx = Math.min(adjustedInsertIdx, withoutExisting.length);
    list.set([
      ...withoutExisting.slice(0, targetIdx),
      planMessage,
      ...withoutExisting.slice(targetIdx),
    ]);
    return;
  }
  list.set([
    ...currentMessages.slice(0, insertIdx),
    planMessage,
    ...currentMessages.slice(insertIdx),
  ]);
};

const handleQuestionAnswered = async (
  questionId: string,
  answers: AskUserQuestionAnswer[]
): Promise<void> => {
  if (!activeConversationId.value) return;
  try {
    await answerChatV2Question(activeConversationId.value, questionId, answers);
    pendingQuestion.value = null;
    // Refresh plan state to reflect the updated status.
    applyPlanState(await getChatV2PlanState(activeConversationId.value));
  } catch (err) {
    streamError.value = err instanceof Error ? err.message : String(err);
  }
};

const handleApprovePlan = async (): Promise<void> => {
  if (!planState.value || !activeConversationId.value) return;
  if (chatIsRunning.value) return;
  try {
    const updated = await approveChatV2Plan(
      activeConversationId.value,
      planState.value.planId,
      planState.value.currentVersion
    );
    if (updated) {
      applyPlanState(updated);
      // Move the card out of the pinned panel into the message flow.
      pendingPlanApproval.value = null;
      upsertPlanMessage(updated);
    }

    // After approval, kick off a new AI round so the assistant begins
    // executing the plan. The plan-mode system prompt now reflects the
    // "approved" status, so high-impact tools are unblocked. This also
    // drives the typing indicator (isStreaming + !receivedFirstResponse).
    const continueText =
      t("aiChatV2Plan.approved_continue_message") ||
      "Plan approved. Please begin executing the plan now.";
    await onSend(continueText);
  } catch (err) {
    streamError.value = err instanceof Error ? err.message : String(err);
  }
};

const handleRejectPlan = async (feedback: string): Promise<void> => {
  if (!planState.value || !activeConversationId.value) return;
  if (chatIsRunning.value) return;
  try {
    const updated = await rejectChatV2Plan(
      activeConversationId.value,
      planState.value.planId,
      planState.value.currentVersion,
      feedback
    );
    if (updated) {
      applyPlanState(updated);
      // Move the card out of the pinned panel into the message flow.
      pendingPlanApproval.value = null;
      upsertPlanMessage(updated);
    }

    // After rejection, send the feedback to the LLM so it can revise
    // the plan or respond accordingly.
    const prefix =
      t("aiChatV2Plan.rejected_continue_message") ||
      "Plan rejected. Please revise the plan based on the following feedback and resubmit for approval.";
    const continueText = feedback
      ? `${prefix}\n\nFeedback: ${feedback}`
      : prefix;
    await onSend(continueText);
  } catch (err) {
    streamError.value = err instanceof Error ? err.message : String(err);
  }
};

const handleRequestPlanChanges = async (feedback: string): Promise<void> => {
  if (!planState.value || !activeConversationId.value) return;
  if (chatIsRunning.value) return;
  try {
    const updated = await requestChatV2PlanChanges(
      activeConversationId.value,
      planState.value.planId,
      planState.value.currentVersion,
      feedback
    );
    if (updated) {
      applyPlanState(updated);
      // Move the card out of the pinned panel into the message flow.
      pendingPlanApproval.value = null;
      upsertPlanMessage(updated);
    }

    // After requesting changes, send the feedback to the LLM so it can
    // update the plan accordingly.
    const prefix =
      t("aiChatV2Plan.changes_requested_continue_message") ||
      "Plan changes requested. Please update the plan based on the following feedback and resubmit for approval.";
    const continueText = feedback
      ? `${prefix}\n\nFeedback: ${feedback}`
      : prefix;
    await onSend(continueText);
  } catch (err) {
    streamError.value = err instanceof Error ? err.message : String(err);
  }
};

const handleCompactConversation = async (): Promise<void> => {
  if (
    !activeConversationId.value ||
    chatIsRunning.value ||
    isCompacting.value
  ) {
    return;
  }
  isCompacting.value = true;
  streamError.value = null;
  try {
    const summary = await compactChatV2Conversation(
      activeConversationId.value,
      resolveModelForRequest()
    );
    if (summary) {
      const tokenEstimate =
        summary.outputTokenEstimate ??
        Math.ceil(summary.summary.length / CHARS_PER_TOKEN_ESTIMATE);
      streamingEstimatedTokens.value = tokenEstimate;
      lastUsage.value = null;
      if (summary.model) {
        activeModel.value = summary.model;
      }
      compactNotice.value = true;
    }
  } catch (err) {
    streamError.value = err instanceof Error ? err.message : String(err);
  } finally {
    isCompacting.value = false;
  }
};

const onSend = async (
  text: string,
  files?: File[],
  options?: { isExpandedPrompt?: boolean }
): Promise<void> => {
  if (chatIsRunning.value || hasAnyActiveStream.value) return;
  streamError.value = null;
  attachmentError.value = null;
  if (activeConversationId.value) {
    const nextStopped = new Set(stoppedPendingToolConversationIds.value);
    nextStopped.delete(activeConversationId.value);
    stoppedPendingToolConversationIds.value = nextStopped;
  }

  // Manual user input that starts with `/` is intercepted as a slash command.
  // An EXPANDED prompt (from handleSlashCommandSubmission) must bypass this —
  // even if its body happens to start with `/`, it is chat content to stream,
  // not a second slash command to re-dispatch (TODO #3).
  if (
    !options?.isExpandedPrompt &&
    (!files || files.length === 0) &&
    text.trim().startsWith("/")
  ) {
    const handled = await handleSlashCommandSubmission(text.trim());
    if (handled) return;
  }

  // Process attachments if present
  let uploadedFiles: ChatV2UploadedAttachment[] | undefined;
  let attachmentMetadata: ChatV2AttachmentMetadata[] | undefined;
  if (files && files.length > 0) {
    isPreparingAttachments.value = true;
    try {
      uploadedFiles = await buildUploadedAttachments(files);
      attachmentMetadata = uploadedFiles.map((f) => ({
        fileName: f.fileName,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        kind: f.kind,
        processingMode: f.kind === "image" ? "image_url" : "staged_markdown",
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      attachmentError.value = msg;
      isPreparingAttachments.value = false;
      return;
    }
    isPreparingAttachments.value = false;
  }

  // Resolve text: if only images with no text, use default prompt
  const displayText = text || defaultPromptForAttachments(files ?? []);
  const streamConversationId = ensureWorkspaceConversationId();
  const isCurrentStreamView = (): boolean =>
    activeConversationId.value === streamConversationId;
  const isCurrentStreamChunk = (chunk: ChatV2StreamChunk): boolean =>
    (!chunk.conversationId || chunk.conversationId === streamConversationId);

  const nowIso = new Date().toISOString();
  const tempUser: ChatV2MessageView = {
    id: `temp-user-${Date.now()}`,
    conversationId: streamConversationId,
    role: "user",
    content: displayText,
    timestamp: nowIso,
    messageType: "message" as MessageType,
    metadata: attachmentMetadata
      ? { source: "chat-v2", attachments: attachmentMetadata }
      : undefined,
  };
  let streamMessages = [...messages.value, tempUser];
  const streamMessageListController: MessageListController = {
    get: (): ChatV2MessageView[] => streamMessages,
    set: (nextMessages: ChatV2MessageView[]): void => {
      streamMessages = nextMessages;
      patchConversationRuntimeState(streamConversationId, {
        messages: nextMessages,
      });
    },
  };
  streamMessageListController.set(streamMessages);

  const assistantId = `temp-assistant-${Date.now()}`;
  const assistant: ChatV2MessageView = {
    id: assistantId,
    conversationId: streamConversationId,
    role: "assistant",
    content: "",
    timestamp: nowIso,
    messageType: "message" as MessageType,
  };
  // Lazily add the assistant placeholder only when real content arrives.
  // This keeps tool_call/tool_result chunks (which typically arrive before
  // the final text tokens) visually above the assistant text message.
  let assistantAdded = false;
  const ensureAssistantAdded = (): void => {
    if (assistantAdded) return;
    // Push a shallow copy so the array element is an independent object,
    // not a reference to the raw closure-captured `assistant`. Vue's
    // reactive proxy fully owns the copy, preventing reactivity gaps
    // where mutations to `assistant.content` (the raw object) fail to
    // trigger DOM updates — especially after many tool-call card pushes.
    streamMessageListController.set([
      ...streamMessageListController.get(),
      { ...assistant },
    ]);
    assistantAdded = true;
  };
  const showAssistantError = (message: string): void => {
    ensureAssistantAdded();
    assistant.content = message;
    assistant.metadata = {
      source: "chat-v2",
      error: message,
    };
    const currentMessages = streamMessageListController.get();
    const idx = currentMessages.findIndex((m) => m.id === assistant.id);
    if (idx !== -1) {
      const nextMessages = [...currentMessages];
      nextMessages[idx] = {
        ...nextMessages[idx],
        content: assistant.content,
        metadata: assistant.metadata,
      };
      streamMessageListController.set(nextMessages);
    }
  };

  patchConversationRuntimeState(streamConversationId, {
    isStreaming: true,
    activeAssistantMessageId: assistantId,
    receivedFirstResponse: false,
    streamError: null,
    retryInfo: null,
    recoveryInfo: null,
  });
  // Seed the live context estimate from the last known server usage. If no
  // usage_update has arrived yet this session, fall back to the existing
  // streaming estimate (e.g. seeded from persisted tokensUsed on history
  // load) so the badge keeps a meaningful baseline instead of resetting
  // to 0 on every turn.
  const usageBaseline = lastUsage.value?.totalTokens;
  streamingEstimatedTokens.value =
    typeof usageBaseline === "number" && usageBaseline > 0
      ? usageBaseline
      : streamingEstimatedTokens.value;

  await nextTick();

  try {
    const streamRequest: ChatV2StreamRequest = {
      conversationId: streamConversationId,
      message: displayText,
      mode: mode.value,
      model: resolveModelForRequest(),
      toolApprovalMode: toolApprovalMode.value,
    };
    if (uploadedFiles && uploadedFiles.length > 0) {
      streamRequest.uploadedFiles = uploadedFiles;
    }
    await streamChatV2Message(
      streamRequest,
      (chunk: ChatV2StreamChunk) => {
        if (!isCurrentStreamChunk(chunk)) return;
        if (chunk.eventType === "start") {
          if (chunk.conversationId) {
            tempUser.conversationId = chunk.conversationId;
            assistant.conversationId = chunk.conversationId;
          }
          if (chunk.messageId) {
            assistant.id = chunk.messageId;
            patchConversationRuntimeState(streamConversationId, {
              activeAssistantMessageId: chunk.messageId,
            });
          }
          // `start` is metadata only; keep showing the typing indicator.
        } else if (chunk.eventType === "usage_update") {
          // Real token counts from the server. Replace the streaming
          // estimate with ground truth and reset the running counter.
          if (
            typeof chunk.totalTokens === "number" &&
            typeof chunk.promptTokens === "number" &&
            typeof chunk.completionTokens === "number"
          ) {
            if (isCurrentStreamView()) {
              lastUsage.value = {
                promptTokens: chunk.promptTokens,
                completionTokens: chunk.completionTokens,
                totalTokens: chunk.totalTokens,
                model: chunk.model,
              };
              if (chunk.model) {
                activeModel.value = chunk.model;
              }
              streamingEstimatedTokens.value = chunk.totalTokens;
            }
          }
        } else if (chunk.eventType === "retry_connect") {
          // Connection to AI server is being retried. Show the reconnect
          // indicator but don't treat it as the first AI response.
          if (
            typeof chunk.retryAttempt === "number" &&
            typeof chunk.retryMaxAttempts === "number"
          ) {
            patchConversationRuntimeState(streamConversationId, {
              retryInfo: {
                attempt: chunk.retryAttempt,
                maxAttempts: chunk.retryMaxAttempts,
                delayMs: chunk.retryDelayMs ?? 0,
              },
            });
          }
        } else if (chunk.eventType === "recovery_status") {
          // Seven-layer recovery status. Show the badge but keep streaming.
          if (chunk.recoveryLayer && chunk.recoveryReason) {
            patchConversationRuntimeState(streamConversationId, {
              recoveryInfo: {
                layer: chunk.recoveryLayer,
                reason: chunk.recoveryReason,
                attempt: chunk.recoveryAttempt,
                maxAttempts: chunk.recoveryMaxAttempts,
                delayMs: chunk.recoveryDelayMs,
                elapsedMs: chunk.recoveryElapsedMs,
                originalModel: chunk.recoveryOriginalModel,
                currentModel: chunk.recoveryCurrentModel,
                fallbackModel: chunk.recoveryFallbackModel,
                message: chunk.recoveryMessage,
              },
            });
          }
        } else {
          // Any non-start/non-retry chunk means the AI has started responding.
          patchConversationRuntimeState(streamConversationId, {
            receivedFirstResponse: true,
            retryInfo: null,
            recoveryInfo: null,
          });
          if (chunk.eventType === "token" && chunk.contentDelta) {
            if (!assistantAdded) {
              console.log(
                `[ai-chat-v2] first token for assistant message ${assistant.id}, adding placeholder`
              );
            }
            ensureAssistantAdded();
            assistant.content += chunk.contentDelta;
            speechController.pushDelta(chunk.contentDelta);
            // Live estimate: each streamed delta adds ~chars/4 tokens to the
            // running context total. The next usage_update event will snap
            // this back to the server's ground-truth count.
            const deltaEstimate = Math.ceil(
              chunk.contentDelta.length / CHARS_PER_TOKEN_ESTIMATE
            );
            if (isCurrentStreamView()) {
              streamingEstimatedTokens.value += deltaEstimate;
            }
            const currentMessages = streamMessageListController.get();
            const idx = currentMessages.findIndex(
              (m) => m.id === assistant.id
            );
            if (idx !== -1) {
              const nextMessages = [...currentMessages];
              nextMessages[idx] = {
                ...nextMessages[idx],
                content: assistant.content,
              };
              streamMessageListController.set(nextMessages);
            }
          } else if (chunk.eventType === ("ask_user_question" as never)) {
            // Plan Mode: show question card, stream may pause
            const planChunk = chunk as ChatV2StreamChunk;
            if (isCurrentStreamView()) {
              if (planChunk.question) {
                pendingQuestion.value = planChunk.question;
              }
              if (planChunk.planState) {
                applyPlanState(planChunk.planState);
              }
            }
          } else if (chunk.eventType === ("plan_submitted" as never)) {
            const planChunk = chunk as ChatV2StreamChunk;
            if (planChunk.planState && isCurrentStreamView()) {
              applyPlanState(planChunk.planState);
              // Pin the card at the bottom while awaiting the user's action.
              // It moves into the message flow only after the user approves,
              // rejects, or requests changes (see the plan handlers below).
              pendingPlanApproval.value = planChunk.planState;
            }
          } else if (chunk.eventType === ("plan_state" as never)) {
            // Model auto-entered Plan Mode via EnterPlanMode. Light up the
            // Plan Mode indicator; do not render a plan message yet (the
            // plan content does not exist until SubmitPlanForApproval).
            const planChunk = chunk as ChatV2StreamChunk;
            if (planChunk.planState) {
              if (isCurrentStreamView()) {
                applyPlanState(planChunk.planState);
              }
              if (planChunk.planState.status !== "awaiting_approval") {
                if (isCurrentStreamView()) {
                  pendingPlanApproval.value = null;
                }
                if (planChunk.planState.latestVersion) {
                  upsertPlanMessage(
                    planChunk.planState,
                    streamMessageListController
                  );
                }
              }
            }
          } else if (chunk.eventType === ("plan_blocked_tool" as never)) {
            // Tool was blocked by plan policy — surface as a tool result message
            const planChunk = chunk as ChatV2StreamChunk;
            upsertToolResultMessage(
              planChunk,
              planChunk.conversationId || streamConversationId,
              assistantAdded ? assistant.id : undefined,
              streamMessageListController
            );
          } else if (chunk.eventType === "tool_progress") {
            upsertToolProgress(
              chunk,
              chunk.conversationId || streamConversationId,
              streamMessageListController
            );
          } else if (chunk.eventType === "tool_call") {
            const toolCallId = chunk.toolCallId;
            const currentMessages = streamMessageListController.get();
            // Defensive dedup: if the same tool_call event is delivered twice
            // (IPC re-delivery, listener cleanup race, or history already
            // loaded), avoid rendering a duplicate card.
            const alreadyRendered = toolCallId
              ? currentMessages.some(
                  (m) =>
                    m.messageType === MessageType.TOOL_CALL &&
                    m.metadata?.toolCallId === toolCallId
                )
              : false;
            if (!alreadyRendered) {
              const toolCallMsg: ChatV2MessageView = {
                id: `tool-call-${toolCallId || Date.now()}`,
                conversationId: chunk.conversationId || streamConversationId,
                role: "assistant",
                content: "",
                timestamp: new Date().toISOString(),
                messageType: MessageType.TOOL_CALL,
                metadata: {
                  source: "chat-v2",
                  toolCallId,
                  toolName: chunk.toolName,
                  toolArguments: chunk.toolArguments,
                },
              };
              // Insert before the assistant placeholder if it was already
              // added (text tokens arrived in an earlier round). This keeps
              // tool calls visually before the assistant's text response.
              if (assistantAdded) {
                const aIdx = currentMessages.findIndex(
                  (m) => m.id === assistant.id
                );
                if (aIdx !== -1) {
                  streamMessageListController.set([
                    ...currentMessages.slice(0, aIdx),
                    toolCallMsg,
                    ...currentMessages.slice(aIdx),
                  ]);
                } else {
                  streamMessageListController.set([
                    ...currentMessages,
                    toolCallMsg,
                  ]);
                }
              } else {
                streamMessageListController.set([
                  ...currentMessages,
                  toolCallMsg,
                ]);
              }
            }
          } else if (chunk.eventType === "tool_result") {
            upsertToolResultMessage(
              chunk,
              chunk.conversationId || streamConversationId,
              assistantAdded ? assistant.id : undefined,
              streamMessageListController
            );
            // Auto-open the artifact preview during a live tool result.
            // (History loads render the card but must NOT auto-open.)
            const liveArtifact = extractArtifactMetadata(chunk.toolResult ?? {});
            if (liveArtifact?.openImmediately && isCurrentStreamView()) {
              emit("open-artifact", liveArtifact.id);
            }
            // AI app navigation: route on open_app_page navigate commands.
            if (isCurrentStreamView()) {
              void handleAiNavigationToolResult(router, chunk.toolResult);
            }
          }
        }
      },
      (complete: ChatV2StreamChunk) => {
        if (!isCurrentStreamChunk(complete)) return;
        patchConversationRuntimeState(streamConversationId, {
          isStreaming: false,
          activeAssistantMessageId: null,
          retryInfo: null,
          recoveryInfo: null,
        });
        // Snap to ground-truth usage carried by the complete event so the
        // badge reflects the real context size even if usage_update chunks
        // didn't fire during the stream (some servers only report usage on
        // the final chunk, which the accumulator captures but emits after
        // the last token round).
        if (
          typeof complete.totalTokens === "number" &&
          typeof complete.promptTokens === "number" &&
          typeof complete.completionTokens === "number"
        ) {
          if (isCurrentStreamView()) {
            lastUsage.value = {
              promptTokens: complete.promptTokens,
              completionTokens: complete.completionTokens,
              totalTokens: complete.totalTokens,
              model: complete.model ?? lastUsage.value?.model,
            };
            streamingEstimatedTokens.value = complete.totalTokens;
            if (complete.model) {
              activeModel.value = complete.model;
            }
          }
        }
        if (
          complete.fullContent !== undefined &&
          complete.fullContent.length > 0
        ) {
          ensureAssistantAdded();
          assistant.content = complete.fullContent;
          speechController.flush();
          const currentMessages = streamMessageListController.get();
          const idx = currentMessages.findIndex((m) => m.id === assistant.id);
          console.log(
            `[ai-chat-v2] stream complete: assistantId=${assistant.id} fullContentLen=${complete.fullContent.length} idxInMessages=${idx} assistantAdded=${assistantAdded} messagesLen=${currentMessages.length}`
          );
          if (idx !== -1) {
            const nextMessages = [...currentMessages];
            nextMessages[idx] = {
              ...nextMessages[idx],
              content: assistant.content,
            };
            streamMessageListController.set(nextMessages);
          }
        } else if (!assistantAdded || assistant.content.length === 0) {
          const emptyMessage =
            t("aiChatV2.empty_response_error") ||
            "The AI returned an empty response. This is typically a transient server issue (rate limit, timeout, or 502). Please try sending your message again.";
          patchConversationRuntimeState(streamConversationId, {
            streamError: emptyMessage,
          });
          showAssistantError(emptyMessage);
        }
        // Safety net: ensure the assistant message appears after all tool
        // calls and tool results from this turn. During multi-round
        // tool-calling, the placeholder may have been inserted before some
        // tool calls if text tokens arrived in an earlier round. Moving it
        // to the end guarantees correct final display order.
        {
          const currentMessages = streamMessageListController.get();
          const aIdx = currentMessages.findIndex(
            (m) => m.id === assistant.id
          );
          if (aIdx !== -1 && aIdx < currentMessages.length - 1) {
            const reordered = [...currentMessages];
            const [assistantMsg] = reordered.splice(aIdx, 1);
            reordered.push(assistantMsg);
            streamMessageListController.set(reordered);
          }
        }
        streamMessageListController.set([...streamMessageListController.get()]);
        // Force a second render pass after Vue's render cycle completes.
        // After many tool-call card pushes followed by the lazy assistant
        // add + token updates, Vue's render scheduler can miss the final
        // state of the newly-added assistant element. This nextTick
        // re-spread guarantees the DOM picks up the final content.
        void nextTick(() => {
          streamMessageListController.set([
            ...streamMessageListController.get(),
          ]);
        });
        void loadConversations();
      },
      (error: Error) => {
        const displayMessage = mapStreamErrorMessage(error.message);
        patchConversationRuntimeState(streamConversationId, {
          isStreaming: false,
          activeAssistantMessageId: null,
          retryInfo: null,
          recoveryInfo: null,
          streamError: displayMessage,
        });
        showAssistantError(displayMessage);
      }
    );
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    const runtimeError = getConversationRuntimeState(streamConversationId)
      .streamError;
    if (!runtimeError) {
      const displayMessage = mapStreamErrorMessage(rawMessage);
      patchConversationRuntimeState(streamConversationId, {
        isStreaming: false,
        activeAssistantMessageId: null,
        retryInfo: null,
        recoveryInfo: null,
        streamError: displayMessage,
      });
      showAssistantError(displayMessage);
    }
  }
};

async function handleSlashCommandSubmission(rawInput: string): Promise<boolean> {
  const conversationId = ensureWorkspaceConversationId();
  let result: Awaited<ReturnType<typeof dispatchSlashCommand>>;
  try {
    result = await dispatchSlashCommand({
      conversationId,
      rawInput,
    });
  } catch (err) {
    appendLocalCommandExchange(
      conversationId,
      rawInput,
      err instanceof Error ? err.message : String(err)
    );
    return true;
  }

  if (!result.status) {
    appendLocalCommandExchange(conversationId, rawInput, result.msg);
    return true;
  }

  if (result.action === "submit_prompt") {
    // Submit the expanded prompt directly to the Chat V2 stream. The
    // isExpandedPrompt flag tells onSend to skip slash-command interception
    // so a prompt body that begins with `/` streams instead of re-dispatching.
    await onSend(result.prompt, [], { isExpandedPrompt: true });
    return true;
  }

  if (result.commandId === "built-in:command:clear") {
    await clearCurrentConversation();
    return true;
  }

  appendLocalCommandExchange(conversationId, rawInput, result.content);
  return true;
}

function appendLocalCommandExchange(
  conversationId: string,
  input: string,
  content: string
): void {
  const nowIso = new Date().toISOString();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  messages.value = [
    ...messages.value,
    {
      id: `local-command-user-${suffix}`,
      conversationId,
      role: "user",
      content: input,
      timestamp: nowIso,
      messageType: "message" as MessageType,
    },
    {
      id: `local-command-assistant-${suffix}`,
      conversationId,
      role: "assistant",
      content,
      timestamp: nowIso,
      messageType: "message" as MessageType,
      metadata: { source: "slash-command" },
    },
  ];
}

function sendPromptRequest(request: AiPromptRequest | null | undefined): void {
  if (!request || request.id === lastHandledPromptRequestId.value) return;
  const text = request.text.trim();
  if (!text || chatIsRunning.value) return;

  lastHandledPromptRequestId.value = request.id;
  void nextTick(() => {
    void onSend(text, []);
  });
}

watch(
  [() => props.promptRequest, chatIsRunning],
  ([request]) => {
    sendPromptRequest(request);
  }
);

const voiceInputEnabled = ref(false);
const speechController = new SpeechResponseController({
  ttsMode: "disabled",
  latestInputWasVoice: false,
});
speechController.start();
const voiceAutoSend = ref(false);
const voiceStatus = ref<AiChatVoiceRuntimeStatus | null>(null);
const voiceMissingModel = computed(
  () =>
    voiceInputEnabled.value &&
    (voiceStatus.value?.sttState === "missing_model" ||
      voiceStatus.value?.sttState === "unavailable"),
);
async function loadVoiceSettings(): Promise<void> {
  try {
    const [settings, status] = await Promise.all([
      getVoiceSettings(),
      getVoiceStatus(),
    ]);
    voiceInputEnabled.value = settings.inputMode === "push_to_talk";
    voiceAutoSend.value = settings.autoSendTranscript;
    speechController.updateOptions({ ttsMode: settings.ttsMode });
    voiceStatus.value = status;
  } catch {
    voiceInputEnabled.value = false;
    voiceAutoSend.value = false;
    voiceStatus.value = null;
  }
}

function handleVoiceSettingsChanged(): void {
  void loadVoiceSettings();
}

onMounted(() => {
  void loadConversations();
  void loadVoiceSettings();
  void loadModelContextWindows();
  void loadProviderSettings();
  window.addEventListener(
    AI_PROVIDER_SETTINGS_CHANGED_EVENT,
    handleProviderSettingsChanged
  );
  window.addEventListener(
    AI_CHAT_V2_VOICE_SETTINGS_CHANGED_EVENT,
    handleVoiceSettingsChanged
  );
  // Subscribe to file operation events emitted during tool execution.
  // Records are appended per-conversation so the summary panel reflects
  // all changes made within the active conversation.
  subscribeToFileOperations((record: FileOperationRecord) => {
    const convId = record.conversationId;
    const current = fileOps.value.get(convId) ?? [];
    const next = new Map(fileOps.value);
    next.set(convId, [...current, record]);
    fileOps.value = next;
  });
});

onBeforeUnmount(() => {
  speechController.stop();
  detachActiveStreamView();
  window.removeEventListener(
    AI_PROVIDER_SETTINGS_CHANGED_EVENT,
    handleProviderSettingsChanged
  );
  window.removeEventListener(
    AI_CHAT_V2_VOICE_SETTINGS_CHANGED_EVENT,
    handleVoiceSettingsChanged
  );
  unsubscribeFromFileOperations();
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
});
</script>

<style scoped>
.v2-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: #fff;
}
.v2-shell__header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}
.v2-shell__header-left {
  display: flex;
  align-items: center;
}
.v2-shell__header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.v2-shell__title {
  font-weight: 600;
}
.v2-shell__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.v2-shell__plan-panel {
  flex: 0 0 auto;
  padding: 0 12px;
  max-height: 300px;
  overflow-y: auto;
}
.v2-shell__workspace-panel {
  flex: 0 0 auto;
  padding: 4px 12px;
}
.v2-shell__file-ops-panel {
  flex: 0 0 auto;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  background: #fafafa;
}
.v2-shell__file-ops-header {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s ease;
}
.v2-shell__file-ops-header:hover {
  background-color: rgba(0, 0, 0, 0.04);
}
.v2-shell__file-ops-summary {
  font-size: 13px;
  font-weight: 500;
}
.v2-shell__file-ops-counts {
  display: flex;
  align-items: center;
}
.v2-shell__file-ops-body {
  padding: 4px 12px 10px;
  border-top: 1px solid rgba(0, 0, 0, 0.05);
}
</style>

<style>
:root[theme="dark"] .v2-shell {
  background: #1e1e1e;
}
:root[theme="dark"] .v2-shell__header {
  border-bottom-color: rgba(255, 255, 255, 0.12);
}
:root[theme="dark"] .v2-shell__file-ops-panel {
  background: #2d2d2d;
  border-top-color: rgba(255, 255, 255, 0.12);
}
:root[theme="dark"] .v2-shell__file-ops-header:hover {
  background-color: rgba(255, 255, 255, 0.06);
}
:root[theme="dark"] .v2-shell__file-ops-body {
  border-top-color: rgba(255, 255, 255, 0.08);
}
</style>
