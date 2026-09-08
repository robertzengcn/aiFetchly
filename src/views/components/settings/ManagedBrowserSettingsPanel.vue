<template>
  <section
    class="managed-browser-settings"
    data-testid="mb-settings-panel"
  >
    <h3 class="text-subtitle-1 font-weight-bold mb-1">
      {{ t("managedBrowser.settings.title") }}
    </h3>
    <p class="text-body-2 text-grey-darken-1 mb-3">
      {{ t("managedBrowser.settings.description") }}
    </p>

    <v-alert
      v-if="settings && !settings.browserEnabled"
      type="info"
      variant="tonal"
      density="compact"
      class="mb-3"
      data-testid="mb-settings-disabled-note"
    >
      {{
        t(
          `managedBrowser.settings.disabled_reasons.${
            settings.disabledReasonCode ?? "user_setting_disabled"
          }`
        ) || t("managedBrowser.settings.disabled_reasons.user_setting_disabled")
      }}
    </v-alert>

    <v-switch
      v-model="browserEnabled"
      color="primary"
      hide-details
      density="compact"
      :label="t('managedBrowser.settings.browser_enabled')"
      :loading="loading"
      data-testid="mb-toggle-browser"
      @update:model-value="onToggleBrowser"
    />
    <v-switch
      v-model="cacheEnabled"
      color="primary"
      hide-details
      density="compact"
      :label="t('managedBrowser.settings.cache_enabled')"
      :loading="loading"
      data-testid="mb-toggle-cache"
      @update:model-value="onToggleCache"
    />
    <v-switch
      v-model="clearCacheOnExit"
      color="primary"
      hide-details
      density="compact"
      :label="t('managedBrowser.settings.clear_cache_on_exit')"
      :loading="loading"
      data-testid="mb-toggle-clear-exit"
      @update:model-value="onToggleClearOnExit"
    />

    <div class="d-flex align-center ga-3 flex-wrap mt-2">
      <span class="text-body-2">
        {{ t("managedBrowser.settings.cache_max_label") }}
      </span>
      <input
        v-model.number="cacheMaxMb"
        type="number"
        class="managed-browser-settings__account-select"
        data-testid="mb-cache-max-input"
        :min="100"
        :max="2048"
        :aria-label="t('managedBrowser.settings.cache_max_label')"
        @change="onCacheMaxChange"
      />
      <span class="text-caption text-grey-darken-1">100–2048 MB</span>
    </div>

    <v-divider class="my-4" />

    <div class="d-flex align-center ga-3 flex-wrap">
      <span class="text-body-2" data-testid="mb-cache-size">
        {{
          t("managedBrowser.settings.cache_size", {
            size: formatBytes(cacheStatus?.approximateBytes ?? 0),
          })
        }}
      </span>
      <span
        v-if="cacheStatus?.lastClearedAt"
        class="text-caption text-grey-darken-1"
        data-testid="mb-cache-last-cleared"
      >
        {{
          t("managedBrowser.settings.last_cleared", {
            when: new Date(cacheStatus.lastClearedAt).toLocaleString(),
          })
        }}
      </span>
      <v-spacer />
      <v-btn
        size="small"
        variant="tonal"
        color="warning"
        data-testid="mb-btn-clear-all"
        :disabled="loading || clearInProgress"
        @click="onRequestClearAll"
      >
        {{ t("managedBrowser.settings.clear_all") }}
      </v-btn>
    </div>
    <p class="text-caption text-grey-darken-1 mt-2 mb-0">
      {{ t("managedBrowser.settings.clear_preserves_logins") }}
    </p>

    <div
      v-if="cacheProgressLine"
      class="text-caption mt-1"
      data-testid="mb-cache-progress"
    >
      {{ cacheProgressLine }}
    </div>

    <v-divider class="my-4" />

    <div class="d-flex align-center ga-3 flex-wrap">
      <select
        v-model="selectedAccountId"
        class="managed-browser-settings__account-select"
        data-testid="mb-clear-account-select"
        :aria-label="t('managedBrowser.settings.clear_account_label')"
      >
        <option
          v-for="account in accounts"
          :key="account.accountId"
          :value="account.accountId"
        >
          {{ account.accountLabel }}
        </option>
      </select>
      <v-spacer />
      <v-btn
        size="small"
        variant="tonal"
        data-testid="mb-btn-clear-account"
        :disabled="loading || selectedAccountId === null || clearInProgress"
        @click="onRequestClearSelected"
      >
        {{ t("managedBrowser.settings.clear_selected") }}
      </v-btn>
    </div>

    <v-dialog
      :model-value="activeSessionDialog"
      max-width="440"
      persistent
    >
      <v-card data-testid="mb-active-session-dialog">
        <v-card-title>
          {{ t("managedBrowser.settings.active_session_title") }}
        </v-card-title>
        <v-card-text>
          {{ t("managedBrowser.settings.active_session_body") }}
        </v-card-text>
        <v-card-actions>
          <v-btn
            data-testid="mb-active-finish"
            color="primary"
            :disabled="stoppingSessions"
            @click="onDisableDecision('finish')"
          >
            {{ t("managedBrowser.settings.active_finish") }}
          </v-btn>
          <v-btn
            data-testid="mb-active-stop"
            variant="text"
            :disabled="stoppingSessions"
            @click="onDisableDecision('stop')"
          >
            {{ t("managedBrowser.settings.active_stop_now") }}
          </v-btn>
          <v-spacer />
          <v-btn
            variant="text"
            data-testid="mb-active-cancel"
            :disabled="stoppingSessions"
            @click="onDisableDecision('cancel')"
          >
            {{ t("common.cancel") || "Cancel" }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="confirmDialog" max-width="440">
      <v-card data-testid="mb-clear-confirm-dialog">
        <v-card-title>
          {{ t("managedBrowser.settings.clear_confirm_title") }}
        </v-card-title>
        <v-card-text>
          <p class="text-body-2 mb-2">
            {{
              t("managedBrowser.settings.clear_confirm_body", {
                size: formatBytes(confirmScopeBytes),
              })
            }}
          </p>
          <p class="text-body-2 mb-0">
            {{ t("managedBrowser.settings.clear_confirm_preserved") }}
          </p>
          <div
            v-if="selectedScopeActive && pendingAccountIsSelected"
            class="mt-3 d-flex flex-column ga-2"
            data-testid="mb-clear-active-choice"
          >
            <v-btn
              size="small"
              variant="tonal"
              data-testid="mb-clear-choice-stop"
              :color="accountClearDecision === 'stop_and_clear' ? 'warning' : undefined"
              @click="accountClearDecision = 'stop_and_clear'"
            >
              {{ t("managedBrowser.settings.clear_choice_stop") }}
            </v-btn>
            <v-btn
              size="small"
              variant="tonal"
              data-testid="mb-clear-choice-defer"
              :color="accountClearDecision === 'defer' ? 'warning' : undefined"
              @click="accountClearDecision = 'defer'"
            >
              {{ t("managedBrowser.settings.clear_choice_defer") }}
            </v-btn>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-btn
            data-testid="mb-btn-clear-confirm-ok"
            color="warning"
            :disabled="clearInProgress || (selectedScopeActive && pendingAccountIsSelected && false)"
            :loading="clearInProgress"
            @click="onConfirmClear"
          >
            {{ t("managedBrowser.settings.clear_confirm_ok") }}
          </v-btn>
          <v-spacer />
          <v-btn variant="text" data-testid="mb-btn-clear-confirm-cancel" @click="confirmDialog = false">
            {{ t("common.cancel") || "Cancel" }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  clearCache,
  getCacheStatus,
  listActiveSessions,
  listEligibleAccounts,
  stopManagedBrowser,
  getEffectiveBrowserSettings,
  issueClearConfirmation,
  onManagedBrowserCacheProgress,
  updateBrowserPreferences,
} from "@/views/api/managedBrowser";
import type {
  EffectiveManagedBrowserSettings,
  SafeManagedBrowserCacheStatus,
} from "@/entityTypes/managedBrowserTypes";

/**
 * Managed-browser settings panel (design §22.3, FR-SETTING-001/002,
 * FR-CACHE-006). Two-step clear: request the confirmation, show size +
 * preserved-login copy, then clear with the single-use id.
 */

const { t } = useI18n();

const settings = ref<EffectiveManagedBrowserSettings | null>(null);
const cacheStatus = ref<SafeManagedBrowserCacheStatus | null>(null);
const browserEnabled = ref(true);
const cacheEnabled = ref(true);
const clearCacheOnExit = ref(false);
const loading = ref(false);
const clearInProgress = ref(false);
const confirmDialog = ref(false);
const activeSessionDialog = ref(false);
const stoppingSessions = ref(false);
const accounts = ref<
  Array<{ readonly accountId: number; readonly accountLabel: string }>
>([]);
const selectedAccountId = ref<number | null>(null);
const cacheProgressLine = ref<string | null>(null);
let pendingAccountConfirmation: { accountId: number; id: string } | null =
  null;
/** Size of the SELECTED account's scope (shown in its confirm dialog). */
const selectedAccountStatus = ref<SafeManagedBrowserCacheStatus | null>(null);
/** Whether the selected account's browser session is live. */
const selectedScopeActive = ref(false);
const pendingAccountIsSelected = computed(() => pendingAccountConfirmation !== null);
/** Bytes shown in the confirm dialog: the SELECTED account when clearing
 * one, the whole cache otherwise (TODO-MSB-005). */
const confirmScopeBytes = computed(() =>
  pendingAccountConfirmation
    ? (selectedAccountStatus.value?.approximateBytes ?? 0)
    : (cacheStatus.value?.approximateBytes ?? 0)
);
let pendingConfirmationId: string | null = null;
/** Active-scope choice for the SELECTED account clear (TODO-MSB-005). */
const accountClearDecision = ref<"stop_and_clear" | "defer">("defer");
/** Editable global cache maximum (MB, validated 100-2048). */
const cacheMaxMb = ref(500);

async function onCacheMaxChange(): Promise<void> {
  const clamped = Math.min(2048, Math.max(100, Math.round(cacheMaxMb.value)));
  if (!Number.isFinite(clamped) || clamped === cacheMaxMb.value - 0) {
    /* keep */
  }
  cacheMaxMb.value = clamped;
  await updateBrowserPreferences({ cacheMaxSizeMb: clamped }).catch(() =>
    undefined
  );
}
let unsubscribeProgress: (() => void) | null = null;

function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return "0 MB";
  }
  const mb = bytes / (1024 * 1024);
  if (mb < 1) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  if (mb < 1024) {
    return `${mb.toFixed(1)} MB`;
  }
  return `${(mb / 1024).toFixed(2)} GB`;
}

