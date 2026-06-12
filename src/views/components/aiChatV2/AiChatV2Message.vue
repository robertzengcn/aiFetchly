<template>
  <div class="v2-message" :class="`v2-message--${message.role}`">
    <div class="v2-message__bubble">
      <div class="v2-message__role">{{ roleLabel }}</div>
      <div class="v2-message__content">{{ message.content }}</div>
      <AiChatV2StreamStatus
        v-if="message.role === 'assistant' && status !== 'idle'"
        :status="status"
        :error-message="errorMessage"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import AiChatV2StreamStatus from "./AiChatV2StreamStatus.vue";

type Status = "idle" | "streaming" | "cancelled" | "error";

const props = defineProps<{
  message: ChatV2MessageView;
  status?: Status;
  errorMessage?: string;
}>();
const { t } = useI18n();

const roleLabel = computed(() => {
  if (props.message.role === "user") return t("common.user") || "You";
  if (props.message.role === "assistant") return "AI";
  return props.message.role;
});

const status = computed<Status>(() => props.status ?? "idle");
</script>

<style scoped>
.v2-message {
  display: flex;
  margin: 8px 0;
}
.v2-message--user {
  justify-content: flex-end;
}
.v2-message--assistant,
.v2-message--system,
.v2-message--tool {
  justify-content: flex-start;
}
.v2-message__bubble {
  max-width: 80%;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.04);
  word-break: break-word;
}
.v2-message--user .v2-message__bubble {
  background: rgba(25, 118, 210, 0.12);
}
.v2-message__role {
  font-size: 11px;
  opacity: 0.6;
  margin-bottom: 2px;
}
.v2-message__content {
  white-space: pre-wrap;
  line-height: 1.45;
}
</style>
