<template>
  <v-dialog
    :model-value="modelValue"
    max-width="480"
    persistent
    @update:model-value="onDialogInput"
  >
    <v-card data-testid="mb-handoff-dialog">
      <v-card-title class="d-flex align-center ga-2">
        <v-icon size="small" aria-hidden="true">mdi-account-arrow-right</v-icon>
        <span>{{ t("managedBrowser.handoff.title") }}</span>
      </v-card-title>
      <v-card-text>
        <p class="text-body-2 mb-2">
          {{
            t("managedBrowser.handoff.account_line") ||
            "You now control the browser window for:"
          }}
          <strong>{{ accountLabel }}</strong>
        </p>
        <p class="text-body-2 mb-2">
          {{
            t("managedBrowser.handoff.reasons." + (reason || "user_requested")) ||
            reason
          }}
        </p>
        <p
          v-if="expiresAtEpochMs !== null"
          class="text-body-2 mb-2"
          data-testid="mb-handoff-countdown"
        >
          {{
            t("managedBrowser.handoff.time_remaining") ||
            "Time remaining for this login window:"
          }}
          <strong>{{ countdownLabel }}</strong>
        </p>
        <p class="text-caption text-grey-darken-1 mb-0">
          {{
            t("managedBrowser.handoff.saved_login_hint") ||
            "Log in in the opened browser window. Your saved login session is kept — only the cache is affected by clearing."
          }}
        </p>
      </v-card-text>
      <v-card-actions>
        <v-btn
          data-testid="mb-handoff-verify"
          color="primary"
          :disabled="busy"
          @click="emit('verify')"
        >
          {{
            t("managedBrowser.handoff.verify_login") ||
            "I've finished logging in"
          }}
        </v-btn>
        <v-btn
          data-testid="mb-handoff-extend"
          variant="text"
          :disabled="busy"
          @click="emit('extend')"
        >
          {{ t("managedBrowser.handoff.extend") || "Extend time (10 min)" }}
        </v-btn>
        <v-spacer />
        <v-btn
          data-testid="mb-handoff-cancel"
          variant="text"
          :disabled="busy"
          @click="emit('cancel')"
        >
          {{ t("managedBrowser.handoff.cancel_task") || "Cancel task" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { SafeManagedBrowserStatus } from "@/entityTypes/managedBrowserTypes";

/**
 * Manual-login / handoff dialog (design §13.2, FR-P0-013). Pure presentation:
 * the parent owns the session and the API calls; this component renders the
 * reason, the countdown to the handoff-window deadline, and the receipt
 * actions (verify / extend / cancel).
 */

const props = defineProps<{
  modelValue: boolean;
  status: SafeManagedBrowserStatus | null;
  busy?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "verify"): void;
  (e: "extend"): void;
  (e: "cancel"): void;
}>();

const { t } = useI18n();

const accountLabel = computed(
  () =>
    props.status?.accountLabel ??
    (t("managedBrowser.unknown_account") || "—")
);
function onDialogInput(value: boolean): void {
  emit("update:modelValue", value);
}

const reason = computed(() => props.status?.handoffReason ?? null);
const expiresAtEpochMs = computed(
  () => props.status?.handoffExpiresAtEpochMs ?? null
);

// 1-second countdown ticker while the dialog is open.
const nowMs = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | null = null;
watch(
  () => props.modelValue,
  (open) => {
    if (open && ticker === null) {
      ticker = setInterval(() => {
        nowMs.value = Date.now();
      }, 1_000);
    } else if (!open && ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  },
  { immediate: true }
);
onBeforeUnmount(() => {
  if (ticker !== null) {
    clearInterval(ticker);
    ticker = null;
  }
});

const countdownLabel = computed(() => {
  const expires = expiresAtEpochMs.value;
  if (expires === null) {
    return "—";
  }
  const remainingMs = Math.max(0, expires - nowMs.value);
  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
});
</script>
