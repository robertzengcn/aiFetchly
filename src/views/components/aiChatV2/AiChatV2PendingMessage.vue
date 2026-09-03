<template>
  <div
    class="v2-pending"
    :class="`v2-pending--${view.status}`"
    data-testid="ai-chat-pending-message"
  >
    <div class="v2-pending__content">
      <slot name="content">
        <span class="v2-pending__text">{{ view.content }}</span>
      </slot>
      <div
        v-if="attachmentChips.length > 0"
        class="v2-pending__attachments"
        data-testid="ai-chat-pending-attachments"
      >
        <span
          v-for="attachment in attachmentChips"
          :key="attachment.fileName"
          class="v2-pending__chip"
        >
          <v-icon size="x-small" class="mr-1">mdi-paperclip</v-icon>
          {{ attachment.fileName }}
        </span>
      </div>
    </div>
    <div class="v2-pending__status-row">
      <span class="v2-pending__status" aria-live="polite">
        <v-icon size="x-small" class="mr-1">{{ statusIcon }}</v-icon>
        {{ statusLabel }}
      </span>
      <span
        v-if="view.recoveryReason"
        class="v2-pending__recovery"
        data-testid="ai-chat-pending-recovery"
      >
        {{ t("aiChatV2.queue.recovered_after_restart") || "Recovered after restart" }}
      </span>
      <v-btn
        v-if="showSteer"
        size="x-small"
        variant="tonal"
        color="primary"
        class="ml-2"
        data-testid="ai-chat-pending-steer"
        :loading="busy"
        :disabled="busy"
        :aria-label="
          t('aiChatV2.queue.steer_aria') ||
          'Steer active response with this message'
        "
        @click="onSteer"
      >
        <v-icon size="x-small" class="mr-1">mdi-directions-fork</v-icon>
        {{ t("aiChatV2.queue.steer") || "Steer" }}
      </v-btn>
      <span
        v-else-if="steerBlockedByAttachments"
        class="v2-pending__steer-hint"
        :title="
          t('aiChatV2.queue.attachments_not_steerable') ||
          'Messages with attachments will send after the current response.'
        "
      >
        <v-icon size="x-small">mdi-information-outline</v-icon>
      </span>
      <v-btn
        v-if="canRemove"
        size="x-small"
        variant="text"
        color="default"
        class="ml-1"
        data-testid="ai-chat-pending-remove"
        :loading="busy"
        :disabled="busy"
        :aria-label="t('aiChatV2.queue.remove') || 'Remove queued message'"
        @click="onCancel"
      >
        <v-icon size="x-small">mdi-close</v-icon>
        {{ t("aiChatV2.queue.remove") || "Remove" }}
      </v-btn>
      <v-btn
        v-if="showResume"
        size="x-small"
        variant="tonal"
        color="primary"
        class="ml-1"
        data-testid="ai-chat-pending-resume"
        :loading="busy"
        :disabled="busy"
        :aria-label="t('aiChatV2.queue.send_next') || 'Send next message'"
        @click="onResume"
      >
        <v-icon size="x-small" class="mr-1">mdi-play</v-icon>
        {{ t("aiChatV2.queue.send_next") || "Send next" }}
      </v-btn>
    </div>
    <div
      v-if="failureText"
      class="v2-pending__failure"
      data-testid="ai-chat-pending-failure"
    >
      {{ failureText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type {
  AIChatPendingMessageView,
  ChatV2RuntimeStatus,
} from "@/entityTypes/aiChatV2Types";

const props = withDefaults(
  defineProps<{
    view: AIChatPendingMessageView;
    /** Main-process runtime status of this conversation. */
    runtimeStatus?: ChatV2RuntimeStatus;
    /** Steering kill switch (renderer presentation only; default on). */
    steeringEnabled?: boolean;
  }>(),
  { steeringEnabled: true }
);

const emit = defineEmits<{
  (e: "steer", pendingMessageId: string): void;
  (e: "cancel", pendingMessageId: string): void;
  (e: "resume", conversationId: string): void;
}>();

const { t } = useI18n();
const busy = ref(false);

const attachmentChips = computed(() => props.view.attachmentMetadata ?? []);

const steerBlockedByAttachments = computed(
  () =>
    props.view.status === "queued" &&
    attachmentChips.value.length > 0 &&
    props.runtimeStatus === "running"
);

const showSteer = computed(
  () =>
    props.steeringEnabled !== false &&
    props.view.status === "queued" &&
    attachmentChips.value.length === 0 &&
    props.runtimeStatus === "running"
);

const canRemove = computed(
  () =>
    !busy.value &&
    (props.view.status === "queued" ||
      props.view.status === "paused" ||
      props.view.status === "failed")
);

const showResume = computed(
  () => !busy.value && props.view.status === "paused"
);

const statusIcon = computed<string>(() => {
  switch (props.view.status) {
    case "queued":
      return "mdi-clock-outline";
    case "steering":
      return "mdi-directions-fork";
    case "applied":
      return "mdi-check-circle-outline";
    case "dispatching":
    case "sent":
      return "mdi-send-outline";
    case "paused":
      return "mdi-pause-circle-outline";
    case "cancelled":
      return "mdi-close-circle-outline";
    case "failed":
      return "mdi-alert-circle-outline";
    default:
      return "mdi-clock-outline";
  }
});

const statusLabel = computed<string>(() => {
  const keyByStatus: Record<string, string> = {
    queued: "aiChatV2.queue.queued",
    steering: "aiChatV2.queue.steering",
    applied: "aiChatV2.queue.applied",
    dispatching: "aiChatV2.queue.dispatching",
    sent: "aiChatV2.queue.sent",
    paused: "aiChatV2.queue.paused",
    cancelled: "aiChatV2.queue.cancelled",
    failed: "aiChatV2.queue.failed",
  };
  const key = keyByStatus[props.view.status] ?? "aiChatV2.queue.queued";
  const fallbackByStatus: Record<string, string> = {
    queued: "Queued",
    steering: "Steering…",
    applied: "Applied",
    dispatching: "Sending…",
    sent: "Sent",
    paused: "Queue paused",
    cancelled: "Removed",
    failed: "Couldn't send",
  };
  return t(key) || fallbackByStatus[props.view.status] || "Queued";
});

const failureText = computed<string | null>(() => {
  if (!props.view.failureMessage && !props.view.failureCode) return null;
  return props.view.failureMessage || props.view.failureCode || null;
});

function onSteer(): void {
  if (busy.value) return;
  busy.value = true;
  emit("steer", props.view.pendingMessageId);
  // Release the busy latch shortly — the pending event stream updates the
  // row state; the latch only guards double-clicks during the IPC round trip.
  setTimeout(() => {
    busy.value = false;
  }, 4000);
}

function onCancel(): void {
  if (busy.value) return;
  busy.value = true;
  emit("cancel", props.view.pendingMessageId);
  setTimeout(() => {
    busy.value = false;
  }, 4000);
}

function onResume(): void {
  if (busy.value) return;
  busy.value = true;
  emit("resume", props.view.conversationId);
  setTimeout(() => {
    busy.value = false;
  }, 4000);
}
</script>

<style scoped>
.v2-pending {
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.35);
  border-radius: 12px;
  padding: 8px 12px;
  margin: 4px 0;
  opacity: 0.92;
}
.v2-pending--sent,
.v2-pending--applied,
.v2-pending--cancelled {
  opacity: 0.6;
}
.v2-pending__content {
  white-space: pre-wrap;
  word-break: break-word;
}
.v2-pending__attachments {
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.v2-pending__chip {
  font-size: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.2);
  border-radius: 8px;
  padding: 2px 6px;
}
.v2-pending__status-row {
  display: flex;
  align-items: center;
  margin-top: 4px;
  flex-wrap: wrap;
  gap: 4px;
}
.v2-pending__status {
  font-size: 12px;
  opacity: 0.8;
  display: inline-flex;
  align-items: center;
}
.v2-pending__steer-hint {
  opacity: 0.6;
  cursor: help;
}
.v2-pending__failure {
  font-size: 12px;
  color: rgb(var(--v-theme-error));
  margin-top: 4px;
}
</style>
