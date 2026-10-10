<template>
  <div
    v-if="visible"
    class="mb-start-panel"
    data-testid="mb-start-panel"
  >
    <div class="mb-start-panel__header">
      <v-icon size="small" aria-hidden="true">mdi-monitor</v-icon>
      <span class="mb-start-panel__title">{{
        t("managedBrowser.start.title")
      }}</span>
    </div>

    <div
      v-if="accounts.length === 0 && !loading"
      class="mb-start-panel__empty"
      data-testid="mb-start-empty"
    >
      {{ t("managedBrowser.start.empty") }}
    </div>

    <template v-else>
      <select
        v-model="selectedAccountId"
        class="mb-start-panel__select"
        data-testid="mb-start-account-select"
        :aria-label="t('managedBrowser.start.account_label')"
      >
        <option
          v-for="account in accounts"
          :key="account.accountId"
          :value="account.accountId"
        >
          {{ account.accountLabel }} — {{ platformLabel(account) }}
        </option>
      </select>

      <input
        v-model="purpose"
        type="text"
        class="mb-start-panel__purpose"
        data-testid="mb-start-purpose"
        maxlength="300"
        :placeholder="t('managedBrowser.start.purpose_placeholder')"
        :aria-label="t('managedBrowser.start.purpose_placeholder')"
      />

      <div class="mb-start-panel__controls">
        <v-btn
          size="small"
          color="primary"
          data-testid="mb-start-confirm"
          :disabled="!selectedAccountId || purpose.trim() === '' || busy"
          @click="confirmDialog = true"
        >
          {{ t("managedBrowser.start.start") }}
        </v-btn>
        <span v-if="error" class="mb-start-panel__error" data-testid="mb-start-error">
          {{ error }}
        </span>
      </div>
    </template>

    <v-dialog v-model="confirmDialog" max-width="420">
      <v-card data-testid="mb-start-dialog">
        <v-card-title>{{ t("managedBrowser.start.confirm_title") }}</v-card-title>
        <v-card-text>
          {{ t("managedBrowser.start.confirm_body", { account: selectedLabel }) }}
        </v-card-text>
        <v-card-actions>
          <v-btn
            data-testid="mb-start-dialog-ok"
            color="primary"
            :disabled="busy"
            @click="onStart"
          >
            {{ t("managedBrowser.start.start") }}
          </v-btn>
          <v-spacer />
          <v-btn variant="text" data-testid="mb-start-dialog-cancel" @click="confirmDialog = false">
            {{ t("common.cancel") || "Cancel" }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  listActiveSessions,
  listEligibleAccounts,
  onManagedBrowserStatusChanged,
  startManagedBrowser,
  type EligibleManagedBrowserAccount,
} from "@/views/api/managedBrowser";

/**
 * Managed-browser start flow (design §22.2, GAP-07): pick a saved Tool
 * Account by its safe label, state a purpose, confirm, start. Renders only
 * when NO session is active (the session card owns the active state).
 */

const { t } = useI18n();

const visible = ref(true);
const accounts = ref<EligibleManagedBrowserAccount[]>([]);
const selectedAccountId = ref<number | null>(null);
const purpose = ref("");
const loading = ref(true);
const busy = ref(false);
const error = ref<string | null>(null);
const confirmDialog = ref(false);
let unsubscribeStatus: (() => void) | null = null;

const selectedLabel = computed(
  () =>
    accounts.value.find((a) => a.accountId === selectedAccountId.value)
      ?.accountLabel ?? ""
);

function platformLabel(account: EligibleManagedBrowserAccount): string {
  // Pilot platforms share one label surface; keep it generic and safe.
  return t("managedBrowser.platform_fallback");
}

async function reloadAccounts(): Promise<void> {
  loading.value = true;
  try {
    accounts.value = await listEligibleAccounts();
    if (
      selectedAccountId.value === null ||
      !accounts.value.some((a) => a.accountId === selectedAccountId.value)
    ) {
      selectedAccountId.value =
        accounts.value.length > 0 ? accounts.value[0].accountId : null;
    }
  } catch {
    accounts.value = [];
  } finally {
    loading.value = false;
  }
}

async function onStart(): Promise<void> {
  const accountId = selectedAccountId.value;
  if (accountId === null || purpose.value.trim() === "") {
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await startManagedBrowser({
      accountId,
      purpose: purpose.value.trim(),
    });
    confirmDialog.value = false;
  } catch (err) {
    // Safe reason codes only (the API layer throws them).
    error.value = err instanceof Error ? err.message : "internal_error";
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void reloadAccounts();
  unsubscribeStatus = onManagedBrowserStatusChanged(() => {
    void refreshVisibility();
  });
  void refreshVisibility();
});

async function refreshVisibility(): Promise<void> {
  try {
    const sessions = await listActiveSessions();
    visible.value = sessions.length === 0;
  } catch {
    visible.value = false;
  }
}

onBeforeUnmount(() => {
  unsubscribeStatus?.();
  unsubscribeStatus = null;
});
</script>

<style scoped>
.mb-start-panel {
  border: 1px dashed rgba(var(--v-border-opacity, 0.12));
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mb-start-panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 0.9rem;
}

.mb-start-panel__empty {
  font-size: 0.85rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.mb-start-panel__select,
.mb-start-panel__purpose {
  border: 1px solid rgba(var(--v-border-opacity, 0.2));
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 0.85rem;
  background: transparent;
  color: inherit;
  max-width: 100%;
}

.mb-start-panel__controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mb-start-panel__error {
  font-size: 0.8rem;
  color: #c62828;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
