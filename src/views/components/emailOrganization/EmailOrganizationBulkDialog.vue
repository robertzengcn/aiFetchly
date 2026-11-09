<template>
  <v-dialog
    :model-value="modelValue"
    max-width="860"
    scrollable
    @update:model-value="(value: boolean) => emit('update:modelValue', value)"
  >
    <v-card data-testid="email-org-bulk-dialog">
      <v-card-title class="d-flex align-center">
        {{ t("emailOrganization.bulk_title") || "Bulk trash" }}
        <v-spacer></v-spacer>
        <v-btn icon variant="text" size="small" :aria-label="t('common.close') || 'Close'" @click="emit('update:modelValue', false)">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>
      <v-divider></v-divider>
      <v-card-text style="max-height: 60vh">
        <v-alert
          v-if="!capabilitiesReady"
          type="info"
          variant="tonal"
          density="compact"
          class="mb-3"
          data-testid="email-org-bulk-no-capability"
        >
          {{ t("emailOrganization.bulk_unavailable") || "This account cannot move messages to Trash." }}
        </v-alert>

        <!-- Step 1: search -->
        <div class="mb-3">
          <div class="d-flex flex-wrap align-center">
            <v-text-field
              v-model="subjectFilter"
              :label="t('emailOrganization.bulk_subject') || 'Subject'"
              density="compact"
              hide-details
              class="mr-2"
              style="max-width: 220px"
              data-testid="email-org-bulk-subject"
            ></v-text-field>
            <v-text-field
              v-model="fromFilter"
              :label="t('emailOrganization.bulk_from') || 'From'"
              density="compact"
              hide-details
              class="mr-2"
              style="max-width: 220px"
              data-testid="email-org-bulk-from"
            ></v-text-field>
            <v-btn
              color="primary"
              variant="tonal"
              data-testid="email-org-bulk-search"
              :loading="searching"
              :disabled="!capabilitiesReady"
              @click="runSearch"
            >
              {{ t("emailOrganization.bulk_search") || "Search" }}
            </v-btn>
          </div>
        </div>

        <v-alert
          v-if="searchError"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-3"
          data-testid="email-org-bulk-search-error"
        >
          {{ searchError }}
        </v-alert>

        <!-- Step 2: results + selection -->
        <div v-if="searchRows.length > 0" class="mb-3">
          <div class="d-flex align-center mb-2">
            <span class="text-body-2">
              {{ t("emailOrganization.bulk_result_line", { count: searchRows.length, total: searchTotal }) || `${selectedIds.size} of ${searchRows.length} selected` }}
            </span>
            <v-spacer></v-spacer>
            <v-btn
              size="small"
              variant="text"
              data-testid="email-org-bulk-clear"
              @click="selectedIds.clear()"
            >
              {{ t("emailOrganization.bulk_clear_selection") || "Clear selection" }}
            </v-btn>
          </div>
          <v-table density="compact">
            <thead>
              <tr>
                <th style="width: 40px"></th>
                <th>{{ t("emailOrganization.bulk_col_subject") || "Subject" }}</th>
                <th>{{ t("emailOrganization.bulk_col_folder") || "Folder" }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in searchRows" :key="`${row.folderPath}/${row.providerUid}`">
                <td>
                  <v-checkbox
                    density="compact"
                    hide-details
                    :model-value="selectedIds.has(rowKey(row))"
                    :aria-label="row.subject"
                    @update:model-value="(value: boolean | null) => toggleRow(row, value === true)"
                  ></v-checkbox>
                </td>
                <td class="text-body-2">{{ row.subject || "—" }}</td>
                <td class="text-caption">{{ row.folderPath ?? "—" }}</td>
              </tr>
            </tbody>
          </v-table>
          <div class="d-flex align-center mt-2">
            <span v-if="searchIncomplete" class="text-caption text-warning mr-2">
              {{ t("emailOrganization.bulk_incomplete") || "Results are incomplete; page again before freezing." }}
            </span>
            <v-spacer></v-spacer>
            <v-btn
              color="primary"
              variant="tonal"
              data-testid="email-org-bulk-freeze"
              :loading="preparing"
              :disabled="selectedIds.size === 0 || selectedIds.size > 100"
              @click="freezeSelection"
            >
              {{ t("emailOrganization.bulk_freeze") || "Freeze selection" }}
            </v-btn>
          </div>
        </div>

        <!-- Step 3: frozen preview + execute -->
        <v-card v-if="frozenPreview" variant="tonal" class="pa-3" data-testid="email-org-bulk-preview">
          <div class="text-subtitle-2 mb-1">
            {{ t("emailOrganization.bulk_preview_title") || "Frozen selection" }}
          </div>
          <div class="text-body-2 mb-1">
            {{ t("emailOrganization.bulk_preview_line", {
              count: frozenPreview.count,
              destination: trashFolderName,
              minutes: previewMinutes
            }) || `${frozenPreview.count} messages will move to ${trashFolderName}. Expires in ${previewMinutes} min.` }}
          </div>
          <div class="text-caption mb-2">
            {{ t("emailOrganization.bulk_preview_expires", { at: formatTime(frozenPreview.expiresAt) }) || `Expires at ${formatTime(frozenPreview.expiresAt)}` }}
          </div>
          <div class="d-flex align-center">
            <v-btn
              color="error"
              variant="flat"
              data-testid="email-org-bulk-execute"
              :loading="executing"
              :disabled="expired || executing"
              @click="executeBulk"
            >
              {{ t("emailOrganization.bulk_execute") || "Move to Trash" }}
            </v-btn>
            <v-btn
              v-if="runningOperationId !== null"
              class="ml-2"
              variant="outlined"
              data-testid="email-org-bulk-cancel"
              @click="cancelBulk"
            >
              {{ t("emailOrganization.cancel_button") || "Cancel" }}
            </v-btn>
            <v-spacer></v-spacer>
            <span v-if="runningOperationId !== null" class="text-caption" data-testid="email-org-bulk-progress">
              {{ t("emailOrganization.bulk_progress", { done: progressDone, total: progressTotal }) || `${progressDone}/${progressTotal}` }}
            </span>
          </div>
        </v-card>

        <EmailOrganizationOperationCard
          v-if="runningOperationId !== null"
          :operation-id="runningOperationId"
          class="mt-3"
          @done="onOperationDone"
        ></EmailOrganizationOperationCard>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import {
  getEmailOrganizationCapabilities,
  getEmailOrganizationOperation,
  searchEmailsOrganization,
  prepareEmailSelection,
  startTrashSelection,
  cancelEmailOrganizationOperation,
} from "@/views/api/emailorganization";
import type { OrganizationSearchResultDto, SelectionPreviewDto } from "@/views/api/emailorganization";
import EmailOrganizationOperationCard from "@/views/components/emailOrganization/EmailOrganizationOperationCard.vue";

/**
 * R5-08 (PRD §7/FR-18/FR-19): the search → frozen preview → execute/cancel
 * bulk journey. A search result alone never moves mail — the frozen,
 * expiring selection is what execution consumes; the preview shows the
 * exact count, destination and expiry before anything moves.
 */
const props = defineProps<{
  modelValue: boolean;
  emailServiceId: number | null;
  locale?: string;
}>();
const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "executed", operationId: string): void;
}>();

