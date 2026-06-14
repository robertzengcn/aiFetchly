<template>
  <div ref="scroller" class="v2-messages" @scroll="onScroll">
    <div v-if="messages.length === 0" class="v2-messages__empty">
      <v-icon size="40" color="grey-lighten-1">mdi-chat-outline</v-icon>
      <div class="v2-messages__empty-title">
        {{ t("aiChatV2.empty_title") || "Start a conversation" }}
      </div>
      <div class="v2-messages__empty-desc">
        {{ t("aiChatV2.empty_description") || "Ask anything." }}
      </div>
    </div>
    <AiChatV2Message
      v-for="m in messages"
      :key="m.id"
      :message="m"
      :status="m.id === activeAssistantMessageId ? streamStatus : 'idle'"
      :error-message="errorMessage"
      @grant-permission="onGrantPermission"
      @deny-permission="onDenyPermission"
    />
    <div
      v-if="showTypingIndicator"
      class="v2-messages__typing"
      :aria-label="t('aiChatV2.thinking') || 'AI is thinking…'"
    >
      <span class="v2-messages__typing-dot" />
      <span class="v2-messages__typing-dot" />
      <span class="v2-messages__typing-dot" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import AiChatV2Message from "./AiChatV2Message.vue";

type Status = "idle" | "streaming" | "cancelled" | "error";

const props = defineProps<{
  messages: ChatV2MessageView[];
  activeAssistantMessageId: string | null;
  streamStatus: Status;
  errorMessage?: string;
  showTypingIndicator?: boolean;
}>();
const emit = defineEmits<{
  (e: "grant-permission", message: ChatV2MessageView, persistent: boolean): void;
  (e: "deny-permission", message: ChatV2MessageView): void;
}>();
const { t } = useI18n();

const scroller = ref<HTMLDivElement | null>(null);
let pinnedToBottom = true;

const scrollToBottom = async (): Promise<void> => {
  await nextTick();
  if (scroller.value && pinnedToBottom) {
    scroller.value.scrollTop = scroller.value.scrollHeight;
  }
};

const onScroll = (): void => {
  const el = scroller.value;
  if (!el) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  pinnedToBottom = atBottom;
};

const onGrantPermission = (
  message: ChatV2MessageView,
  payload: { persistent: boolean }
): void => {
  emit("grant-permission", message, payload.persistent);
};

const onDenyPermission = (message: ChatV2MessageView): void => {
  emit("deny-permission", message);
};

onMounted(scrollToBottom);
watch(() => props.messages.length, scrollToBottom);
watch(() => props.showTypingIndicator, scrollToBottom);
watch(
  () => {
    // Track only the last message's id + content length instead of joining
    // all message contents (avoids O(n) string allocation per token).
    const last = props.messages[props.messages.length - 1];
    return last ? `${last.id}:${last.content.length}` : "";
  },
  scrollToBottom
);
</script>

<style scoped>
.v2-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}
.v2-messages__empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: rgba(0, 0, 0, 0.45);
  text-align: center;
  gap: 6px;
}
.v2-messages__empty-title {
  font-weight: 600;
  margin-top: 8px;
}
.v2-messages__empty-desc {
  font-size: 13px;
}
.v2-messages__typing {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  margin-top: 8px;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 12px;
  width: fit-content;
}
.v2-messages__typing-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.4);
  animation: v2-typing-bounce 1.2s infinite ease-in-out;
}
.v2-messages__typing-dot:nth-child(2) {
  animation-delay: 0.15s;
}
.v2-messages__typing-dot:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes v2-typing-bounce {
  0%,
  60%,
  100% {
    transform: translateY(0);
    opacity: 0.5;
  }
  30% {
    transform: translateY(-4px);
    opacity: 1;
  }
}
</style>
