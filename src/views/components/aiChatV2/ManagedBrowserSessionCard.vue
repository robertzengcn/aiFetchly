<template>
  <div v-if="status" class="mb-session-card" data-testid="mb-session-card">
    <div class="mb-session-card__header">
      <v-icon size="small" aria-hidden="true">mdi-monitor</v-icon>
      <span class="mb-session-card__account" data-testid="mb-session-account">
        {{ status.accountLabel }}
      </span>
      <span class="mb-session-card__platform">{{
        status.platformLabel || t("managedBrowser.platform_fallback")
      }}</span>
      <span
        class="mb-session-card__state"
        data-testid="mb-session-state"
        :class="`mb-session-card__state--${stateTone}`"
      >
        <v-icon size="x-small" aria-hidden="true">{{ stateIcon }}</v-icon>
        {{ t(`managedBrowser.states.${status.state}`) || status.state }}
      </span>
    </div>

    <div v-if="status.currentOrigin" class="mb-session-card__origin">
      <v-icon size="x-small" aria-hidden="true">mdi-web</v-icon>
      <span data-testid="mb-session-origin">{{ status.currentOrigin }}</span>
    </div>

    <div
      v-if="status.lastErrorCode"
      class="mb-session-card__error"
      data-testid="mb-session-error"
    >
      <v-icon size="x-small" aria-hidden="true">mdi-alert-circle-outline</v-icon>
      {{
        t(`managedBrowser.errors.${status.lastErrorCode}`) ||
        status.lastErrorCode
      }}
    </div>

    <div class="mb-session-card__controls">
      <template v-if="stateIsHandoffLike">
        <v-btn
          size="small"
          color="primary"
          data-testid="mb-btn-verify-login"
          :disabled="busy"
          @click="onVerifyLogin"
        >
          {{ t("managedBrowser.controls.verify_login") }}
        </v-btn>
        <v-btn
          size="small"
          variant="text"
          data-testid="mb-btn-resume"
          :disabled="busy"
          @click="onResume"
        >
          {{ t("managedBrowser.controls.resume") }}
        </v-btn>
        <v-btn
          size="small"
          variant="text"
          data-testid="mb-btn-extend"
          :disabled="busy"
          @click="onExtend"
        >
          {{ t("managedBrowser.controls.extend") }}
        </v-btn>
      </template>
      <template v-else>
        <v-btn
          size="small"
          variant="tonal"
          data-testid="mb-btn-takeover"
          :disabled="busy"
          @click="onTakeOver"
        >
          {{ t("managedBrowser.controls.take_over") }}
        </v-btn>
      </template>
      <v-spacer />
      <v-btn
        size="small"
        variant="text"
        color="error"
        data-testid="mb-btn-stop"
        :disabled="busy"
        @click="onStop"
      >
        {{ t("managedBrowser.controls.stop") }}
      </v-btn>
    </div>

    <ManagedBrowserHandoffDialog
      :model-value="handoffDialogOpen"
      :status="status"
      :busy="busy"
      @update:model-value="handoffDialogOpen = $event"
      @verify="onVerifyLogin"
      @extend="onExtend"
      @cancel="onCancelTask"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import ManagedBrowserHandoffDialog from "@/views/components/aiChatV2/ManagedBrowserHandoffDialog.vue";
import {
  extendHandoff,
  listActiveSessions,
  onManagedBrowserStatusChanged,
  requestHandoff,
  resumeAfterHandoff,
  stopManagedBrowser,
  verifyManualLogin,
} from "@/views/api/managedBrowser";
import { MANAGED_BROWSER_TIMEOUTS } from "@/config/managedBrowser";
import type { SafeManagedBrowserStatus } from "@/entityTypes/managedBrowserTypes";

/**
 * Managed-browser session card (design §22.2, FR-P0-009/013/016). Self-
 * contained: loads the active session (P0 global limit = 1), subscribes to
 * status events, and renders state + controls. No cookie values, paths, or
 * URLs beyond the current page origin ever appear on this card.
 */

const TERMINAL_STATES = new Set(["stopped", "failed"]);

const { t } = useI18n();

const status = ref<SafeManagedBrowserStatus | null>(null);
const busy = ref(false);
const handoffDialogOpen = ref(false);
let unsubscribeStatus: (() => void) | null = null;

const stateIsHandoffLike = computed(() => {
  const state = status.value?.state;
  return state === "handoff" || state === "user_login_in_progress";
});