async function reload(): Promise<void> {
  loading.value = true;
  try {
    const [effective, cache] = await Promise.all([
      getEffectiveBrowserSettings(),
      getCacheStatus({ scope: "all" }),
    ]);
    settings.value = effective;
    browserEnabled.value = effective.browserEnabled;
    cacheEnabled.value = effective.cacheEnabled;
    clearCacheOnExit.value = effective.clearCacheOnExit;
    cacheMaxMb.value = Math.round(effective.cacheMaxBytes / (1024 * 1024));
    cacheStatus.value = cache;
    // GAP-10: eligible accounts for per-account clearing (ungated read).
    accounts.value = await listEligibleAccounts().catch(() => []);
    if (
      selectedAccountId.value === null ||
      !accounts.value.some((a) => a.accountId === selectedAccountId.value)
    ) {
      selectedAccountId.value =
        accounts.value.length > 0 ? accounts.value[0].accountId : null;
    }
  } catch (error) {
    console.error("[ManagedBrowserSettingsPanel] load failed:", error);
  } finally {
    loading.value = false;
  }
}

/** GAP-10: per-account clear — same two-step confirmation as all-scopes. */
async function onRequestClearSelected(): Promise<void> {
  const accountId = selectedAccountId.value;
  if (accountId === null) {
    return;
  }
  try {
    const issued = await issueClearConfirmation({
      scope: "account",
      accountId,
    });
    pendingAccountConfirmation = { accountId, id: issued.confirmationId };
    pendingConfirmationId = issued.confirmationId;
    // TODO-MSB-005: show THIS account's size in the confirmation, and offer
    // the active-scope choice when the account's browser is live.
    selectedAccountStatus.value = await getCacheStatus({
      scope: "account",
      accountId,
    }).catch(() => null);
    const live = await listActiveSessions().catch(() => []);
    selectedScopeActive.value = live.some(
      (session) => session.accountId === accountId
    );
    confirmDialog.value = true;
  } catch (error) {
    console.error(
      "[ManagedBrowserSettingsPanel] account confirmation failed:",
      error
    );
  }
}

