<template>
  <!--
    Root-level close-choice dialog + shutdown progress (PRD FR-01/FR-04/FR-08,
    design §9). Mounted once in App.vue, independent of the active page. The
    MAIN process owns lifecycle state; this component only renders choices and
    reports them by token. Escape/dismiss = cancel (window stays open).
  -->
  <div>
    <v-dialog
      v-model="dialogOpen"
      :persistent="true"
      max-width="520"
      content-testid="app-close-dialog"
      @keydown.esc="choose('cancel')"
    >
      <v-card
        v-if="dialogOpen"
        data-testid="app-close-dialog-card"
        aria-role="dialog"
        aria-modal="true"
        :aria-label="t('applicationLifecycle.closeTitle') || 'Close AiFetchly?'"
      >
        <v-card-title
          id="app-close-dialog-title"
          class="text-h6 d-flex align-center"
        >
          {{ t("applicationLifecycle.closeTitle") || "Close AiFetchly?" }}
        </v-card-title>
        <v-card-text>
          <p class="text-body-2 mb-2">
            {{ t("applicationLifecycle.closeDescription") || defaultDescription }}
          </p>
          <p
            v-if="activeTaskCount !== null"
            class="text-body-2 text-medium-emphasis"
            data-testid="app-close-dialog-task-count"
          >
            {{
              t("applicationLifecycle.activeTasks", activeTaskCount) ||
              `${activeTaskCount} tasks are running.`
            }}
          </p>
          <p
            v-if="!backgroundAvailable"
            class="text-body-2 text-warning"
            data-testid="app-close-dialog-tray-unavailable"
          >
            {{
              t("applicationLifecycle.trayUnavailable") ||
              "System tray is unavailable on this desktop."
            }}
          </p>
        </v-card-text>
        <v-card-actions class="px-4 pb-3">
          <v-btn
            v-if="backgroundAvailable"
            ref="keepRunningButton"
            data-testid="app-close-keep-running"
            variant="elevated"
            color="primary"
            :disabled="submitting"
            @click="choose('hide')"
          >
            {{ t("applicationLifecycle.keepRunning") || "Keep running in system tray" }}
          </v-btn>
          <v-btn
            ref="exitButton"
            data-testid="app-close-exit"
            variant="tonal"
            color="error"
            :disabled="submitting"
            @click="choose('exit')"
          >
            {{ t("applicationLifecycle.exitApplication") || "Exit application" }}
          </v-btn>
          <v-spacer />
          <v-btn
            data-testid="app-close-cancel"
            variant="text"
            :disabled="submitting"
            @click="choose('cancel')"
          >
            {{ t("applicationLifecycle.cancel") || "Cancel" }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Shutdown progress (FR-04): visible while the app is quitting. -->
    <v-overlay
      :model-value="isQuitting"
      class="align-center justify-center"
      scrim="rgba(0, 0, 0, 0.6)"
      persistent
      contained
      data-testid="app-exit-progress"
    >
      <v-card
        class="pa-6 d-flex flex-column align-center"
        min-width="320"
        role="status"
        aria-live="polite"
      >
        <v-progress-circular
          indeterminate
          size="40"
          class="mb-4"
          color="primary"
        />
        <div class="text-body-1" data-testid="app-exit-progress-title">
          {{ t("applicationLifecycle.exiting") || "Exiting AiFetchly…" }}
        </div>
        <!-- FR-04: the phase line follows the main process's broadcast
             phaseKey (stoppingTasks -> forceStop -> finalize). -->
        <div
          class="text-body-2 text-medium-emphasis mt-1"
          data-testid="app-exit-progress-phase"
        >
          {{
            t(`applicationLifecycle.${phaseKey}`) || "Stopping running tasks…"
          }}
        </div>
      </v-card>
    </v-overlay>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  acknowledgeCloseChoice,
  onCloseChoiceRequest,
  onLifecycleStateChanged,
  submitCloseChoice,
} from "@/views/api/applicationLifecycle";
import type { ApplicationCloseChoice } from "@/entityTypes/applicationLifecycleTypes";

