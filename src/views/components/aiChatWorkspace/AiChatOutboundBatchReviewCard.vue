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
      @review-requested="reviewBatchId = $event"
    />
    <OutboundEmailReviewDialog
      v-if="reviewBatchId !== null"
      v-model="reviewDialogOpen"
      :batch-id="reviewBatchId"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import OutboundEmailBatchCard from "@/views/components/outboundEmail/OutboundEmailBatchCard.vue";
import OutboundEmailReviewDialog from "@/views/components/outboundEmail/OutboundEmailReviewDialog.vue";
import { deriveOutboundBatchCardModel } from "@/views/components/outboundEmail/outboundBatchCardModel";

const props = defineProps<{
  /** The draft_outbound_email_batch tool-result message. */
  message: ChatV2MessageView;
}>();

const batch = computed(() => deriveOutboundBatchCardModel(props.message));

const reviewBatchId = ref<number | null>(null);
const reviewDialogOpen = ref<boolean>(true);

// When the review dialog closes, clear the batch id so the card can be
// re-opened (and a stale dialog does not linger after the batch changes).
watch(reviewDialogOpen, (open) => {
  if (!open) {
    reviewBatchId.value = null;
  }
});
</script>

<style scoped>
.workspace-outbound-batch {
  margin: 2px 0;
}
</style>
