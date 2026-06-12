<template>
  <div class="v2-shell">
    <div class="v2-shell__header">
      <v-select
        v-model="selectedModel"
        :items="modelItems"
        item-title="id"
        item-value="id"
        :label="t('aiChatV2.loading_models') || 'Model'"
        density="compact"
        hide-details
        class="v2-shell__model"
        variant="outlined"
      />
      <span class="v2-shell__title">{{ t("aiChatV2.title") || "AI Assistant (V2)" }}</span>
    </div>

    <div class="v2-shell__body">
      <div class="v2-shell__sidebar">
        <AiChatV2ConversationList
          :conversations="conversations"
          :active-conversation-id="activeConversationId"
          @new-conversation="onNewConversation"
          @select="onSelectConversation"
        />
      </div>
      <div class="v2-shell__main">
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import type { MessageType } from "@/entityTypes/commonType";
import type {
  ChatV2MessageView,
  ChatV2ConversationSummary,
  ChatV2StreamChunk,
} from "@/entityTypes/aiChatV2Types";
import type { OpenAIModel } from "@/api/aiChatApi";
import {
  getOpenAIChatModels,
  getChatV2Conversations,
  getChatV2History,
  streamChatV2Message,
  stopChatV2Stream,
} from "@/views/api/aiChatV2";
import AiChatV2ConversationList from "./AiChatV2ConversationList.vue";
import AiChatV2Messages from "./AiChatV2Messages.vue";
import AiChatV2Composer from "./AiChatV2Composer.vue";

type Status = "idle" | "streaming" | "cancelled" | "error";

const { t } = useI18n();

const models = ref<OpenAIModel[]>([]);
const selectedModel = ref<string | null>(null);
const conversations = ref<ChatV2ConversationSummary[]>([]);
const activeConversationId = ref<string | null>(null);
const messages = ref<ChatV2MessageView[]>([]);
const isStreaming = ref(false);
const streamError = ref<string | null>(null);
const activeAssistantMessageId = ref<string | null>(null);

const modelItems = computed(() => models.value);
const streamStatus = computed<Status>(() => {
  if (isStreaming.value) return "streaming";
  if (streamError.value) return "error";
  const last = messages.value[messages.value.length - 1];
  if (last?.metadata?.cancelled) return "cancelled";
  return "idle";
});

const loadModels = async (): Promise<void> => {
  try {
    const resp = await getOpenAIChatModels();
    models.value = resp?.data ?? [];
    if (!selectedModel.value && models.value.length > 0) {
      selectedModel.value = models.value[0].id;
    }
  } catch (err) {
    streamError.value = err instanceof Error ? err.message : (t("aiChatV2.model_unavailable") || "Model load failed");
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

const onSelectConversation = (conversationId: string): void => {
  stopIfStreaming();
  activeConversationId.value = conversationId;
  streamError.value = null;
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
      model: selectedModel.value ?? undefined,
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
        messages.value = [...messages.value];
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
  void loadModels();
  void loadConversations();
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
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}
.v2-shell__model {
  max-width: 220px;
}
.v2-shell__title {
  font-weight: 600;
}
.v2-shell__body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.v2-shell__sidebar {
  width: 200px;
  border-right: 1px solid rgba(0, 0, 0, 0.08);
  overflow-y: auto;
}
.v2-shell__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
</style>
