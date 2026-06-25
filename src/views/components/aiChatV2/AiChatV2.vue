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
          class="mr-1"
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
      </div>
    </div>

    <!-- Main content (no sidebar) -->
    <div class="v2-shell__body">
      <AiChatV2Messages
        :messages="messages"
        :active-assistant-message-id="activeAssistantMessageId"
        :stream-status="streamStatus"
        :error-message="streamError ?? undefined"
        :show-typing-indicator="showTypingIndicator"
        :is-streaming="chatIsRunning"
        :retry-info="retryInfo"
        @grant-permission="handleSkillPermissionGrant"
        @deny-permission="handleSkillPermissionDeny"
        @approve-plan="handleApprovePlan"
        @reject-plan="handleRejectPlan"
        @request-plan-changes="handleRequestPlanChanges"
      />

      <!-- Pinned action cards: question + plan approval while awaiting user input.
           After the user approves/rejects/requests changes, the plan card moves
           into the message flow (see handleApprovePlan et al.). -->
      <div
        v-if="mode === 'plan' && (pendingQuestion || pendingPlanApproval)"
        class="v2-shell__plan-panel"
      >
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

      <AiChatV2Composer
        :is-streaming="chatIsRunning"
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
import { MessageType } from "@/entityTypes/commonType";
import type {
  ChatV2MessageView,
  ChatV2ConversationSummary,
  ChatV2StreamChunk,
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
} from "@/views/api/aiChatV2";
import AiChatV2Messages from "./AiChatV2Messages.vue";
import AiChatV2Composer from "./AiChatV2Composer.vue";
import AiChatV2ModeSelector from "./AiChatV2ModeSelector.vue";
import AiChatV2ModelSelector from "./AiChatV2ModelSelector.vue";
import AiChatV2QuestionCard from "./AiChatV2QuestionCard.vue";
import AiChatV2PlanApprovalCard from "./AiChatV2PlanApprovalCard.vue";
import AiChatV2PlanStatusBadge from "./AiChatV2PlanStatusBadge.vue";
import AiChatV2ContextBadge from "./AiChatV2ContextBadge.vue";
import MCPToolManager from "../aiChat/MCPToolManager.vue";
import type { OpenAIModel } from "@/api/aiChatApi";
import {
  computeContextPercent,
  resolveContextWindow,
  DEFAULT_CONTEXT_WINDOW,
} from "./contextUsageUtil";
import { hasPendingToolExecution } from "./toolExecutionStateUtil";
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

const { t } = useI18n();

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
const retryInfo = ref<{
  attempt: number;
  maxAttempts: number;
  delayMs: number;
} | null>(null);
const showConversationsDialog = ref(false);
const showMCPToolManager = ref(false);
const isCompacting = ref(false);
const compactNotice = ref(false);
const stoppedPendingToolConversationIds = ref<Set<string>>(new Set());

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

