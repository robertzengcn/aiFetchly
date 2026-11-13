<template>
  <v-card variant="outlined" class="operation-history" data-testid="email-org-history">
    <div class="d-flex align-center pa-3">
      <v-icon size="small" class="mr-2">mdi-history</v-icon>
      <span class="text-subtitle-2">
        {{ t("emailOrganization.history_title") || "Organization history" }}
      </span>
      <v-spacer></v-spacer>
      <v-btn
        icon
        size="x-small"
        variant="text"
        data-testid="email-org-history-refresh"
        :loading="loading"
        :aria-label="t('emailReceive.retry') || 'Retry'"
        @click="loadHistory"
      >
        <v-icon size="small">mdi-refresh</v-icon>
      </v-btn>
    </div>

    <v-alert
      v-if="loadError"
      type="warning"
      variant="tonal"
      density="compact"
      class="mx-3 mb-3"
      data-testid="email-org-history-error"
    >
      {{ t("emailOrganization.history_load_failed") || "The operation history could not be loaded." }}
    </v-alert>

    <div v-else-if="!loading && operations.length === 0" class="pa-3 text-body-2 text-medium-emphasis">
      {{ t("emailOrganization.history_empty") || "No organization actions recorded for this message yet." }}
    </div>

    <v-list v-else density="compact" class="py-0">
      <v-list-item
        v-for="operation in operations"
        :key="operation.operationId"
        :data-testid="`email-org-history-item-${operation.kind}`"
      >
        <template #prepend>
          <v-icon size="small">
            {{ operation.kind === "forward" ? "mdi-forward" : operation.kind === "trash" ? "mdi-delete" : "mdi-undo" }}
          </v-icon>
        </template>
        <div class="d-flex align-center flex-wrap">
          <span class="mr-2 text-body-2">{{ kindLabel(operation.kind) }}</span>
          <v-chip size="x-small" :color="statusColor(operation.status)" variant="tonal">
            {{ statusLabel(operation.status) }}
          </v-chip>
          <span class="ml-2 text-caption text-medium-emphasis">
            {{ formatDate(operation.createdAt) }}
            · {{ t("emailOrganization.counts_line", { completed: operation.itemCounts.completed, failed: operation.itemCounts.failed, unresolved: operation.itemCounts.unresolved }) || `${operation.itemCounts.completed} ok / ${operation.itemCounts.failed} failed / ${operation.itemCounts.unresolved} unknown` }}
          </span>
        </div>
        <template #append>
          <v-btn
            v-if="operation.kind === 'trash' && operation.status === 'succeeded'"
            size="x-small"
            variant="tonal"
            color="warning"
            data-testid="email-org-history-restore"
            :loading="restoringId === operation.operationId"
            @click="restore(operation.operationId)"
          >
            <v-icon start size="x-small">mdi-undo</v-icon>
            {{ t("emailOrganization.undo_action") || "Undo" }}
          </v-btn>
        </template>
      </v-list-item>
    </v-list>
  </v-card>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  listEmailOrganizationOperations,
  restoreFromOperation,
} from "@/views/api/emailorganization";
import type { EmailOrganizationOperationDto } from "@/entityTypes/emailOrganizationTypes";

/**
 * R5-08: durable operation history for one message (design §12). The Undo
 * id survives navigation and restarts because it comes from the persisted
 * operation list, not from page state; succeeded Trash rows expose an
 * explicit restore entry point.
 */
const props = defineProps<{ messageId: number }>();
const emit = defineEmits<{ (e: "restored"): void; (e: "operation-active", operationId: string): void }>();

const { t, te } = useI18n();
const operations = ref<EmailOrganizationOperationDto[]>([]);
const loading = ref(false);
const loadError = ref(false);
const restoringId = ref<string | null>(null);

function tOrRaw(key: string, raw: string): string {
  return te(key) ? t(key) : raw;
}

function kindLabel(kind: string): string {
  return tOrRaw(`emailOrganization.op_kind.${kind}`, kind);
}

function statusLabel(status: string): string {
  return tOrRaw(`emailOrganization.op_status.${status}`, status);
}

function statusColor(status: string): string {
  switch (status) {
    case "succeeded":
    case "partially_succeeded":
      return "success";
    case "failed":
    case "cancelled":
      return "error";
    case "needs_reconciliation":
      return "warning";
    default:
      return "info";
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

async function loadHistory(): Promise<void> {
  loading.value = true;
  loadError.value = false;
  try {
    const result = await listEmailOrganizationOperations({
      messageId: props.messageId,
      limit: 20,
    });
    operations.value = result.operations;
  } catch (error) {
    console.error("Failed to load organization history:", error);
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

async function restore(operationId: string): Promise<void> {
  restoringId.value = operationId;
  try {
    const result = await restoreFromOperation(operationId);
    if (result.success) {
      emit("restored");
    } else {
      emit("operation-active", result.operationId);
    }
    await loadHistory();
  } catch (error) {
    console.error("History restore failed:", error);
    emit("operation-active", operationId);
  } finally {
    restoringId.value = null;
  }
}

onMounted(() => {
  void loadHistory();
});
watch(
  () => props.messageId,
  () => {
    void loadHistory();
  }
);
</script>