async function persist(patch: {
  browserEnabled?: boolean;
  cacheEnabled?: boolean;
  clearCacheOnExit?: boolean;
}): Promise<void> {
  loading.value = true;
  try {
    const effective = await updateBrowserPreferences(patch);
    settings.value = effective;
  } catch (error) {
    console.error("[ManagedBrowserSettingsPanel] update failed:", error);
    // Revert the toggle to the persisted state.
    await reload();
  } finally {
    loading.value = false;
  }
}

function onToggleBrowser(value: boolean | null): void {
  if (value !== null) {
    if (value) {
      void persist({ browserEnabled: true });
      return;
    }
    // GAP-09 (FR-SETTING-004): disabling while a session is live requires
    // an explicit stop-or-finish decision — never a silent policy change.
    void maybeAskBeforeDisable();
  }
}

async function maybeAskBeforeDisable(): Promise<void> {
  try {
    const sessions = await listActiveSessions();
    if (sessions.length === 0) {
      await persist({ browserEnabled: false });
      return;
    }
    activeSessionDialog.value = true;
  } catch (error) {
    console.error(
      "[ManagedBrowserSettingsPanel] active-session check failed:",
      error
    );
    // Fail safe: do not disable when the state is unknown.
    await reload();
  }
}

async function onDisableDecision(
  decision: "finish" | "stop" | "cancel"
): Promise<void> {
  if (decision === "cancel") {
    activeSessionDialog.value = false;
    await reload(); // restore the persisted (still-enabled) toggle
    return;
  }
  stoppingSessions.value = true;
  try {
    if (decision === "finish") {
      // FR-SETTING-004: Finish KEEPS the running session alive — the
      // disable takes effect for NEW starts immediately (the settings
      // gate), and the session terminates naturally when the task ends.
      await persist({ browserEnabled: false });
    } else {
      // Stop now: explicit immediate cancellation.
      const sessions = await listActiveSessions();
      for (const session of sessions) {
        await stopManagedBrowser(session.sessionId, "cancelled").catch(
          () => undefined
        );
      }
      await persist({ browserEnabled: false });
    }
  } finally {
    stoppingSessions.value = false;
    activeSessionDialog.value = false;
  }
}

