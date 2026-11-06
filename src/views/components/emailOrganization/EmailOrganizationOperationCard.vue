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
          <!-- R4-16/AC-18: address-level recipient outcomes (Bcc stays private). -->
          <div
            v-for="outcome in item.recipientOutcomes"
            :key="`${item.itemId}-${outcome.address}`"
            class="text-caption text-medium-emphasis ml-4"
            data-testid="org-op-recipient"
          >
            {{ outcome.address }} ·
            {{ tOrRaw(`emailOrganization.recipient_outcome.${outcome.outcome}`, outcome.outcome) }}
          </div>
        </div>
      </div>
    </v-card-text>
    <v-dialog
      v-model="folderPickerVisible"
      max-width="420"
      data-testid="org-op-folder-picker"
    >
      <v-card>
        <v-card-text>
          <div class="text-subtitle-2 mb-2">
            {{ t("emailOrganization.pick_restore_folder") || "Choose a restore destination folder" }}
          </div>
          <v-select
            v-model="selectedFolderPath"
            :items="folderOptions.map((folder) => ({ title: folder.path, value: folder.path }))"
            density="compact"
            hide-details="auto"
          ></v-select>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn
            variant="text"
            @click="folderPickerVisible = false"
          >{{ t("emailOrganization.cancel_button") || "Cancel" }}</v-btn>
          <v-btn
            color="primary"
            :disabled="selectedFolderPath === null"
            :loading="restoring"
            data-testid="org-op-folder-confirm"
            @click="restoreToSelectedFolder"
          >{{ t("emailOrganization.restore_button") || "Restore" }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import {
  getEmailOrganizationOperation,
  restoreFromOperation,
  reconcileEmailOrganizationOperation,
  cancelEmailOrganizationOperation,
  listEmailOrganizationFolders,
} from "@/views/api/emailorganization";
import type { EmailOrganizationOperationDto } from "@/entityTypes/emailOrganizationTypes";
import type { EmailOrganizationFolderDto } from "@/entityTypes/emailOrganizationTypes";

const props = defineProps<{
  operationId: string | null;
}>();

const emit = defineEmits<{
  (event: "restored", operationId: string): void;
}>();

const { t, te } = useI18n();

const operation = ref<EmailOrganizationOperationDto | null>(null);
const errorMessage = ref<string | null>(null);
const restoring = ref(false);
const reconciling = ref(false);
const cancelling = ref(false);
// R12: reload the RESTORE operation after undo, not the stale trash one.
const displayOperationId = ref<string | null>(null);
// R12e: destination picker shown when a restore needs a replacement folder.
const folderPickerVisible = ref(false);
const folderOptions = ref<EmailOrganizationFolderDto[]>([]);
const selectedFolderPath = ref<string | null>(null);
// R12c: poll while the operation is open work so progress advances live.
let pollTimer: ReturnType<typeof setInterval> | null = null;

const activeOperationId = computed(() => displayOperationId.value ?? props.operationId);

const pollable = computed(() => {
  const status = operation.value?.status;
  return (
    status === "running" ||
    status === "prepared" ||
    status === "awaiting_approval" ||
    status === "authorized"
  );
});

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPolling(): void {
  stopPolling();
  if (pollable.value) {
    pollTimer = setInterval(() => void load(), 2000);
  }
}

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
  if (activeOperationId.value === null) return;
  cancelling.value = true;
  errorMessage.value = null;
  try {
    await cancelEmailOrganizationOperation(activeOperationId.value);
    await load();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    cancelling.value = false;
  }
}

/** T15: te() guard — a missing key falls back to a readable value, not the key. */
function tOrRaw(key: string, fallback: string): string {
  return te(key) ? t(key) : fallback;
}

function itemStatusText(status: string): string {
  return tOrRaw(`emailOrganization.item_status.${status}`, status);
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
  const codeSuffix =
    item.errorCode !== null
      ? ` · ${tOrRaw(`emailOrganization.error_code.${item.errorCode}`, item.errorCode)}`
      : "";
  // R14: an intended destination is not a completed move — only completed
  // items say 'moved to'; pending/failed items report status + error.
  const completed = item.status === "succeeded" || item.status === "noop";
  if (completed && item.destinationFolderPath) {
    return `${t("emailOrganization.moved_to_prefix") || "Moved to"} ${item.destinationFolderPath}${codeSuffix}`;
  }
  return `${itemStatusText(item.status)}${codeSuffix}`;
}

async function load(): Promise<void> {
  const target = activeOperationId.value;
  if (target === null) {
    operation.value = null;
    stopPolling();
    return;
  }
  errorMessage.value = null;
  try {
    const result = await getEmailOrganizationOperation(target);
    operation.value = result.operation;
    startPolling();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

watch(() => props.operationId, () => {
  displayOperationId.value = null;
  void load();
});
watch(pollable, startPolling);
onMounted(load);
onUnmounted(stopPolling);

async function onUndo(): Promise<void> {
  if (activeOperationId.value === null) return;
  restoring.value = true;
  errorMessage.value = null;
  try {
    const result = await restoreFromOperation(activeOperationId.value);
    if (result.success) {
      emit("restored", result.operationId);
      // R12: switch the card to the RESTORE operation so the stale trash
      // outcome never re-arms Undo.
      displayOperationId.value = result.operationId;
      await load();
    } else if (result.errorCode === "DESTINATION_INVALID") {
      // AC-16: removed original folder — offer a replacement explicitly.
      // R4-15: LOCATION_STALE is NOT routed here — stale lineage needs a
      // refresh of the message, not a destination retry.
      await showFolderPicker();
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
  if (activeOperationId.value === null) return;
  reconciling.value = true;
  errorMessage.value = null;
  try {
    await reconcileEmailOrganizationOperation(activeOperationId.value);
    await load();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    reconciling.value = false;
  }
}

/** AC-16: pick a valid replacement destination and retry the restore. */
async function showFolderPicker(): Promise<void> {
  try {
    const emailServiceId = operation.value?.emailServiceId;
    if (emailServiceId === undefined || emailServiceId === null) {
      errorMessage.value = "Account unavailable; cannot list folders.";
      return;
    }
    const result = await listEmailOrganizationFolders(emailServiceId);
    // R4-15: offer only valid writable replacement destinations, excluding
    // Trash; reset any previous selection.
    folderOptions.value = result.folders.filter(
      (folder) => folder.specialUse !== "\\Trash" && folder.writable
    );
    selectedFolderPath.value = null;
    folderPickerVisible.value = true;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

async function restoreToSelectedFolder(): Promise<void> {
  const priorId = activeOperationId.value;
  const destination = selectedFolderPath.value;
  if (priorId === null || destination === null) return;
  restoring.value = true;
  errorMessage.value = null;
  try {
    const result = await restoreFromOperation(priorId, destination);
    if (result.success) {
      displayOperationId.value = result.operationId;
      folderPickerVisible.value = false;
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
</script>
