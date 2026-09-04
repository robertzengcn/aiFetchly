<template>
  <v-card variant="outlined" class="outbound-progress" border>
    <v-card-item>
      <div class="outbound-progress__header">
        <v-icon size="small" color="primary">mdi-send-clock-outline</v-icon>
        <span class="text-subtitle-2 font-weight-bold">
          {{ t("outboundEmail.progress_title") || "Delivery Progress" }}
        </span>
      </div>
    </v-card-item>

    <v-divider />

    <v-card-text class="outbound-progress__body">
      <div v-if="outcomes.length === 0" class="text-body-2 text-medium-emphasis">
        {{ t("outboundEmail.progress_title") || "Delivery Progress" }}
      </div>
      <div
        v-for="outcome in outcomes"
        :key="outcome.draftId"
        class="outbound-progress__row"
        :data-testid="`outbound-progress-row-${outcome.draftId}`"
      >
        <div class="outbound-progress__recipient">
          <v-icon size="x-small" start>{{ statusIcon(outcome.status) }}</v-icon>
          <span>{{ outcome.recipientAddress }}</span>
        </div>
        <v-chip
          size="x-small"
          :color="statusColor(outcome.status)"
          variant="tonal"
        >
          {{ statusLabel(outcome.status) }}
        </v-chip>
        <span
          v-if="outcome.errorCode"
          class="text-caption text-medium-emphasis ml-2"
        >
          {{ outcome.errorCode }}
        </span>
        <v-btn
          v-if="outcome.status === 'failed'"
          variant="tonal"
          size="x-small"
          color="warning"
          class="ml-2"
          :data-testid="`outbound-progress-retry-${outcome.draftId}`"
          @click="$emit('retry', outcome.draftId)"
        >
          <v-icon start size="x-small">mdi-refresh</v-icon>
          {{ t("outboundEmail.retry") || "Retry" }}
        </v-btn>
        <!-- §18: never offer one-click retry for delivery_unknown. Show an
             explanatory note instead. -->
        <span
          v-if="outcome.status === 'delivery_unknown'"
          class="text-caption text-warning ml-2"
        >
          {{ t("outboundEmail.unknown_no_retry") || "Status unknown — do not auto-retry." }}
        </span>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

/**
 * Live per-recipient delivery outcomes (§18). Renders one row per outcome
 * with recipient address, status, error code, and provider message id.
 * Distinguishes `failed` (retry offered) from `delivery_unknown` (no retry —
 * §18 "never offer one-click retry for delivery_unknown").
 */
interface OutboundProgressOutcome {
  readonly draftId: number;
  readonly recipientAddress: string;
  readonly status: string;
  readonly errorCode: string | null;
  readonly providerMessageId: string | null;
}

defineProps<{
  outcomes: OutboundProgressOutcome[];
  attemptStatus: string | null;
}>();

defineEmits<{
  (e: "retry", draftId: number): void;
}>();

const { t } = useI18n();

function statusLabel(status: string): string {
  switch (status) {
    case "submitted":
      return t("outboundEmail.submitted") || "Submitted";
    case "sent":
      return t("outboundEmail.sent") || "Sent";
    case "failed":
      return t("outboundEmail.failed") || "Failed";
    case "delivery_unknown":
      return t("outboundEmail.delivery_unknown") || "Delivery Unknown";
    default:
      return status;
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case "submitted":
      return "mdi-clock-outline";
    case "sent":
      return "mdi-check-circle";
    case "failed":
      return "mdi-alert-circle";
    case "delivery_unknown":
      return "mdi-help-circle";
    default:
      return "mdi-email-outline";
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "submitted":
      return "info";
    case "sent":
      return "success";
    case "failed":
      return "error";
    case "delivery_unknown":
      return "warning";
    default:
      return "grey";
  }
}
</script>

<style scoped>
.outbound-progress {
  margin: 8px 0;
}
.outbound-progress__header {
  display: flex;
  align-items: center;
}
.outbound-progress__body {
  padding: 8px 16px;
}
.outbound-progress__row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 0;
  border-bottom: 1px solid rgba(var(--v-border-color), 0.12);
}
.outbound-progress__row:last-child {
  border-bottom: none;
}
.outbound-progress__recipient {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}
</style>
