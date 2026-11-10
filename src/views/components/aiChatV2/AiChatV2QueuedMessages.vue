<template>
  <!-- Pinned above the composer. Queued rows are not transcript history:
       they stay visible while the conversation scrolls. -->
  <div
    v-if="pendingMessages.length > 0"
    ref="listEl"
    class="v2-queued"
    data-testid="ai-chat-queued-messages"
    role="region"
    :aria-label="t('aiChatV2.queue.region') || 'Queued messages'"
  >
    <AiChatV2PendingMessage
      v-for="pending in pendingMessages"
      :key="`pending-${pending.pendingMessageId}`"
      :view="pending"
      :runtime-status="runtimeStatus"
      :steering-enabled="steeringEnabled"
      @steer="(id: string) => emit('steer', id)"
      @cancel="(id: string) => emit('cancel', id)"
      @resume="(conversationId: string) => emit('resume', conversationId)"
    />
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type {
  AIChatPendingMessageView,
  ChatV2RuntimeStatus,
} from "@/entityTypes/aiChatV2Types";
import AiChatV2PendingMessage from "./AiChatV2PendingMessage.vue";

const props = withDefaults(
  defineProps<{
    pendingMessages?: readonly AIChatPendingMessageView[];
    /** Main-process runtime status, drives Steer visibility (PRD §7.3). */
    runtimeStatus?: ChatV2RuntimeStatus;
    /** Steering kill switch (presentation only; default on). */
    steeringEnabled?: boolean;
  }>(),
  { steeringEnabled: true, pendingMessages: () => [] }
);

const listEl = ref<HTMLDivElement | null>(null);

/** Keep the newest queued row in view, just above the composer. */
async function scrollQueueToEnd(): Promise<void> {
  await nextTick();
  const el = listEl.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

watch(
  () => props.pendingMessages.map((row) => row.pendingMessageId).join("\n"),
  () => {
    void scrollQueueToEnd();
  }
);

onMounted(() => {
  void scrollQueueToEnd();
});

const emit = defineEmits<{
  (e: "steer", pendingMessageId: string): void;
  (e: "cancel", pendingMessageId: string): void;
  (e: "resume", conversationId: string): void;
}>();

const { t } = useI18n();
</script>

<style scoped>
.v2-queued {
  flex: 0 0 auto;
  max-height: 168px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 12px 4px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-on-surface), 0.03);
}
</style>
