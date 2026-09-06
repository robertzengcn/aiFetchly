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
                size: formatBytes(cacheStatus?.approximateBytes ?? 0),
              })
            }}
          </p>
          <p class="text-body-2 mb-0">
            {{ t("managedBrowser.settings.clear_confirm_preserved") }}
          </p>
        </v-card-text>
        <v-card-actions>
          <v-btn
            data-testid="mb-btn-clear-confirm-ok"
            color="warning"
            :disabled="clearInProgress"
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
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  clearCache,
  getCacheStatus,
  listActiveSessions,
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
let pendingConfirmationId: string | null = null;
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
    cacheStatus.value = cache;
  } catch (error) {
    console.error("[ManagedBrowserSettingsPanel] load failed:", error);
  } finally {
    loading.value = false;
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
    const sessions = await listActiveSessions();
    for (const session of sessions) {
      await stopManagedBrowser(
        session.sessionId,
        decision === "finish" ? "user_stop" : "cancelled"
      ).catch(() => undefined);
    }
    await persist({ browserEnabled: false });
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
  try {
    await clearCache({
      scope: "all",
      activeSessionDecision: "skip_active",
      confirmationId,
    });
  } catch (error) {
    console.error("[ManagedBrowserSettingsPanel] clear failed:", error);
  } finally {
    pendingConfirmationId = null;
    clearInProgress.value = false;
    confirmDialog.value = false;
    await reload();
  }
}

onMounted(() => {
  void reload();
  unsubscribeProgress = onManagedBrowserCacheProgress(() => {
    // Coarse progress events; refresh the size when a pass completes.
  });
});

onBeforeUnmount(() => {
  unsubscribeProgress?.();
  unsubscribeProgress = null;
});
</script>
