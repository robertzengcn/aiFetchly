<template>
  <v-card variant="outlined" color="primary" class="v2-plan-card" border>
    <v-card-item>
      <div class="v2-plan-card__header">
        <v-icon size="small" color="primary">mdi-clipboard-check-outline</v-icon>
        <span class="text-subtitle-1 font-weight-bold">{{ planState.title }}</span>
        <v-chip size="x-small" variant="tonal" color="primary" class="ml-2">
          v{{ planState.currentVersion }}
        </v-chip>
      </div>
      <div class="text-caption text-medium-emphasis mt-1">
        {{ planState.objective }}
      </div>
    </v-card-item>

    <v-divider />

    <v-card-text class="v2-plan-card__body">
      <pre
        v-if="planState.latestVersion"
        class="v2-plan-card__markdown"
      >{{ planState.latestVersion.planMarkdown }}</pre>
      <div v-else class="text-body-2 text-medium-emphasis">
        {{ t("aiChatV2Plan.no_plan_yet") || "No plan content yet." }}
      </div>
    </v-card-text>

    <v-divider />

    <v-card-actions v-if="!showFeedback" class="v2-plan-card__actions">
      <v-btn
        v-if="planState.status === 'awaiting_approval'"
        color="success"
        variant="flat"
        size="small"
        :disabled="disabled"
        @click="$emit('approve')"
      >
        <v-icon start size="small">mdi-check</v-icon>
        {{ t("aiChatV2Plan.approve") || "Approve" }}
      </v-btn>
      <v-btn
        v-if="planState.status === 'awaiting_approval'"
        color="error"
        variant="tonal"
        size="small"
        :disabled="disabled"
        @click="startFeedback('reject')"
      >
        <v-icon start size="small">mdi-close</v-icon>
        {{ t("aiChatV2Plan.reject") || "Reject" }}
      </v-btn>
      <v-btn
        v-if="planState.status === 'awaiting_approval'"
        color="warning"
        variant="tonal"
        size="small"
        :disabled="disabled"
        @click="startFeedback('changes')"
      >
        <v-icon start size="small">mdi-pencil-outline</v-icon>
        {{ t("aiChatV2Plan.request_changes") || "Request Changes" }}
      </v-btn>
      <v-chip
        v-if="planState.status === 'approved'"
        size="small"
        color="success"
        variant="flat"
      >
        <v-icon start size="small">mdi-check-circle</v-icon>
        {{ t("aiChatV2Plan.approved") || "Approved" }}
      </v-chip>
    </v-card-actions>

    <v-card-text v-if="showFeedback" class="v2-plan-card__feedback">
      <v-textarea
        v-model="feedbackText"
        :label="
          feedbackMode === 'reject'
            ? t('aiChatV2Plan.reject_feedback') || 'Reason for rejection'
            : t('aiChatV2Plan.changes_feedback') || 'What needs to change?'
        "
        variant="outlined"
        density="compact"
        rows="2"
        auto-grow
        hide-details
      />
      <div class="v2-plan-card__feedback-actions">
        <v-btn size="small" variant="text" @click="cancelFeedback">
          {{ t("common.cancel") || "Cancel" }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          size="small"
          :disabled="feedbackText.trim().length === 0"
          @click="submitFeedback"
        >
          {{ t("common.submit") || "Submit" }}
        </v-btn>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import type { AIChatPlanStateView } from "@/entityTypes/aiChatPlanTypes";

defineProps<{
  planState: AIChatPlanStateView;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  (e: "approve"): void;
  (e: "reject", feedback: string): void;
  (e: "requestChanges", feedback: string): void;
}>();
const { t } = useI18n();

const showFeedback = ref(false);
const feedbackMode = ref<"reject" | "changes">("reject");
const feedbackText = ref("");

const startFeedback = (mode: "reject" | "changes"): void => {
  feedbackMode.value = mode;
  feedbackText.value = "";
  showFeedback.value = true;
};

const cancelFeedback = (): void => {
  showFeedback.value = false;
  feedbackText.value = "";
};

const submitFeedback = (): void => {
  const text = feedbackText.value.trim();
  if (!text) return;
  if (feedbackMode.value === "reject") {
    emit("reject", text);
  } else {
    emit("requestChanges", text);
  }
  showFeedback.value = false;
  feedbackText.value = "";
};
</script>

<style scoped>
.v2-plan-card {
  margin: 8px 0;
}
.v2-plan-card__header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.v2-plan-card__body {
  max-height: 400px;
  overflow-y: auto;
}
.v2-plan-card__markdown {
  font-family: inherit;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-wrap: break-word;
  margin: 0;
}
.v2-plan-card__markdown :deep(h1) {
  font-size: 1.3em;
  margin: 0.6em 0 0.3em;
}
.v2-plan-card__markdown :deep(h2) {
  font-size: 1.15em;
  margin: 0.6em 0 0.3em;
}
.v2-plan-card__markdown :deep(h3) {
  font-size: 1.05em;
  margin: 0.5em 0 0.2em;
}
.v2-plan-card__markdown :deep(ul),
.v2-plan-card__markdown :deep(ol) {
  padding-left: 1.5em;
}
.v2-plan-card__markdown :deep(code) {
  background-color: rgba(0, 0, 0, 0.06);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 0.9em;
}
.v2-plan-card__markdown :deep(pre) {
  background-color: rgba(0, 0, 0, 0.06);
  padding: 8px 12px;
  border-radius: 6px;
  overflow-x: auto;
}
.v2-plan-card__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 16px;
}
.v2-plan-card__feedback-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
</style>