function onToggleCache(value: boolean | null): void {
  if (value !== null) {
    void persist({ cacheEnabled: value });
  }
}

function onToggleClearOnExit(value: boolean | null): void {
  if (value !== null) {
    void persist({ clearCacheOnExit: value });
  }
}

async function onRequestClearAll(): Promise<void> {
  try {
    // Refresh the size shown in the confirmation dialog first.
    cacheStatus.value = await getCacheStatus({ scope: "all" });
    const issued = await issueClearConfirmation({ scope: "all" });
    pendingConfirmationId = issued.confirmationId;
    confirmDialog.value = true;
  } catch (error) {
    console.error("[ManagedBrowserSettingsPanel] confirmation failed:", error);
  }
}

async function onConfirmClear(): Promise<void> {
  const confirmationId = pendingConfirmationId;
  if (!confirmationId) {
    confirmDialog.value = false;
    return;
  }
  clearInProgress.value = true;
  const accountPending = pendingAccountConfirmation;
  try {
    if (accountPending && accountPending.id === confirmationId) {
      await clearCache({
        scope: "account",
        accountId: accountPending.accountId,
        activeSessionDecision: selectedScopeActive.value
          ? accountClearDecision.value
          : "defer",
        confirmationId,
      });
    } else {
      await clearCache({
        scope: "all",
        activeSessionDecision: "skip_active",
        confirmationId,
      });
    }
  } catch (error) {
    console.error("[ManagedBrowserSettingsPanel] clear failed:", error);
  } finally {
    pendingConfirmationId = null;
    pendingAccountConfirmation = null;
    clearInProgress.value = false;
    confirmDialog.value = false;
    await reload();
  }
}

onMounted(() => {
  void reload();
  unsubscribeProgress = onManagedBrowserCacheProgress((progress) => {
    // GAP-10: render the coarse phase; refresh the size on completion.
    cacheProgressLine.value =
      t(`managedBrowser.settings.cache_phase_${progress.phase}`) ||
      progress.phase;
    if (progress.phase === "done" || progress.phase === "failed") {
      void getCacheStatus({ scope: "all" })
        .then((status) => {
          cacheStatus.value = status;
        })
        .catch(() => undefined);
    }
  });
});

onBeforeUnmount(() => {
  unsubscribeProgress?.();
  unsubscribeProgress = null;
});
</script>
