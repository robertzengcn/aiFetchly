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
    <!-- T25/T29: per-feature kill switches (PRD section 10). -->
    <v-switch
      v-model="signInEnabled"
      color="primary"
      hide-details
      density="compact"
      :label="t('managedBrowser.settings.sign_in_enabled')"
      :loading="loading"
      data-testid="mb-toggle-sign-in"
      @update:model-value="onToggleFeature('signInEnabled', $event)"
    />
    <v-switch
      v-model="siteUpsertEnabled"
      color="primary"
      hide-details
      density="compact"
      :label="t('managedBrowser.settings.site_upsert_enabled')"
      :loading="loading"
      data-testid="mb-toggle-site-upsert"
      @update:model-value="onToggleFeature('siteUpsertEnabled', $event)"
    />
    <v-switch
      v-model="proxySwitchEnabled"
      color="primary"
      hide-details
      density="compact"
      :label="t('managedBrowser.settings.proxy_switch_enabled')"
      :loading="loading"
      data-testid="mb-toggle-proxy-switch"
      @update:model-value="onToggleFeature('proxySwitchEnabled', $event)"
    />
    <v-switch
      v-model="parallelAgentsEnabled"
      color="primary"
      hide-details
      density="compact"
      :label="t('managedBrowser.settings.parallel_agents_enabled')"
      :loading="loading"
      data-testid="mb-toggle-parallel-agents"
      @update:model-value="onToggleFeature('parallelAgentsEnabled', $event)"
    />
    <v-switch
      v-model="browserDecisionEnabled"
      color="primary"
      hide-details
      density="compact"
      :label="t('managedBrowser.settings.browser_decision_enabled')"
      :loading="loading"
      data-testid="mb-toggle-browser-decision"
      @update:model-value="onToggleFeature('browserDecisionEnabled', $event)"
    />

    <!-- N09/design 5.3: the decision route. "Use my chat provider" is the
         default; a native profile is INERT until every field is configured
         and the user explicitly selects the native mode. -->
    <div
      v-if="browserDecisionEnabled"
      class="managed-browser-settings__decision-route mt-3"
      data-testid="mb-decision-route"
    >
      <p class="text-subtitle-2 mb-2">
        {{ t("managedBrowser.settings.decision_route_title") }}
      </p>
      <p class="text-caption text-grey-darken-1 mb-2">
        {{ t("managedBrowser.settings.decision_route_disclosure") }}
      </p>
      <div class="d-flex align-center ga-3 flex-wrap">
        <span class="text-body-2">
          {{ t("managedBrowser.settings.decision_route_mode") }}
        </span>
        <select
          v-model="decisionRouteMode"
          class="managed-browser-settings__account-select"
          data-testid="mb-decision-route-mode"
          :aria-label="t('managedBrowser.settings.decision_route_mode')"
          @change="onDecisionRouteChange"
        >
          <option value="follow_chat">
            {{ t("managedBrowser.settings.decision_route_follow_chat") }}
          </option>
          <option value="native_profile">
            {{ t("managedBrowser.settings.decision_route_native") }}
          </option>
        </select>
      </div>
      <div class="d-flex align-center ga-3 flex-wrap mt-2">
        <span class="text-body-2">
          {{ t("managedBrowser.settings.decision_route_model_override") }}
        </span>
        <input
          v-model="chatDecisionModel"
          type="text"
          class="managed-browser-settings__account-select"
          data-testid="mb-decision-route-model"
          :placeholder="t('managedBrowser.settings.decision_route_model_hint')"
          :aria-label="t('managedBrowser.settings.decision_route_model_override')"
          @change="onDecisionRouteChange"
        />
        <!-- R04/M-FR-12: the sub-agent model for batch lanes. -->
        <div class="d-flex align-center ga-3 flex-wrap mt-2">
          <span class="text-body-2">
            {{ t("managedBrowser.settings.batch_sub_agent_model") }}
          </span>
          <input
            v-model="batchSubAgentModel"
            type="text"
            class="managed-browser-settings__account-select"
            data-testid="mb-batch-sub-agent-model"
            :aria-label="t('managedBrowser.settings.batch_sub_agent_model')"
            @change="onDecisionRouteChange"
          />
        </div>
      </div>
      <template v-if="decisionRouteMode === 'native_profile'">
        <div class="d-flex align-center ga-3 flex-wrap mt-2">
          <span class="text-body-2">
            {{ t("managedBrowser.settings.native_profile_url") }}
          </span>
          <input
            v-model="nativeBaseUrl"
            type="text"
            class="managed-browser-settings__account-select"
            data-testid="mb-native-base-url"
            :aria-label="t('managedBrowser.settings.native_profile_url')"
            @change="onDecisionRouteChange"
          />
        </div>
        <div class="d-flex align-center ga-3 flex-wrap mt-2">
          <span class="text-body-2">
            {{ t("managedBrowser.settings.native_profile_model") }}
          </span>
          <input
            v-model="nativeModel"
            type="text"
            class="managed-browser-settings__account-select"
            data-testid="mb-native-model"
            :aria-label="t('managedBrowser.settings.native_profile_model')"
            @change="onDecisionRouteChange"
          />
        </div>
        <div class="d-flex align-center ga-3 flex-wrap mt-2">
          <span class="text-body-2">
            {{ t("managedBrowser.settings.native_profile_credential") }}
          </span>
          <select
            v-model="nativeApiKeyRef"
            class="managed-browser-settings__account-select"
            data-testid="mb-native-credential"
            :aria-label="t('managedBrowser.settings.native_profile_credential')"
            @change="onDecisionRouteChange"
          >
            <option value="none">
              {{ t("managedBrowser.settings.native_profile_cred_none") }}
            </option>
            <option value="chat">
              {{ t("managedBrowser.settings.native_profile_cred_chat") }}
            </option>
          </select>
        </div>
        <p
          v-if="decisionRouteIncomplete"
          class="text-caption text-warning mt-1"
          data-testid="mb-native-incomplete"
        >
          {{ t("managedBrowser.settings.native_profile_incomplete") }}
        </p>
      </template>
      <!-- R01/PRD §7: the connection test reports the three decision
           capabilities SEPARATELY — a passing chat test does not certify
           verified JSON Schema, and neither certifies native decisions. -->
      <div class="d-flex align-center ga-3 flex-wrap mt-3">
        <v-btn
          size="small"
          variant="outlined"
          data-testid="mb-decision-probe-btn"
          :loading="probeInFlight"
          @click="onProbeCapabilities"
        >
          {{ t("managedBrowser.settings.decision_probe_btn") || "Test decision capabilities" }}
        </v-btn>
        <span class="text-caption text-grey-darken-1">
          {{ t("managedBrowser.settings.decision_probe_hint") || "Probes chat, verified JSON Schema, and forced tool output separately." }}
        </span>
      </div>
      <ul
        v-if="probeResult !== null"
        class="text-caption mt-1"
        data-testid="mb-decision-probe-result"
      >
        <li>
          {{ t("managedBrowser.settings.decision_probe_chat") || "Chat" }}:
          {{ probeResult.chat ? t("managedBrowser.settings.decision_probe_ok") : t("managedBrowser.settings.decision_probe_fail") }}
        </li>
        <li>
          {{ t("managedBrowser.settings.decision_probe_structured") || "Verified JSON Schema" }}:
          {{ probeResult.structuredJsonSchema ? t("managedBrowser.settings.decision_probe_ok") : t("managedBrowser.settings.decision_probe_fail") }}
        </li>
        <li>
          {{ t("managedBrowser.settings.decision_probe_tool") || "Forced tool call" }}:
          {{ probeResult.forcedToolDecision ? t("managedBrowser.settings.decision_probe_ok") : t("managedBrowser.settings.decision_probe_fail") }}
        </li>
      </ul>
    </div>

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

    <!-- G06/PRD §7/M-FR-06: concurrent browsers (default 3, max 5). -->
    <div class="d-flex align-center ga-3 flex-wrap mt-2">
      <span class="text-body-2">
        {{ t("managedBrowser.settings.max_concurrent_label") }}
      </span>
      <input
        v-model.number="maxConcurrentSessions"
        type="number"
        class="managed-browser-settings__account-select"
        data-testid="mb-max-concurrent-input"
        :min="1"
        :max="5"
        :aria-label="t('managedBrowser.settings.max_concurrent_label')"
        @change="onMaxConcurrentChange"
      />
      <span class="text-caption text-grey-darken-1">1–5</span>
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
          <div
            v-if="stopFailed"
            class="text-caption text-error mt-2"
            data-testid="mb-stop-failed"
          >
            {{ t("managedBrowser.settings.stop_failed") }}
          </div>
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
  probeBrowserDecisionCapabilities,
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
// T25/T29: per-feature kill switches.
const signInEnabled = ref(true);
const siteUpsertEnabled = ref(true);
const proxySwitchEnabled = ref(true);
const parallelAgentsEnabled = ref(true);
const browserDecisionEnabled = ref(true);
// N09/design 5.3: the decision route (follow_chat default; inert native).
const decisionRouteMode = ref<"follow_chat" | "native_profile">("follow_chat");
// R01/PRD §7: the decision-capability probe (three separate verdicts).
const probeInFlight = ref(false);
const probeResult = ref<Awaited<
  ReturnType<typeof probeBrowserDecisionCapabilities>
