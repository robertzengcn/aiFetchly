<template>
  <!--
    Interactive outbound-email batch surface for the workspace transcript
    (outbound design §18): the draft_outbound_email_batch tool result must
    surface its Review card — the AD-003 "trusted app code authorizes"
    surface — not hide behind the collapsed execution-group receipt. Hosts
    the same card + review dialog pair the legacy message renderer uses.
  -->
  <div class="workspace-outbound-batch" data-testid="workspace-outbound-batch">
    <OutboundEmailBatchCard
      v-if="batch"
      :batch-id="batch.batchId"
      :mode="batch.mode"
      :recipient-count="batch.recipientCount"
      :batch-status="batch.batchStatus"
      :reason-code="batch.reasonCode"
      :sent-count="batch.sentCount"
      @review-requested="onReviewRequested"
    />
    <OutboundEmailReviewDialog
      v-if="reviewBatchId !== null"
      v-model="reviewDialogOpen"
      :batch-id="reviewBatchId"
      @sent="onDialogSent"
      @discarded="onDialogDiscarded"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import type { AuthorizedEmailWorkerEvent } from "@/entityTypes/outboundEmailDeliveryTypes";
import OutboundEmailBatchCard from "@/views/components/outboundEmail/OutboundEmailBatchCard.vue";
import OutboundEmailReviewDialog from "@/views/components/outboundEmail/OutboundEmailReviewDialog.vue";
import { deriveOutboundBatchCardModel } from "@/views/components/outboundEmail/outboundBatchCardModel";
import {
  getOutboundEmailBatchStatus,
  subscribeOutboundEmailProgress,
  removeOutboundEmailProgressListener,
} from "@/views/api/outboundEmailDelivery";

const props = defineProps<{
  /** The draft_outbound_email_batch tool-result message. */
  message: ChatV2MessageView;
}>();

/** P1-6: authoritative status override from the delivery pipeline (send,
 * discard, terminal delivery) — shadows the frozen tool-result draft. */
const refreshedStatus = ref<{
  batchStatus: string;
  sentCount: number;
  reasonCode: string;
} | null>(null);

const batch = computed(() => {
  const base = deriveOutboundBatchCardModel(props.message);
  if (!base || !refreshedStatus.value) return base;
  return {
    ...base,
    batchStatus: refreshedStatus.value.batchStatus,
    sentCount: refreshedStatus.value.sentCount,
    reasonCode: refreshedStatus.value.reasonCode,
  };
});

const reviewBatchId = ref<number | null>(null);
const reviewDialogOpen = ref<boolean>(true);

// When the review dialog closes, clear the batch id so the card can be
// re-opened (and a stale dialog does not linger after the batch changes).
watch(reviewDialogOpen, (open) => {
  if (!open) {
    reviewBatchId.value = null;
  }
});

// P1-6: terminal delivery events flip the frozen draft card to the
// authoritative terminal state (worker complete is the confirmation point
// of §8.3 — the bridge recomputes batch status before broadcasting).
let progressListener: ((event: unknown) => void) | null = null;
onMounted(() => {
  progressListener = subscribeOutboundEmailProgress(
    (event: AuthorizedEmailWorkerEvent) => {
      if (event.type !== "authorized-email-worker-complete") return;
      void refreshStatus();
    }
  );
});
onUnmounted(() => {
  if (progressListener) {
    removeOutboundEmailProgressListener(progressListener);
    progressListener = null;
  }
});

async function refreshStatus(): Promise<void> {
  const current = batch.value;
  if (!current) return;
  try {
    const status = await getOutboundEmailBatchStatus(current.batchId);
    const sentCount = status.outcomes.filter(
      (outcome) => outcome.status === "sent"
    ).length;
    // Sanitized reason code: batch status when no per-recipient failure
    // code exists; otherwise the first non-sent outcome's error code.
    const firstIssue = status.outcomes.find(
      (outcome) =>
        outcome.status === "delivery_unknown" || outcome.status === "failed"
    );
    refreshedStatus.value = {
      batchStatus: status.batchStatus,
      sentCount,
      reasonCode: firstIssue?.errorCode ?? status.batchStatus,
    };
  } catch {
    // Best-effort refresh; the frozen tool-result draft stays in place.
  }
}

/** Review must set BOTH the target and the open flag — setting only the id
 * would remount the dialog with modelValue still false (it was reset on the
 * previous close), leaving a dismissed batch impossible to re-open. */
function onReviewRequested(batchId: number): void {
  reviewBatchId.value = batchId;
  reviewDialogOpen.value = true;
}

// P1-6: send/discard turn the transcript card's frozen draft into the
// terminal receipt read from the authoritative batch status.
async function onDialogSent(): Promise<void> {
  await refreshStatus();
}

async function onDialogDiscarded(): Promise<void> {
  await refreshStatus();
}
</script>

<style scoped>
.workspace-outbound-batch {
  margin: 2px 0;
}
</style>
