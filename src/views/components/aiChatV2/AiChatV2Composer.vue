<template>
  <div class="v2-composer">
    <div v-if="$slots.prepend" class="v2-composer__prepend">
      <slot name="prepend" />
    </div>
    <v-textarea
      v-model="draft"
      :placeholder="t('aiChatV2.input_placeholder') || 'Send a message…'"
      variant="outlined"
      auto-grow
      rows="1"
      max-rows="6"
      hide-details
      density="comfortable"
      :disabled="isStreaming"
      @keydown="onKeydown"
    />
    <div class="v2-composer__actions">
      <v-btn
        v-if="!isStreaming"
        color="primary"
        icon="mdi-send"
        size="small"
        :disabled="draft.trim().length === 0"
        :aria-label="t('aiChatV2.send') || 'Send'"
        @click="onSend"
      />
      <v-btn
        v-else
        color="error"
        icon="mdi-stop"
        size="small"
        :aria-label="t('aiChatV2.stop') || 'Stop'"
        @click="$emit('stop')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{ isStreaming: boolean }>();
const emit = defineEmits<{
  (e: "send", text: string): void;
  (e: "stop"): void;
}>();
const { t } = useI18n();

const draft = ref("");

const onSend = (): void => {
  const text = draft.value.trim();
  if (!text || props.isStreaming) return;
  emit("send", text);
  draft.value = "";
};

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    onSend();
  }
};
</script>

<style scoped>
.v2-composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
}
.v2-composer__actions {
  display: flex;
  align-items: center;
  padding-bottom: 4px;
}
.v2-composer__prepend {
  display: flex;
  align-items: center;
  padding-bottom: 4px;
}
</style>