const loadModelContextWindows = async (): Promise<void> => {
  try {
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
    if (selectedModel.value === undefined) {
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

/**
 * A conversation shows a "running" indicator when it is the active conversation
 * and the chat is currently streaming or waiting on a pending tool execution.
 * Other conversations in the list are idle (no background work happens on them).
 */
const isConversationRunning = (conversationId: string): boolean =>
  chatIsRunning.value && conversationId === activeConversationId.value;

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
    messages.value = resp?.messages ?? [];
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
      applyPlanState(await getChatV2PlanState(conversationId));
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
  } catch (err) {
    streamError.value = err instanceof Error ? err.message : String(err);
  }
};

const onNewConversation = (): void => {
  detachActiveStreamView();
  activeConversationId.value = null;
  messages.value = [];
  streamError.value = null;
  applyPlanState(null);
  pendingQuestion.value = null;
  pendingPlanApproval.value = null;
  // Reset context-usage tracking for the new conversation.
  lastUsage.value = null;
  streamingEstimatedTokens.value = 0;
  activeModel.value = undefined;
};

const onClearMessages = (): void => {
  onNewConversation();
};

const onSelectConversation = (conversationId: string): void => {
  detachActiveStreamView();
  activeConversationId.value = conversationId;
  streamError.value = null;
  showConversationsDialog.value = false;
  void loadHistory(conversationId);
};

const detachActiveStreamView = (): void => {
  if (isStreaming.value) {
    clearChatV2StreamListeners();
    isStreaming.value = false;
    activeAssistantMessageId.value = null;
    retryInfo.value = null;
  }
};

const onStop = (): void => {
  stopChatV2Stream();
  clearChatV2StreamListeners();
  isStreaming.value = false;
  const conversationId = activeConversationId.value;
  if (conversationId) {
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

const upsertToolResultMessage = (
  chunk: ChatV2StreamChunk,
  conversationId: string,
  insertBeforeAssistantId?: string
): void => {
  const toolResult = chunk.toolResult ?? {};
  const content =
    typeof chunk.fullContent === "string" && chunk.fullContent.trim().length > 0
      ? chunk.fullContent
      : JSON.stringify(toolResult, null, 2);
  const existingIdx = chunk.replacesPermissionPromptForToolId
    ? messages.value.findIndex(
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
  };

  if (existingIdx !== -1) {
    messages.value[existingIdx] = {
      ...messages.value[existingIdx],
      content,
      metadata: {
        ...messages.value[existingIdx].metadata,
        ...metadata,
      },
    };
    return;
  }

  if (
    chunk.toolCallId &&
    messages.value.some(
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
    const aIdx = messages.value.findIndex(
      (m) => m.id === insertBeforeAssistantId
    );
    if (aIdx !== -1) {
      messages.value = [
        ...messages.value.slice(0, aIdx),
        toolResultMsg,
        ...messages.value.slice(aIdx),
      ];
      return;
    }
  }
  messages.value = [...messages.value, toolResultMsg];
};

const handleSkillPermissionGrant = async (
  message: ChatV2MessageView
): Promise<void> => {
  const toolId = resolveToolIdForPermissionMessage(message);
  if (!toolId) {
    streamError.value =
      t("aiChatV2.permission_resume_no_tool_id") ||
      "Missing tool call information; cannot continue execution.";
    isStreaming.value = false;
    activeAssistantMessageId.value = null;
    return;
  }

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
      isStreaming.value = false;
      activeAssistantMessageId.value = null;
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    streamError.value = errMsg;
    isStreaming.value = false;
    activeAssistantMessageId.value = null;
  }
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
  isStreaming.value = false;
  activeAssistantMessageId.value = null;
};

// ---------------------------------------------------------------------------
// Plan Mode handlers
// ---------------------------------------------------------------------------

/**
 * Insert or update the inline plan-approval message row so the card appears
 * in the conversation flow (not pinned at the bottom). After approval/reject
 * the row stays in place; later messages render below it.
 */
const upsertPlanMessage = (state: AIChatPlanStateView): void => {
  const planMsgId = `plan-${state.planId}`;
  const existingIdx = messages.value.findIndex((m) => m.id === planMsgId);
  const metadata = {
    source: "chat-v2" as const,
    planEventType: "plan_submitted" as const,
    planId: state.planId,
    planStateView: state,
  };
  if (existingIdx !== -1) {
    messages.value[existingIdx] = {
      ...messages.value[existingIdx],
      metadata: {
        ...messages.value[existingIdx].metadata,
        ...metadata,
      },
    };
    return;
  }
  messages.value.push({
    id: planMsgId,
    conversationId: state.conversationId,
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    messageType: "message" as MessageType,
    metadata,
  });
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

const onSend = async (text: string): Promise<void> => {
  if (chatIsRunning.value) return;
  streamError.value = null;
  if (activeConversationId.value) {
    const nextStopped = new Set(stoppedPendingToolConversationIds.value);
    nextStopped.delete(activeConversationId.value);
    stoppedPendingToolConversationIds.value = nextStopped;
  }

  const nowIso = new Date().toISOString();
  const tempUser: ChatV2MessageView = {
    id: `temp-user-${Date.now()}`,
    conversationId: activeConversationId.value ?? "",
    role: "user",
    content: text,
    timestamp: nowIso,
    messageType: "message" as MessageType,
  };
  messages.value = [...messages.value, tempUser];

  const assistantId = `temp-assistant-${Date.now()}`;
  activeAssistantMessageId.value = assistantId;
  const assistant: ChatV2MessageView = {
    id: assistantId,
    conversationId: activeConversationId.value ?? "",
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
    messages.value = [...messages.value, { ...assistant }];
    assistantAdded = true;
  };
  const showAssistantError = (message: string): void => {
    ensureAssistantAdded();
    assistant.content = message;
    assistant.metadata = {
      source: "chat-v2",
      error: message,
    };
    const idx = messages.value.findIndex((m) => m.id === assistant.id);
    if (idx !== -1) {
      messages.value[idx] = {
        ...messages.value[idx],
        content: assistant.content,
        metadata: assistant.metadata,
      };
    }
  };

  isStreaming.value = true;
  receivedFirstResponse.value = false;
  retryInfo.value = null;
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
    await streamChatV2Message(
      {
        conversationId: activeConversationId.value ?? undefined,
        message: text,
        mode: mode.value,
        model: resolveModelForRequest(),
      },
      (chunk: ChatV2StreamChunk) => {
        if (chunk.eventType === "start") {
          if (chunk.conversationId) {
            activeConversationId.value = chunk.conversationId;
            tempUser.conversationId = chunk.conversationId;
            assistant.conversationId = chunk.conversationId;
          }
          if (chunk.messageId) {
            assistant.id = chunk.messageId;
            activeAssistantMessageId.value = chunk.messageId;
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
        } else if (chunk.eventType === "retry_connect") {
          // Connection to AI server is being retried. Show the reconnect
          // indicator but don't treat it as the first AI response.
          if (
            typeof chunk.retryAttempt === "number" &&
            typeof chunk.retryMaxAttempts === "number"
          ) {
            retryInfo.value = {
              attempt: chunk.retryAttempt,
              maxAttempts: chunk.retryMaxAttempts,
              delayMs: chunk.retryDelayMs ?? 0,
            };
          }
        } else {
          // Any non-start/non-retry chunk means the AI has started responding.
          receivedFirstResponse.value = true;
          retryInfo.value = null;
          if (chunk.eventType === "token" && chunk.contentDelta) {
            if (!assistantAdded) {
              console.log(
                `[ai-chat-v2] first token for assistant message ${assistant.id}, adding placeholder`
              );
            }
            ensureAssistantAdded();
            assistant.content += chunk.contentDelta;
            // Live estimate: each streamed delta adds ~chars/4 tokens to the
            // running context total. The next usage_update event will snap
            // this back to the server's ground-truth count.
            const deltaEstimate = Math.ceil(
              chunk.contentDelta.length / CHARS_PER_TOKEN_ESTIMATE
            );
            streamingEstimatedTokens.value += deltaEstimate;
            const idx = messages.value.findIndex((m) => m.id === assistant.id);
            if (idx !== -1) {
              messages.value[idx] = {
                ...messages.value[idx],
                content: assistant.content,
              };
            }
          } else if (chunk.eventType === ("ask_user_question" as never)) {
            // Plan Mode: show question card, stream may pause
            const planChunk = chunk as ChatV2StreamChunk;
            if (planChunk.question) {
              pendingQuestion.value = planChunk.question;
            }
            if (planChunk.planState) {
              applyPlanState(planChunk.planState);
            }
          } else if (chunk.eventType === ("plan_submitted" as never)) {
            const planChunk = chunk as ChatV2StreamChunk;
            if (planChunk.planState) {
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
              applyPlanState(planChunk.planState);
            }
          } else if (chunk.eventType === ("plan_blocked_tool" as never)) {
            // Tool was blocked by plan policy — surface as a tool result message
            const planChunk = chunk as ChatV2StreamChunk;
            upsertToolResultMessage(
              planChunk,
              planChunk.conversationId || activeConversationId.value || "",
              assistantAdded ? assistant.id : undefined
            );
          } else if (chunk.eventType === "tool_call") {
            const toolCallId = chunk.toolCallId;
            // Defensive dedup: if the same tool_call event is delivered twice
            // (IPC re-delivery, listener cleanup race, or history already
            // loaded), avoid rendering a duplicate card.
            const alreadyRendered = toolCallId
              ? messages.value.some(
                  (m) =>
                    m.messageType === MessageType.TOOL_CALL &&
                    m.metadata?.toolCallId === toolCallId
                )
              : false;
            if (!alreadyRendered) {
              const toolCallMsg: ChatV2MessageView = {
                id: `tool-call-${toolCallId || Date.now()}`,
                conversationId:
                  chunk.conversationId || activeConversationId.value || "",
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
                const aIdx = messages.value.findIndex(
                  (m) => m.id === assistant.id
                );
                if (aIdx !== -1) {
                  messages.value = [
                    ...messages.value.slice(0, aIdx),
                    toolCallMsg,
                    ...messages.value.slice(aIdx),
                  ];
                } else {
                  messages.value = [...messages.value, toolCallMsg];
                }
              } else {
                messages.value = [...messages.value, toolCallMsg];
              }
            }
          } else if (chunk.eventType === "tool_result") {
            upsertToolResultMessage(
              chunk,
              chunk.conversationId || activeConversationId.value || "",
              assistantAdded ? assistant.id : undefined
            );
          }
        }
      },
      (complete: ChatV2StreamChunk) => {
        isStreaming.value = false;
        activeAssistantMessageId.value = null;
        retryInfo.value = null;
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
        if (
          complete.fullContent !== undefined &&
          complete.fullContent.length > 0
        ) {
          ensureAssistantAdded();
          assistant.content = complete.fullContent;
          const idx = messages.value.findIndex((m) => m.id === assistant.id);
          console.log(
            `[ai-chat-v2] stream complete: assistantId=${assistant.id} fullContentLen=${complete.fullContent.length} idxInMessages=${idx} assistantAdded=${assistantAdded} messagesLen=${messages.value.length}`
          );
          if (idx !== -1) {
            messages.value[idx] = {
              ...messages.value[idx],
              content: assistant.content,
            };
          }
        } else if (!assistantAdded || assistant.content.length === 0) {
          const emptyMessage =
            t("aiChatV2.empty_response_error") ||
            "The AI returned an empty response. This is typically a transient server issue (rate limit, timeout, or 502). Please try sending your message again.";
          streamError.value = emptyMessage;
          showAssistantError(emptyMessage);
        }
        // Safety net: ensure the assistant message appears after all tool
        // calls and tool results from this turn. During multi-round
        // tool-calling, the placeholder may have been inserted before some
        // tool calls if text tokens arrived in an earlier round. Moving it
        // to the end guarantees correct final display order.
        {
          const aIdx = messages.value.findIndex(
            (m) => m.id === assistant.id
          );
          if (aIdx !== -1 && aIdx < messages.value.length - 1) {
            const reordered = [...messages.value];
            const [assistantMsg] = reordered.splice(aIdx, 1);
            reordered.push(assistantMsg);
            messages.value = reordered;
          }
        }
        if (complete.conversationId) {
          activeConversationId.value = complete.conversationId;
        }
        messages.value = [...messages.value];
        // Force a second render pass after Vue's render cycle completes.
        // After many tool-call card pushes followed by the lazy assistant
        // add + token updates, Vue's render scheduler can miss the final
        // state of the newly-added assistant element. This nextTick
        // re-spread guarantees the DOM picks up the final content.
        void nextTick(() => {
          messages.value = [...messages.value];
        });
        void loadConversations();
      },
      (error: Error) => {
        isStreaming.value = false;
        activeAssistantMessageId.value = null;
        retryInfo.value = null;
        const displayMessage = mapStreamErrorMessage(error.message);
        streamError.value = displayMessage;
        showAssistantError(displayMessage);
      }
    );
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    if (!streamError.value) {
      const displayMessage = mapStreamErrorMessage(rawMessage);
      isStreaming.value = false;
      activeAssistantMessageId.value = null;
      retryInfo.value = null;
      streamError.value = displayMessage;
      showAssistantError(displayMessage);
    }
  }
};

onMounted(() => {
  void loadConversations();
  void loadModelContextWindows();
});

onBeforeUnmount(() => {
  detachActiveStreamView();
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
  background: #fff;
}
.v2-shell__header {
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
}
.v2-shell__plan-panel {
  padding: 0 12px;
  max-height: 300px;
  overflow-y: auto;
}
</style>
