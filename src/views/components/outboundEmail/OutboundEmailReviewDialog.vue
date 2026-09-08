<template>
  <v-dialog
    :model-value="modelValue"
    max-width="720"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card v-if="loaded" class="outbound-review">
      <v-card-item>
        <div class="outbound-review__header">
          <v-icon size="small" color="primary">mdi-email-edit-outline</v-icon>
          <span class="text-h6">
            {{ t("outboundEmail.review_title") || "Review Outbound Email" }}
          </span>
        </div>
        <div class="text-caption text-medium-emphasis mt-1">
          {{ t("outboundEmail.recipient_count") || "Recipients" }}:
          {{ batch?.recipientCount }} ·
          {{ t("outboundEmail.mode") || "Mode" }}:
          {{ modeLabel }}
        </div>
      </v-card-item>

      <v-divider />

      <v-card-text class="outbound-review__body">
        <v-alert
          v-if="approvalInvalidated"
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-3"
        >
          <v-icon start size="small">mdi-alert-outline</v-icon>
          {{
            t("outboundEmail.approval_invalidated") ||
            "Edits invalidate prior approval. Re-approve before sending."
          }}
        </v-alert>
        <v-alert
          v-if="preflightError"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-3"
        >
          <v-icon start size="small">mdi-alert-circle-outline</v-icon>
          {{ t("outboundEmail.preflight_blocked") || "Cannot approve: blocking findings." }}
          <span class="ml-1 text-caption">({{ preflightError }})</span>
        </v-alert>
        <v-alert
          v-if="sendError"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-3"
        >
          {{ sendError }}
        </v-alert>
        <v-alert
          v-if="sendSuccess"
          type="success"
          variant="tonal"
          density="compact"
          class="mb-3"
        >
          {{ t("outboundEmail.send_success") || "Batch queued for delivery." }}
        </v-alert>

        <outbound-email-recipient-draft
          v-for="draft in drafts"
          :key="draft.id"
          :draft="draft"
          :edit-mode="editingDraftId === draft.id"
          @edit-requested="startEdit(draft.id)"
          @save="(payload) => onDraftSave(draft.id, draft, payload)"
          @cancel="cancelEdit"
        />

        <outbound-email-delivery-progress
          v-if="attemptStatus"
          :outcomes="progressOutcomes"
          :attempt-status="attemptStatus"
          @retry="onRetry"
        />
      </v-card-text>

      <v-divider />

      <v-card-actions class="outbound-review__actions">
        <v-btn
          variant="tonal"
          color="error"
          size="small"
          data-testid="outbound-review-discard"
          :disabled="busy"
          @click="onDiscard"
        >
          <v-icon start size="small">mdi-trash-can-outline</v-icon>
          {{ t("outboundEmail.discard") || "Discard" }}
        </v-btn>
        <v-spacer />
        <v-btn
          variant="flat"
          color="primary"
          size="small"
          data-testid="outbound-review-approve"
          :disabled="busy"
          @click="onApprove"
        >
          <v-icon start size="small">mdi-check</v-icon>
          {{ t("outboundEmail.approve") || "Approve" }}
        </v-btn>
        <v-btn
          variant="flat"
          color="success"
          size="small"
          data-testid="outbound-review-send"
          :disabled="busy || !canSend"
          @click="onSend"
        >
          <v-icon start size="small">mdi-send</v-icon>
          {{ t("outboundEmail.send") || "Send" }}
        </v-btn>
      </v-card-actions>
    </v-card>
    <v-card v-else class="pa-8 text-center">
      <v-icon size="large" class="mdi-spin">mdi-loading</v-icon>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import OutboundEmailRecipientDraft from "./OutboundEmailRecipientDraft.vue";
import OutboundEmailDeliveryProgress from "./OutboundEmailDeliveryProgress.vue";
import {
  getOutboundEmailBatch,
  updateOutboundEmailDraft,
  approveOutboundEmailBatch,
  sendOutboundEmailBatch,
  discardOutboundEmailBatch,
  getOutboundEmailBatchStatus,
  subscribeOutboundEmailProgress,
  removeOutboundEmailProgressListener,
} from "@/views/api/outboundEmailDelivery";
import type {
  OutboundEmailBatchView,
  OutboundEmailDraftView,
  OutboundEmailOutcomeView,
} from "@/views/api/outboundEmailDelivery";
import type { AuthorizedEmailWorkerEvent } from "@/entityTypes/outboundEmailDeliveryTypes";

/**
 * Review/edit/approve/send dialog for an outbound batch (§18). Loads the
 * batch + drafts + current revisions, lets the user edit (which creates a
 * new revision and invalidates prior approval — §13.3), reruns preflight on
 * approve, and starts authorized delivery on send. The raw approval token is
 * held in a ref (never persisted, never logged) and discarded on close.
 */
const props = defineProps<{
  modelValue: boolean;
  batchId: number;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "sent", batchId: number, attemptId: number): void;
  (e: "discarded", batchId: number): void;
}>();

const { t } = useI18n();

const batch = ref<OutboundEmailBatchView | null>(null);
const drafts = ref<OutboundEmailDraftView[]>([]);
const loaded = ref<boolean>(false);
const busy = ref<boolean>(false);
const editingDraftId = ref<number | null>(null);
const currentBatchHash = ref<string>("");
const authorizationToken = ref<string | null>(null);
const authorizationId = ref<number | null>(null);
const approvalInvalidated = ref<boolean>(false);
const preflightError = ref<string>("");
const sendError = ref<string>("");
const sendSuccess = ref<boolean>(false);
const attemptStatus = ref<string | null>(null);
const progressOutcomes = ref<OutboundEmailOutcomeView[]>([]);

