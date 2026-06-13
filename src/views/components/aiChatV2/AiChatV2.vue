<template>
  <div class="v2-shell">
    <!-- Header with icon actions like old AiChatBox -->
    <div class="v2-shell__header">
      <div class="v2-shell__header-left">
        <v-icon class="mr-2">mdi-robot</v-icon>
        <span class="v2-shell__title">{{ t("aiChatV2.title") || "AI Assistant" }}</span>
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
      />
      <AiChatV2Composer
        :is-streaming="isStreaming"
        @send="onSend"
        @stop="onStop"
      />
    </div>

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
import type { MessageType } from "@/entityTypes/commonType";
import type {
  ChatV2MessageView,
  ChatV2ConversationSummary,
  ChatV2StreamChunk,
} from "@/entityTypes/aiChatV2Types";
import { windowRemoveAllListeners } from "@/views/utils/apirequest";
import {
  AI_CHAT_V2_STREAM_CHUNK,
  AI_CHAT_V2_STREAM_COMPLETE,
} from "@/config/channellist";
import {
  getChatV2Conversations,
  getChatV2History,
  streamChatV2Message,
  stopChatV2Stream,
} from "@/views/api/aiChatV2";
import AiChatV2Messages from "./AiChatV2Messages.vue";
import AiChatV2Composer from "./AiChatV2Composer.vue";

type Status = "idle" | "streaming" | "cancelled" | "error";

const { t } = useI18n();

const conversations = ref<ChatV2ConversationSummary[]>([]);
const activeConversationId = ref<string | null>(null);
const messages = ref<ChatV2MessageView[]>([]);
const isStreaming = ref(false);
const streamError = ref<string | null>(null);
const activeAssistantMessageId = ref<string | null>(null);
const showConversationsDialog = ref(false);

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
  } catch (err) {
    streamError.value = err instanceof Error ? err.message : String(err);
  }
};

const onNewConversation = (): void => {
  stopIfStreaming();
  activeConversationId.value = null;
  messages.value = [];
  streamError.value = null;
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
  isStreaming.value = false;
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
  messages.value = [...messages.value, assistant];

  isStreaming.value = true;

  await streamChatV2Message(
    {
      conversationId: activeConversationId.value ?? undefined,
      message: text,
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
        assistant.content += chunk.contentDelta;
        const idx = messages.value.findIndex((m) => m.id === assistant.id);
        if (idx !== -1) {
          messages.value[idx] = { ...messages.value[idx], content: assistant.content };
        }
      }
    },
    (complete: ChatV2StreamChunk) => {
      isStreaming.value = false;
      activeAssistantMessageId.value = null;
      if (complete.fullContent !== undefined) {
        assistant.content = complete.fullContent;
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
      if (assistant.content.length === 0) {
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
</style>
