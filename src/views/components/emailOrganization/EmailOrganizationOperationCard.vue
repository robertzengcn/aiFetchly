<template>
  <v-card variant="outlined" class="org-op-card" data-testid="email-org-operation-card">
    <v-card-text class="py-3">
      <div class="d-flex align-center mb-1">
        <v-icon size="small" class="mr-2" :icon="statusIcon" :color="statusColor"></v-icon>
        <span class="text-subtitle-2">
          {{ statusLabel }}
        </span>
        <v-spacer></v-spacer>
        <v-btn
          v-if="showUndo"
          size="small"
          variant="tonal"
          color="warning"
          data-testid="org-op-undo"
          :loading="restoring"
          :disabled="restoring"
          @click="onUndo"
        >
          <v-icon start size="small">mdi-undo</v-icon>
          {{ t("emailOrganization.undo_action") || "Undo" }}
        </v-btn>
        <v-btn
          v-if="showReconcile"
          size="small"
          variant="tonal"
          color="info"
          data-testid="org-op-reconcile"
          :loading="reconciling"
          @click="onReconcile"
        >
          {{ t("emailOrganization.check_status_action") || "Check status" }}
        </v-btn>
        <v-btn
          v-if="canCancel"
          size="small"
          variant="tonal"
          color="error"
          data-testid="org-op-cancel"
          :loading="cancelling"
          @click="onCancel"
        >
          {{ t("emailOrganization.cancel_button") || "Cancel" }}
        </v-btn>
      </div>

      <div v-if="operation" class="text-body-2 text-medium-emphasis">
        {{ countsSummary }}
      </div>

      <v-alert
        v-if="errorMessage"
        type="error"
        variant="tonal"
        density="compact"
        class="mt-2"
        role="alert"
      >{{ errorMessage }}</v-alert>

      <div v-if="operation && operation.items.length > 0" class="mt-2">
        <div
          v-for="item in operation.items"
          :key="item.itemId"
          class="text-body-2"
          data-testid="org-op-item"
        >
          <v-icon size="x-small" :icon="itemIcon(item.status)" class="mr-1"></v-icon>
          {{ itemSummary(item) }}
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import {
  getEmailOrganizationOperation,
  restoreFromOperation,
  reconcileEmailOrganizationOperation,
  cancelEmailOrganizationOperation,
} from "@/views/api/emailorganization";
import type { EmailOrganizationOperationDto } from "@/entityTypes/emailOrganizationTypes";

const props = defineProps<{
  operationId: string | null;
}>();

const emit = defineEmits<{
  (event: "restored", operationId: string): void;
}>();

const { t } = useI18n();

const operation = ref<EmailOrganizationOperationDto | null>(null);
const errorMessage = ref<string | null>(null);
const restoring = ref(false);
const reconciling = ref(false);
const cancelling = ref(false);

const showUndo = computed(
  () =>
    operation.value !== null &&
    operation.value.kind === "trash" &&
    (operation.value.status === "succeeded" || operation.value.status === "partially_succeeded")
);

const showReconcile = computed(
  () =>
    operation.value !== null &&
    (operation.value.status === "needs_reconciliation" || operation.value.status === "running")
);

const statusIcon = computed(() => {
  switch (operation.value?.status) {
    case "succeeded":
      return "mdi-check-circle";
    case "partially_succeeded":
      return "mdi-alert-circle-check";
    case "failed":
      return "mdi-close-circle";
    case "needs_reconciliation":
      return "mdi-help-circle";
    default:
      return "mdi-progress-clock";
  }
});

const statusColor = computed(() => {
  switch (operation.value?.status) {
    case "succeeded":
      return "success";
    case "partially_succeeded":
      return "warning";
    case "failed":
      return "error";
    default:
      return "info";
  }
});

const statusLabel = computed(() => {
  const kind = operation.value?.kind ?? "";
  const status = operation.value?.status ?? "";
  const key = `emailOrganization.op_${kind}_${status}`;
  return t(key) || `${kind} · ${status}`;
});