let progressListener: ((event: unknown) => void) | null = null;

const modeLabel = computed<string>(() => {
  // The batch status drives the mode display; the resolver mode is surfaced
  // via the batch card, not here.
  return batch.value?.status ?? "";
});

/** Send is enabled only after a successful approval (token present) and no
 *  blocking preflight error, and not currently busy. */
const canSend = computed<boolean>(() => {
  return !!authorizationToken.value && !preflightError.value && !sendSuccess.value;
});

onMounted(async () => {
  await loadBatch();
  progressListener = subscribeOutboundEmailProgress(onWorkerEvent);
});

onUnmounted(() => {
  if (progressListener) {
    removeOutboundEmailProgressListener(progressListener);
    progressListener = null;
  }
  // Never persist the raw token; clear it on teardown.
  authorizationToken.value = null;
});

async function loadBatch(): Promise<void> {
  try {
    const result = await getOutboundEmailBatch(props.batchId);
    batch.value = result.batch;
    drafts.value = result.drafts;
    currentBatchHash.value = result.batch.batchHash ?? "";
    loaded.value = true;
    await refreshStatus();
  } catch (e) {
    sendError.value = e instanceof Error ? e.message : String(e);
    loaded.value = true;
  }
}

async function refreshStatus(): Promise<void> {
  try {
    const status = await getOutboundEmailBatchStatus(props.batchId);
    attemptStatus.value = status.attempt?.status ?? null;
    progressOutcomes.value = status.outcomes;
    if (batch.value && status.batchStatus) {
      batch.value = { ...batch.value, status: status.batchStatus };
    }
  } catch {
    // Status refresh is best-effort; the worker events update outcomes live.
  }
}

function startEdit(draftId: number): void {
  editingDraftId.value = draftId;
}

function cancelEdit(): void {
  editingDraftId.value = null;
}

async function onDraftSave(
  draftId: number,
  draft: OutboundEmailDraftView,
  payload: { subject: string; bodyText: string }
): Promise<void> {
  busy.value = true;
  preflightError.value = "";
  try {
    const result = await updateOutboundEmailDraft({
      draftId,
      emailServiceId: draft.emailServiceId ?? 0,
      senderAddress: draft.senderAddress ?? "",
      subject: payload.subject,
      bodyText: payload.bodyText,
      bodyHtml: draft.bodyHtml,
    });
    currentBatchHash.value = result.batchHash;
    // Editing invalidates prior approval (§13.3); force re-approval.
    authorizationToken.value = null;
    authorizationId.value = null;
    approvalInvalidated.value = true;
    editingDraftId.value = null;
    // Refresh drafts so the new revision number + content shows.
    await loadBatch();
  } catch (e) {
    preflightError.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function onApprove(): Promise<void> {
  busy.value = true;
  preflightError.value = "";
  try {
    const approval = await approveOutboundEmailBatch(
      props.batchId,
      currentBatchHash.value
    );
    authorizationId.value = approval.authorizationId;
    // Hold the raw token in memory only; never persist or log it.
    authorizationToken.value = approval.token;
    currentBatchHash.value = approval.batchHash;
    approvalInvalidated.value = false;
  } catch (e) {
    preflightError.value = e instanceof Error ? e.message : String(e);
    authorizationToken.value = null;
  } finally {
    busy.value = false;
  }
}

async function onSend(): Promise<void> {
  busy.value = true;
  sendError.value = "";
  if (!authorizationId.value || !authorizationToken.value) {
    sendError.value = t("outboundEmail.no_approval") || "Approve before sending.";
    busy.value = false;
    return;
  }
  try {
    const result = await sendOutboundEmailBatch(
      props.batchId,
      authorizationId.value,
      currentBatchHash.value
    );
    if (result.status === "worker_start_failed") {
      sendError.value = t("outboundEmail.send_failed") || "Batch send failed.";
    } else {
      sendSuccess.value = true;
      emit("sent", props.batchId, result.attemptId);
      emit("update:modelValue", false);
      await refreshStatus();
    }
  } catch (e) {
    sendError.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function onDiscard(): Promise<void> {
  busy.value = true;
  try {
    await discardOutboundEmailBatch(props.batchId);
    emit("discarded", props.batchId);
    emit("update:modelValue", false);
  } catch (e) {
    sendError.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

function onWorkerEvent(event: AuthorizedEmailWorkerEvent): void {
  if (!("batchId" in event) || event.batchId !== props.batchId) return;
  if (event.type === "authorized-email-submitted" || event.type === "authorized-email-failed") {
    refreshStatus();
  } else if (event.type === "authorized-email-worker-complete") {
    refreshStatus();
  }
}

function onRetry(): void {
  // Retry for a failed recipient routes through a fresh review→approve→send
  // cycle, not a one-click auto-send (§18). For now this is a no-op stub;
  // Phase 5 recovery wiring will surface it as a new batch.
}
</script>

<style scoped>
.outbound-review__header {
  display: flex;
  align-items: center;
}
.outbound-review__actions {
  padding: 12px 16px;
}
</style>
