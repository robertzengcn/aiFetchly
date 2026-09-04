<template>
  <v-card variant="outlined" class="outbound-batch-card" border>
    <v-card-item>
      <div class="outbound-batch-card__header">
        <v-icon size="small" color="primary">mdi-email-multiple-outline</v-icon>
        <span class="text-subtitle-1 font-weight-bold">
          {{ t("outboundEmail.batch_card_title") || "Outbound Email Batch" }}
        </span>
      </div>
      <div class="text-caption text-medium-emphasis mt-1">
        {{
          t("outboundEmail.recipient_count") || "Recipients"
        }}: {{ recipientCount }}
        ·
        <v-chip size="x-small" variant="tonal" color="primary" class="ml-1">
          {{ modeLabel }}
        </v-chip>
      </div>
    </v-card-item>

    <v-divider />

    <v-card-actions v-if="showReviewAction" class="outbound-batch-card__actions">
      <v-alert
        v-if="mode === 'review_first'"
        type="info"
        variant="tonal"
        density="compact"
        class="flex-grow-1"
      >
        <v-icon start size="small">mdi-hand-back-right-outline</v-icon>
        {{ t("outboundEmail.review_reason") || "Review required" }}
      </v-alert>
      <v-spacer />
      <v-btn
        color="primary"
        variant="flat"
        size="small"
        data-testid="outbound-batch-review"
        @click="$emit('review-requested', batchId)"
      >
        <v-icon start size="small">mdi-eye-outline</v-icon>
        {{ t("outboundEmail.review_action") || "Review" }}
      </v-btn>
    </v-card-actions>

    <v-card-item v-else class="outbound-batch-card__summary">
      <div class="text-body-2">
        <v-icon size="small" start :color="summaryColor">{{ summaryIcon }}</v-icon>
        {{ summaryText }}
      </div>
    </v-card-item>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

/**
 * Compact batch summary shown inline in the AI chat result (§18). For a
 * review-able batch it surfaces a Review button that opens the review dialog;
 * for a terminal batch (sent / partially_sent / delivery_unknown / failed /
 * discarded) it shows the outcome summary instead. The direct-send
 * completion summary is shown here so the user does not need a separate page
 * (§18 last bullet).
 */
const props = defineProps<{
  batchId: number;
  mode: string;
  recipientCount: number;
  batchStatus: string;
  reasonCode: string;
  sentCount: number;
}>();

defineEmits<{
  (e: "review-requested", batchId: number): void;
}>();

const { t } = useI18n();

const modeLabel = computed<string>(() => {
  switch (props.mode) {
    case "send_now":
      return t("outboundEmail.mode_send_now") || "Send Now";
    case "review_first":
      return t("outboundEmail.mode_review_first") || "Review First";
    case "draft_only":
      return t("outboundEmail.mode_draft_only") || "Draft Only";
    default:
      return props.mode;
  }
});

/** Terminal batches hide the review button and show a summary instead. */
const showReviewAction = computed<boolean>(() => {
  return !["sent", "partially_sent", "delivery_unknown", "failed", "discarded"].includes(
    props.batchStatus
  );
});

const summaryText = computed<string>(() => {
  switch (props.batchStatus) {
    case "sent":
      return t("outboundEmail.sent_summary") || "Batch sent.";
    case "partially_sent":
      return t("outboundEmail.partial_summary") || "Batch partially sent.";
    case "delivery_unknown":
      return t("outboundEmail.unknown_summary") || "Delivery status unknown.";
    case "failed":
      return t("outboundEmail.failed_summary") || "Batch failed.";
    case "discarded":
      return t("outboundEmail.discarded_summary") || "Batch discarded.";
    default:
      return "";
  }
});

const summaryIcon = computed<string>(() => {
  switch (props.batchStatus) {
    case "sent":
      return "mdi-check-circle";
    case "partially_sent":
      return "mdi-alert-circle-outline";
    case "delivery_unknown":
      return "mdi-help-circle-outline";
    case "failed":
      return "mdi-close-circle";
    case "discarded":
      return "mdi-trash-can-outline";
    default:
      return "mdi-information-outline";
  }
});

const summaryColor = computed<string>(() => {
  switch (props.batchStatus) {
    case "sent":
      return "success";
    case "partially_sent":
      return "warning";
    case "delivery_unknown":
      return "warning";
    case "failed":
      return "error";
    case "discarded":
      return "grey";
    default:
      return "primary";
  }
});
</script>

<style scoped>
.outbound-batch-card {
  margin: 8px 0;
}
.outbound-batch-card__header {
  display: flex;
  align-items: center;
}
</style>