const stateTone = computed<"ok" | "warn" | "busy" | "error">(() => {
  switch (status.value?.state) {
    case "ready":
    case "running":
      return "ok";
    case "handoff":
    case "user_login_in_progress":
    case "login_required":
    case "challenge_detected":
    case "awaiting_approval":
      return "warn";
    case "starting":
    case "validating_fingerprint":
    case "applying_session":
    case "verifying_login":
    case "verifying_manual_login":
    case "challenge_resolving":
    case "stopping":
      return "busy";
    default:
      return "error";
  }
});

const stateIcon = computed(() => {
  switch (stateTone.value) {
    case "ok":
      return "mdi-check-circle-outline";
    case "warn":
      return "mdi-hand-back-right";
    case "busy":
      return "mdi-progress-clock";
    default:
      return "mdi-close-circle-outline";
  }
});

function applyStatus(next: SafeManagedBrowserStatus | null): void {
  if (!next || TERMINAL_STATES.has(next.state)) {
    status.value = null;
    handoffDialogOpen.value = false;
    return;
  }
  status.value = next;
  // The handoff dialog auto-opens in handoff/login states (FR-P0-013).
  handoffDialogOpen.value = stateIsHandoffLike.value || handoffDialogOpen.value;
  if (!stateIsHandoffLike.value) {
    handoffDialogOpen.value = false;
  }
}

async function run(action: () => Promise<unknown>): Promise<void> {
  if (busy.value) {
    return;
  }
  busy.value = true;
  try {
    await action();
  } catch (error) {
    // Error codes only; the API layer throws the safe reason code.
    console.error("[ManagedBrowserSessionCard] action failed:", error);
  } finally {
    busy.value = false;
  }
}

function onTakeOver(): void {
  const current = status.value;
  if (!current) {
    return;
  }
  void run(async () => {
    applyStatus(await requestHandoff(current.sessionId));
  });
}

function onVerifyLogin(): void {
  const current = status.value;
  if (!current) {
    return;
  }
  void run(async () => {
    applyStatus(await verifyManualLogin(current.sessionId));
  });
}

function onResume(): void {
  const current = status.value;
  if (!current) {
    return;
  }
  void run(async () => {
    applyStatus(await resumeAfterHandoff(current.sessionId));
  });
}

function onExtend(): void {
  const current = status.value;
  if (!current) {
    return;
  }
  const extendMinutes = Math.max(
    1,
    Math.floor(MANAGED_BROWSER_TIMEOUTS.manualLoginHandoffMs / 60_000)
  );
  void run(async () => {
    applyStatus(await extendHandoff(current.sessionId, extendMinutes));
  });
}

function onStop(): void {
  const current = status.value;
  if (!current) {
    return;
  }
  void run(async () => {
    await stopManagedBrowser(current.sessionId, "user_stop");
    applyStatus(null);
  });
}

function onCancelTask(): void {
  const current = status.value;
  if (!current) {
    return;
  }
  handoffDialogOpen.value = false;
  void run(async () => {
    await stopManagedBrowser(current.sessionId, "cancelled");
    applyStatus(null);
  });
}

onMounted(() => {
  void listActiveSessions()
    .then((sessions) => {
      applyStatus(sessions.length > 0 ? sessions[0] : null);
    })
    .catch(() => undefined);
  unsubscribeStatus = onManagedBrowserStatusChanged((next) => {
    applyStatus(next);
  });
});

onBeforeUnmount(() => {
  unsubscribeStatus?.();
  unsubscribeStatus = null;
});
</script>

<style scoped>
.mb-session-card {
  border: 1px solid rgba(var(--v-border-opacity, 0.12));
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 100%;
}

.mb-session-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.mb-session-card__account {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 40%;
}

.mb-session-card__platform {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.85rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-session-card__state {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8rem;
  border-radius: 999px;
  padding: 2px 8px;
  border: 1px solid currentColor;
  white-space: nowrap;
}

/* Non-color indicators carry the tone; color is a supplement only. */
.mb-session-card__state--ok {
  color: #2e7d32;
}
.mb-session-card__state--warn {
  color: #9a6700;
}
.mb-session-card__state--busy {
  color: #546e7a;
}
.mb-session-card__state--error {
  color: #c62828;
}

.mb-session-card__origin {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
  overflow: hidden;
}

.mb-session-card__origin span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-session-card__error {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: #c62828;
}

.mb-session-card__controls {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
</style>
