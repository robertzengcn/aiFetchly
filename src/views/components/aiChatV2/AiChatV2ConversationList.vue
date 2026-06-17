<template>
  <div class="v2-conv-list">
    <v-btn
      block
      variant="tonal"
      color="primary"
      prepend-icon="mdi-plus"
      class="mb-2"
      @click="$emit('new-conversation')"
    >
      {{ t("aiChatV2.new_conversation") || "New conversation" }}
    </v-btn>
    <v-list density="compact" class="v2-conv-list__items">
      <v-list-item
        v-for="conv in conversations"
        :key="conv.conversationId"
        :active="conv.conversationId === activeConversationId"
        :title="conv.title"
        :subtitle="formatTime(conv.lastMessageTimestamp)"
        @click="$emit('select', conv.conversationId)"
      />
    </v-list>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { ChatV2ConversationSummary } from "@/entityTypes/aiChatV2Types";

defineProps<{
  conversations: ChatV2ConversationSummary[];
  activeConversationId: string | null;
}>();
defineEmits<{
  (e: "new-conversation"): void;
  (e: "select", conversationId: string): void;
}>();

const { t } = useI18n();

const formatTime = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return "";
  }
};
</script>

<style scoped>
.v2-conv-list {
  padding: 8px;
  min-width: 0;
}
.v2-conv-list__items {
  max-height: 100%;
  overflow-y: auto;
}
</style>