const countsSummary = computed(() => {
  const counts = operation.value?.itemCounts;
  if (!counts) return "";
  const parts: string[] = [];
  if (counts.completed > 0) {
    parts.push(t("emailOrganization.count_completed", { n: counts.completed }) || `${counts.completed} completed`);
  }
  if (counts.failed > 0) {
    parts.push(t("emailOrganization.count_failed", { n: counts.failed }) || `${counts.failed} failed`);
  }
  if (counts.unresolved > 0) {
    parts.push(t("emailOrganization.count_unresolved", { n: counts.unresolved }) || `${counts.unresolved} unresolved`);
  }
  if (counts.pending > 0) {
    parts.push(t("emailOrganization.count_pending", { n: counts.pending }) || `${counts.pending} pending`);
  }
  if (counts.cancelled > 0) {
    parts.push(t("emailOrganization.count_cancelled", { n: counts.cancelled }) || `${counts.cancelled} cancelled`);
  }
  return parts.join(" · ");
});

function itemIcon(status: string): string {
  switch (status) {
    case "succeeded":
    case "noop":
      return "mdi-check";
    case "failed":
      return "mdi-close";
    case "outcome_unknown":
      return "mdi-help";
    case "cancelled":
      return "mdi-cancel";
    default:
      return "mdi-progress-clock";
  }
}

const canCancel = computed(
  () =>
    operation.value !== null &&
    (operation.value.status === "running" ||
      operation.value.status === "prepared" ||
      operation.value.status === "awaiting_approval" ||
      operation.value.status === "authorized")
);

async function onCancel(): Promise<void> {
  if (props.operationId === null) return;
  cancelling.value = true;
  errorMessage.value = null;
  try {
    await cancelEmailOrganizationOperation(props.operationId);
    await load();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    cancelling.value = false;
  }
}

function itemSummary(item: EmailOrganizationOperationDto["items"][number]): string {
  const accepted = item.recipientOutcomes.filter((entry) => entry.outcome === "accepted").length;
  const rejected = item.recipientOutcomes.filter((entry) => entry.outcome === "rejected").length;
  const unknown = item.recipientOutcomes.filter((entry) => entry.outcome === "unknown").length;
  if (accepted + rejected + unknown > 0) {
    return (
      t("emailOrganization.recipient_breakdown", { accepted, rejected, unknown }) ||
      `Recipients: ${accepted} accepted, ${rejected} rejected, ${unknown} unknown`
    );
  }
  const codeSuffix = item.errorCode !== null ? ` · ${item.errorCode}` : "";
  // R14: an intended destination is not a completed move — only completed
  // items say 'moved to'; pending/failed items report status + error.
  const completed = item.status === "succeeded" || item.status === "noop";
  if (completed && item.destinationFolderPath) {
    return `${t("emailOrganization.moved_to_prefix") || "Moved to"} ${item.destinationFolderPath}${codeSuffix}`;
  }
  return `${item.status}${codeSuffix}`;
}

async function load(): Promise<void> {
  if (props.operationId === null) {
    operation.value = null;
    return;
  }
  errorMessage.value = null;
  try {
    const result = await getEmailOrganizationOperation(props.operationId);
    operation.value = result.operation;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

watch(() => props.operationId, load);
onMounted(load);

async function onUndo(): Promise<void> {
  if (props.operationId === null) return;
  restoring.value = true;
  errorMessage.value = null;
  try {
    const result = await restoreFromOperation(props.operationId);
    if (result.success) {
      emit("restored", result.operationId);
      await load();
    } else {
      errorMessage.value = result.errorCode ?? result.status;
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    restoring.value = false;
  }
}

async function onReconcile(): Promise<void> {
  if (props.operationId === null) return;
  reconciling.value = true;
  errorMessage.value = null;
  try {
    await reconcileEmailOrganizationOperation(props.operationId);
    await load();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    reconciling.value = false;
  }
}
</script>