> | null>(null);

async function onProbeCapabilities(): Promise<void> {
  probeInFlight.value = true;
  try {
    probeResult.value = await probeBrowserDecisionCapabilities();
  } catch (error) {
    console.error("[ManagedBrowserSettingsPanel] capability probe failed:", error);
    probeResult.value = null;
  } finally {
    probeInFlight.value = false;
  }
}
const chatDecisionModel = ref("");
// R04/M-FR-12: the sub-agent model for batch lanes.
const batchSubAgentModel = ref("");
const nativeBaseUrl = ref("");
const nativeModel = ref("");
const nativeApiKeyRef = ref<"none" | "chat">("none");
const maxConcurrentSessions = ref(3);
const decisionRouteIncomplete = computed(
  () =>
    decisionRouteMode.value === "native_profile" &&
    (!nativeBaseUrl.value.trim().startsWith("https://") ||
      nativeModel.value.trim().length === 0)
);
const clearCacheOnExit = ref(false);
const loading = ref(false);
const clearInProgress = ref(false);
const confirmDialog = ref(false);
const activeSessionDialog = ref(false);
const stoppingSessions = ref(false);
const stopFailed = ref(false);
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
  const raw = Number(cacheMaxMb.value);
  if (!Number.isFinite(raw)) {
    // Review fix: reject non-numeric input outright — restore the last
    // persisted value instead of persisting NaN.
    await reload();
    return;
  }
  const clamped = Math.min(2048, Math.max(100, Math.round(raw)));
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
    signInEnabled.value = effective.signInEnabled;
    siteUpsertEnabled.value = effective.siteUpsertEnabled;
    proxySwitchEnabled.value = effective.proxySwitchEnabled;
    parallelAgentsEnabled.value = effective.parallelAgentsEnabled;
    browserDecisionEnabled.value = effective.browserDecisionEnabled;
    // N09/design 5.3: load the decision route.
    decisionRouteMode.value = effective.decisionRoute.mode;
    chatDecisionModel.value = effective.decisionRoute.chatDecisionModel ?? "";
    batchSubAgentModel.value =
      effective.decisionRoute.batchSubAgentModel ?? "";
    nativeBaseUrl.value = effective.decisionRoute.nativeProfile?.baseUrl ?? "";
    nativeModel.value = effective.decisionRoute.nativeProfile?.model ?? "";
    nativeApiKeyRef.value =
      effective.decisionRoute.nativeProfile?.apiKeyRef ?? "none";
    cacheMaxMb.value = Math.round(effective.cacheMaxBytes / (1024 * 1024));
    // G06/M-FR-06: the session cap from effective settings.
    maxConcurrentSessions.value = effective.maxConcurrentSessions;
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
    // Review fix: a fresh confirmation never inherits a prior account's
    // stop-and-clear choice.
    accountClearDecision.value = "defer";
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
  maxConcurrentSessions?: number;
  decisionRoute?: {
    mode?: "follow_chat" | "native_profile";
    chatDecisionModel?: string | null;
    nativeProfile?: {
      displayName: string;
      baseUrl: string;
      model: string;
      apiKeyRef: "chat" | "none";
    } | null;
  };
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
  stopFailed.value = false;
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
      let anyStopFailed = false;
      for (const session of sessions) {
        await stopManagedBrowser(session.sessionId, "cancelled").catch(
          () => {
            anyStopFailed = true;
          }
        );
      }
      if (anyStopFailed) {
        // Review fix: a failed explicit Stop now keeps the setting ON and
        // tells the user, instead of silently disabling with live sessions.
        stopFailed.value = true;
        await reload();
        return;
      }
      await persist({ browserEnabled: false });
    }
  } finally {
    stoppingSessions.value = false;
    activeSessionDialog.value = false;
  }
}

  /** N09/design 5.3: persist the decision route (merged server-side). */
  function onDecisionRouteChange(): Promise<void> {
    const complete =
      nativeBaseUrl.value.trim().startsWith("https://") &&
      nativeModel.value.trim().length > 0;
    return persist({
      decisionRoute: {
        mode: decisionRouteMode.value,
        chatDecisionModel: chatDecisionModel.value.trim() || null,
        batchSubAgentModel: batchSubAgentModel.value.trim() || null,
        ...(decisionRouteMode.value === "native_profile" && complete
          ? {
              nativeProfile: {
                displayName: "Native",
                baseUrl: nativeBaseUrl.value.trim(),
                model: nativeModel.value.trim(),
                apiKeyRef: nativeApiKeyRef.value,
              },
            }
          : {}),
      },
    });
  }

  /** T25/T29: generic per-feature switch handler. */
  function onToggleFeature(
    feature: "signInEnabled" | "siteUpsertEnabled" | "proxySwitchEnabled" | "parallelAgentsEnabled" | "browserDecisionEnabled",
    value: boolean | null
  ): void {
    if (value !== null) {
      void persist({ [feature]: value } as Parameters<typeof persist>[0]);
    }
  }

function onToggleCache(value: boolean | null): void {
  if (value !== null) {
    void persist({ cacheEnabled: value });
  }
}

  /** G06/M-FR-06: persist the concurrent-browser cap (clamped 1..5). */
  function onMaxConcurrentChange(): void {
    const clamped = Math.max(
      1,
      Math.min(5, Math.floor(maxConcurrentSessions.value || 3))
    );
    maxConcurrentSessions.value = clamped;
    void persist({ maxConcurrentSessions: clamped });
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
    // Review fix: starting an ALL-scope confirmation invalidates any stale
    // account confirmation (it contaminated the dialog's size + choices).
    pendingAccountConfirmation = null;
    selectedScopeActive.value = false;
    accountClearDecision.value = "defer";
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
