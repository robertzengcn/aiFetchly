<template>
  <div class="v2-shell">
    <!-- Header with icon actions like old AiChatBox -->
    <div class="v2-shell__header">
      <div class="v2-shell__header-left">
        <v-icon class="mr-2">mdi-robot</v-icon>
        <span class="v2-shell__title">{{ t("aiChatV2.title") || "AI Assistant" }}</span>
        <AiChatV2PlanStatusBadge
          v-if="planState"
          :status="planState.status"
          class="ml-2"
        />
      </div>
      <div class="v2-shell__header-actions">
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
        @grant-permission="handleSkillPermissionGrant"
        @deny-permission="handleSkillPermissionDeny"
      />

      <!-- Plan Mode active cards -->
      <div v-if="mode === 'plan'" class="v2-shell__plan-panel">
        <AiChatV2QuestionCard
          v-if="pendingQuestion"
          :question="pendingQuestion"
          @answered="handleQuestionAnswered"
        />
        <AiChatV2PlanApprovalCard
          v-if="planState"
          :plan-state="planState"
          :disabled="isStreaming"
          @approve="handleApprovePlan"
          @reject="handleRejectPlan"
          @request-changes="handleRequestPlanChanges"
        />
      </div>

      <AiChatV2Composer
        :is-streaming="isStreaming"
        @send="onSend"
        @stop="onStop"
      >
        <template #prepend>
          <AiChatV2ModeSelector v-model="mode" :disabled="isStreaming" />
        </template>
      </AiChatV2Composer>
    </div>

    <!-- MCP Tool Manager Dialog -->
    <MCPToolManager v-model="showMCPToolManager" />

    <!-- Conversation history dialog -->
    <v-dialog v-model="showConversationsDialog" max-width="500" scrollable>
      <v-card>
        <v-card-title class="d-flex align-center justify-space-between">
          <span>{{ t("aiChatV2.conversation_history") || "Conversation History" }}</span>
          <v-btn icon size="small" variant="text" @click="showConversationsDialog = false">
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-card-title>
        <v-divider></v-divider>
        <v-card-text style="padding: 0;">
          <div v-if="conversations.length === 0" class="pa-4 text-center">
            <v-icon size="48" color="grey-lighten-2">mdi-chat-outline</v-icon>
            <p class="mt-4 text-grey">{{ t("aiChatV2.no_conversations") || "No conversations yet" }}</p>
          </div>
          <v-list v-else density="comfortable">
            <v-list-item
              v-for="conv in conversations"
              :key="conv.conversationId"
              :class="{ 'bg-primary-lighten-5': conv.conversationId === activeConversationId }"
              @click="onSelectConversation(conv.conversationId)"
            >
              <template v-slot:prepend>
                <v-icon color="primary">mdi-chat</v-icon>
              </template>
              <v-list-item-title>{{ truncateText(conv.title, 60) }}</v-list-item-title>
              <v-list-item-subtitle>
                <div class="d-flex align-center mt-1">
                  <v-icon size="x-small" class="mr-1">mdi-clock-outline</v-icon>
                  <span>{{ formatTimestamp(conv.lastMessageTimestamp) }}</span>
                </div>
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
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
import { windowInvoke, windowRemoveAllListeners } from "@/views/utils/apirequest";
import {
  AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION,
  AI_CHAT_V2_STREAM_CHUNK,
  AI_CHAT_V2_STREAM_COMPLETE,
} from "@/config/channellist";
import {
  clearChatV2StreamListeners,
  getChatV2Conversations,
  getChatV2History,
  streamChatV2Message,
  stopChatV2Stream,
  getChatV2PlanState,
  answerChatV2Question,
  approveChatV2Plan,
  rejectChatV2Plan,
  requestChatV2PlanChanges,
} from "@/views/api/aiChatV2";
import AiChatV2Messages from "./AiChatV2Messages.vue";
import AiChatV2Composer from "./AiChatV2Composer.vue";
import AiChatV2ModeSelector from "./AiChatV2ModeSelector.vue";
import AiChatV2QuestionCard from "./AiChatV2QuestionCard.vue";
import AiChatV2PlanApprovalCard from "./AiChatV2PlanApprovalCard.vue";
import AiChatV2PlanStatusBadge from "./AiChatV2PlanStatusBadge.vue";
import MCPToolManager from "../aiChat/MCPToolManager.vue";