const { t } = useI18n();
const capabilitiesReady = ref(false);
const trashFolderName = ref<string>("");
const subjectFilter = ref("");
const fromFilter = ref("");
const searching = ref(false);
const searchError = ref<string | null>(null);
const searchRows = ref<OrganizationSearchResultDto["rows"]>([]);
const searchTotal = ref(0);
const searchIncomplete = ref(false);
const selectedIds = ref(new Set<string>());
const preparing = ref(false);
const frozenPreview = ref<SelectionPreviewDto | null>(null);
const frozenSelectionId = ref<string | null>(null);
const executing = ref(false);
const runningOperationId = ref<string | null>(null);
const progressDone = ref(0);
const progressTotal = ref(0);
const expired = ref(false);

let pollTimer: ReturnType<typeof setInterval> | null = null;
let expiryTimer: ReturnType<typeof setInterval> | null = null;

const previewMinutes = computed(() => {
  if (!frozenPreview.value) return 0;
  return Math.max(0, Math.round((new Date(frozenPreview.value.expiresAt).getTime() - Date.now()) / 60000));
});

function rowKey(row: OrganizationSearchResultDto["rows"][number]): string {
  return `${row.folderPath ?? ""}/${row.providerUid ?? ""}`;
}

function toggleRow(row: OrganizationSearchResultDto["rows"][number], value: boolean): void {
  const key = rowKey(row);
  if (value) {
    selectedIds.value.add(key);
  } else {
    selectedIds.value.delete(key);
  }
  selectedIds.value = new Set(selectedIds.value);
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

async function loadCapabilities(): Promise<void> {
  capabilitiesReady.value = false;
  if (props.emailServiceId === null) return;
  try {
    const capabilities = await getEmailOrganizationCapabilities(props.emailServiceId);
    capabilitiesReady.value = capabilities.canMoveToTrash && capabilities.trashFolderPath !== null;
    trashFolderName.value = capabilities.trashFolderPath ?? "";
  } catch (error) {
    console.error("Bulk capability load failed:", error);
    capabilitiesReady.value = false;
  }
}

async function runSearch(): Promise<void> {
  if (props.emailServiceId === null) return;
  searching.value = true;
  searchError.value = null;
  searchRows.value = [];
  selectedIds.value = new Set();
  frozenPreview.value = null;
  frozenSelectionId.value = null;
  try {
    const result = await searchEmailsOrganization({
      emailServiceId: props.emailServiceId,
      source: "local",
      subject: subjectFilter.value.trim() !== "" ? subjectFilter.value.trim() : undefined,
      fromAddress: fromFilter.value.trim() !== "" ? fromFilter.value.trim() : undefined,
      pageSize: 100,
    });
    searchRows.value = result.rows;
    searchTotal.value = result.totalMatched;
    searchIncomplete.value = !result.complete;
  } catch (error) {
    searchError.value = error instanceof Error ? error.message : String(error);
  } finally {
    searching.value = false;
  }
}

async function freezeSelection(): Promise<void> {
  if (props.emailServiceId === null || searchRows.value.length === 0) return;
  preparing.value = true;
  try {
    const selectedRows = searchRows.value.filter((row) => selectedIds.value.has(rowKey(row)));
    const messageIds = selectedRows
      .map((row) => row.messageId)
      .filter((id): id is number => typeof id === "number");
    const preview = await prepareEmailSelection({
      emailServiceId: props.emailServiceId,
      kind: "trash",
      messageIds,
    });
    frozenPreview.value = preview;
    frozenSelectionId.value = preview.selectionId;
    progressTotal.value = preview.count;
    progressDone.value = 0;
    expired.value = false;
    expiryTimer = setInterval(() => {
      if (frozenPreview.value !== null) {
        expired.value = new Date(frozenPreview.value.expiresAt).getTime() <= Date.now();
      }
    }, 5000);
  } catch (error) {
    searchError.value = error instanceof Error ? error.message : String(error);
  } finally {
    preparing.value = false;
  }
}

async function executeBulk(): Promise<void> {
  if (frozenSelectionId.value === null || expired.value) return;
  executing.value = true;
  try {
    const result = await startTrashSelection(frozenSelectionId.value);
    if ("operationId" in result && result.operationId) {
      runningOperationId.value = result.operationId;
      emit("executed", result.operationId);
      pollTimer = setInterval(() => {
        void pollProgress();
      }, 2000);
    }
  } finally {
    executing.value = false;
  }
}

async function pollProgress(): Promise<void> {
  if (runningOperationId.value === null) return;
  try {
    const { operation } = await getEmailOrganizationOperation(runningOperationId.value);
    if (operation !== null) {
      progressDone.value = operation.itemCounts.completed + operation.itemCounts.failed + operation.itemCounts.cancelled;
      progressTotal.value = Math.max(progressTotal.value, operation.itemCounts.completed + operation.itemCounts.failed + operation.itemCounts.cancelled + operation.itemCounts.pending + operation.itemCounts.unresolved);
    }
  } catch (error) {
    console.error("Bulk progress poll failed:", error);
  }
}

async function cancelBulk(): Promise<void> {
  if (runningOperationId.value === null) return;
  try {
    await cancelEmailOrganizationOperation(runningOperationId.value);
    await pollProgress();
  } catch (error) {
    console.error("Bulk cancel failed:", error);
  }
}

function onOperationDone(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  void pollProgress();
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      void loadCapabilities();
    }
  }
);

onBeforeUnmount(() => {
  if (pollTimer !== null) clearInterval(pollTimer);
  if (expiryTimer !== null) clearInterval(expiryTimer);
});
</script>