/**
 * Single-use dialog token issued by the main process (design §10). Stale
 * tokens are rejected server-side; the component also guards locally.
 */
const liveToken = ref<string | null>(null);
const dialogOpen = ref(false);
const backgroundAvailable = ref(true);
const activeTaskCount = ref<number | null>(null);
const submitting = ref(false);
const isQuitting = ref(false);
/** i18n key suffix of the current shutdown phase (FR-04 progress text). */
const phaseKey = ref("stoppingTasks");

const { t } = useI18n();

const defaultDescription =
  "Exit stops running tasks. Keep running hides the window and lets tasks continue in the system tray.";

/** Element that had focus before the dialog opened (FR-08 restore). */
let previouslyFocused: HTMLElement | null = null;

/** Focus delay after opening (lets Vuetify mount the dialog content). */
const FOCUS_DELAY_MS = 50;
let focusTimer: ReturnType<typeof setTimeout> | null = null;

function clearFocusTimer(): void {
  if (focusTimer !== null) {
    clearTimeout(focusTimer);
    focusTimer = null;
  }
}

function handleRequest(payload: {
  token: string;
  backgroundAvailable: boolean;
  activeTaskCount?: number;
}): void {
  if (isQuitting.value) return; // late request while quitting — ignore
  if (dialogOpen.value) return; // never stack dialogs (AC-08)
  liveToken.value = payload.token;
  backgroundAvailable.value = payload.backgroundAvailable;
  activeTaskCount.value =
    typeof payload.activeTaskCount === "number" ? payload.activeTaskCount : null;
  dialogOpen.value = true;
  previouslyFocused = document.activeElement as HTMLElement | null;
  // Acknowledge so the main process cancels its native fallback (design §9).
  void acknowledgeCloseChoice(payload.token).catch(() => undefined);
  // Deliberate action required (FR-08): focus the primary button so keyboard
  // users land on the safest prominent action; Escape cancels via keydown.
  clearFocusTimer();
  focusTimer = setTimeout(() => {
    focusTimer = null;
    try {
      const card = document.querySelector(
        "[data-testid='app-close-keep-running'], [data-testid='app-close-exit']"
      );
      (card as HTMLElement | null)?.focus?.();
    } catch {
      /* focus is best-effort */
    }
  }, FOCUS_DELAY_MS);
}

async function choose(choice: ApplicationCloseChoice): Promise<void> {
  const token = liveToken.value;
  if (!token || submitting.value) return;
  submitting.value = true;
  try {
    await submitCloseChoice(token, choice);
  } catch {
    // IPC failure must not trap the user: fall back to local dismissal.
  } finally {
    submitting.value = false;
    dialogOpen.value = false;
    liveToken.value = null;
    clearFocusTimer();
    // Focus restoration after dismissal (FR-08).
    try {
      previouslyFocused?.focus?.();
    } catch {
      /* element may be gone */
    }
    previouslyFocused = null;
  }
}

function handleStateChanged(event: {
  state: string;
  phaseKey?: string;
}): void {
  if (event.state === "quitting" || event.state === "ready-to-exit") {
    isQuitting.value = true;
    if (typeof event.phaseKey === "string" && event.phaseKey !== "idle") {
      phaseKey.value = event.phaseKey;
    }
    // Any pending dialog is invalid once quitting begins (design §4).
    dialogOpen.value = false;
    liveToken.value = null;
    clearFocusTimer();
  } else {
    isQuitting.value = false;
  }
}

let unsubRequest: (() => void) | null = null;
let unsubState: (() => void) | null = null;

onMounted(() => {
  unsubRequest = onCloseChoiceRequest(handleRequest);
  unsubState = onLifecycleStateChanged(handleStateChanged);
});

onUnmounted(() => {
  unsubRequest?.();
  unsubState?.();
  clearFocusTimer();
});

defineExpose({
  // Test hooks (component tests only exercise internal state transitions).
  isDialogOpen: (): boolean => dialogOpen.value,
  choose,
});
</script>