type Status = "idle" | "streaming" | "cancelled" | "error";

const { t } = useI18n();

const conversations = ref<ChatV2ConversationSummary[]>([]);
const activeConversationId = ref<string | null>(null);
const messages = ref<ChatV2MessageView[]>([]);
const isStreaming = ref(false);
const streamError = ref<string | null>(null);
const activeAssistantMessageId = ref<string | null>(null);
const showConversationsDialog = ref(false);
const showMCPToolManager = ref(false);

// Plan Mode state
const mode = ref<ChatV2Mode>("chat");
const planState = ref<AIChatPlanStateView | null>(null);
const pendingQuestion = ref<AIChatPlanQuestionView | null>(null);

const streamStatus = computed<Status>(() => {
  if (isStreaming.value) return "streaming";
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

const loadConversations = async (): Promise<void> => {
  try {
    conversations.value = await getChatV2Conversations();
  } catch {
    // non-fatal; leave list empty
  }
};

const loadHistory = async (conversationId: string): Promise<void> => {
  try {
    const resp = await getChatV2History(conversationId);
    messages.value = resp?.messages ?? [];
    // Load plan state for this conversation.
    try {
      planState.value = await getChatV2PlanState(conversationId);
      if (planState.value?.pendingQuestion) {
        pendingQuestion.value = planState.value.pendingQuestion;
      } else {
        pendingQuestion.value = null;
      }
    } catch {
      planState.value = null;
      pendingQuestion.value = null;
    }
  } catch (err) {
    streamError.value = err instanceof Error ? err.message : String(err);
  }
};

const onNewConversation = (): void => {
  stopIfStreaming();
  activeConversationId.value = null;
  messages.value = [];
  streamError.value = null;
  planState.value = null;
  pendingQuestion.value = null;
};

const onClearMessages = (): void => {
  onNewConversation();
};

const onSelectConversation = (conversationId: string): void => {
  stopIfStreaming();
  activeConversationId.value = conversationId;
  streamError.value = null;
  showConversationsDialog.value = false;
  void loadHistory(conversationId);
};

const stopIfStreaming = (): void => {
  if (isStreaming.value) {
    stopChatV2Stream();
    isStreaming.value = false;
  }
};

const onStop = (): void => {
  stopChatV2Stream();
  clearChatV2StreamListeners();
  isStreaming.value = false;
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
  conversationId: string
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
          message.metadata?.toolCallId === chunk.replacesPermissionPromptForToolId
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
    summary: typeof toolResult.summary === "string" ? toolResult.summary : undefined,
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

  messages.value.push({
    id: `tool-result-${chunk.toolCallId || Date.now()}`,
    conversationId,
    role: "assistant",
    content,
    timestamp: new Date().toISOString(),
    messageType: MessageType.TOOL_RESULT,
    metadata,
  });
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

const handleQuestionAnswered = async (
  questionId: string,
  answers: AskUserQuestionAnswer[]
): Promise<void> => {
  if (!activeConversationId.value) return;
  try {
    await answerChatV2Question(
      activeConversationId.value,
      questionId,
      answers
    );
    pendingQuestion.value = null;
    // Refresh plan state to reflect the updated status.
    planState.value = await getChatV2PlanState(activeConversationId.value);
  } catch (err) {
    streamError.value = err instanceof Error ? err.message : String(err);
  }
};

const handleApprovePlan = async (): Promise<void> => {
  if (!planState.value || !activeConversationId.value) return;
  try {
    const updated = await approveChatV2Plan(
      activeConversationId.value,
      planState.value.planId,
      planState.value.currentVersion
    );
    if (updated) planState.value = updated;
  } catch (err) {
    streamError.value = err instanceof Error ? err.message : String(err);
  }
};

const handleRejectPlan = async (feedback: string): Promise<void> => {
  if (!planState.value || !activeConversationId.value) return;
  try {
    const updated = await rejectChatV2Plan(
      activeConversationId.value,
      planState.value.planId,
      planState.value.currentVersion,
      feedback
    );
    if (updated) planState.value = updated;
  } catch (err) {
    streamError.value = err instanceof Error ? err.message : String(err);
  }
};

const handleRequestPlanChanges = async (feedback: string): Promise<void> => {
  if (!planState.value || !activeConversationId.value) return;
  try {
    const updated = await requestChatV2PlanChanges(
      activeConversationId.value,
      planState.value.planId,
      planState.value.currentVersion,
      feedback
    );
    if (updated) planState.value = updated;
  } catch (err) {
    streamError.value = err instanceof Error ? err.message : String(err);
  }
};

const onSend = async (text: string): Promise<void> => {
  if (isStreaming.value) return;
  streamError.value = null;

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
    messages.value = [...messages.value, assistant];
    assistantAdded = true;
  };

  isStreaming.value = true;

  await streamChatV2Message(
    {
      conversationId: activeConversationId.value ?? undefined,
      message: text,
      mode: mode.value,
      // model omitted → backend picks default
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
      } else if (chunk.eventType === "token" && chunk.contentDelta) {
        ensureAssistantAdded();
        assistant.content += chunk.contentDelta;
        const idx = messages.value.findIndex((m) => m.id === assistant.id);
        if (idx !== -1) {
          messages.value[idx] = { ...messages.value[idx], content: assistant.content };
        }
      } else if (chunk.eventType === "ask_user_question" as never) {
        // Plan Mode: show question card, stream may pause
        const planChunk = chunk as ChatV2StreamChunk;
        if (planChunk.question) {
          pendingQuestion.value = planChunk.question;
        }
        if (planChunk.planState) {
          planState.value = planChunk.planState;
        }
      } else if (chunk.eventType === "plan_submitted" as never) {
        const planChunk = chunk as ChatV2StreamChunk;
        if (planChunk.planState) {
          planState.value = planChunk.planState;
        }
      } else if (chunk.eventType === "plan_blocked_tool" as never) {
        // Tool was blocked by plan policy — surface as a tool result message
        const planChunk = chunk as ChatV2StreamChunk;
        upsertToolResultMessage(
          planChunk,
          planChunk.conversationId || activeConversationId.value || ""
        );
      } else if (chunk.eventType === "tool_call") {
        messages.value.push({
          id: `tool-call-${chunk.toolCallId || Date.now()}`,
          conversationId: chunk.conversationId || activeConversationId.value || "",
          role: "assistant",
          content: "",
          timestamp: new Date().toISOString(),
          messageType: MessageType.TOOL_CALL,
          metadata: {
            source: "chat-v2",
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            toolArguments: chunk.toolArguments,
          },
        });
      } else if (chunk.eventType === "tool_result") {
        upsertToolResultMessage(
          chunk,
          chunk.conversationId || activeConversationId.value || ""
        );
      }
    },
    (complete: ChatV2StreamChunk) => {
      isStreaming.value = false;
      activeAssistantMessageId.value = null;
      if (complete.fullContent !== undefined) {
        ensureAssistantAdded();
        assistant.content = complete.fullContent;
        const idx = messages.value.findIndex((m) => m.id === assistant.id);
        if (idx !== -1) {
          messages.value[idx] = { ...messages.value[idx], content: assistant.content };
        }
      }
      if (complete.conversationId) {
        activeConversationId.value = complete.conversationId;
      }
      messages.value = [...messages.value];
      void loadConversations();
    },
    (error: Error) => {
      isStreaming.value = false;
      activeAssistantMessageId.value = null;
      streamError.value = error.message;
      // Only remove if the placeholder was actually added and is still empty.
      if (assistantAdded && assistant.content.length === 0) {
        messages.value = messages.value.filter((m) => m.id !== assistant.id);
      }
    }
  );
};

onMounted(() => {
  void loadConversations();
});

onBeforeUnmount(() => {
  stopIfStreaming();
  clearChatV2StreamListeners();
  windowRemoveAllListeners(AI_CHAT_V2_STREAM_CHUNK);
  windowRemoveAllListeners(AI_CHAT_V2_STREAM_COMPLETE);
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
