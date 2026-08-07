<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="(v) => emit('update:modelValue', v)"
    max-width="640"
    persistent
  >
    <v-card v-if="availability">
      <v-card-title class="d-flex align-center">
        <v-icon class="me-2">mdi-import</v-icon>
        {{ t("socialaccount.import.title") }}
      </v-card-title>

      <v-card-subtitle class="pb-1">
        {{ t("socialaccount.import.subtitle") }}
      </v-card-subtitle>

      <v-card-text>
        <!-- Disabled / unsupported reason -->
        <v-alert
          v-if="!availability.enabled"
          type="info"
          variant="tonal"
          density="comfortable"
          class="mb-3"
        >
          {{ disabledReasonText }}
        </v-alert>

        <template v-if="availability.enabled">
          <div class="text-body-2 mb-2">
            {{ t("socialaccount.import.target") }}:
            <strong>{{ availability.platformName }}</strong>
          </div>
          <div class="text-body-2 mb-1">
            {{ t("socialaccount.import.approved_domains") }}:
          </div>
          <v-chip
            v-for="d in availability.approvedDomains"
            :key="d"
            size="small"
            class="me-1 mb-1"
            label
          >
            {{ d }}
          </v-chip>

          <v-alert
            type="info"
            variant="tonal"
            density="comfortable"
            class="mt-3"
          >
            {{ t("socialaccount.import.instructions") }}
          </v-alert>
        </template>

        <!-- Terminal result -->
        <v-alert
          v-if="result"
          :type="result.type"
          variant="tonal"
          density="comfortable"
          class="mt-3"
        >
          {{ result.message }}
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">
          {{ t("socialaccount.import.close") }}
        </v-btn>
        <v-btn
          v-if="availability.enabled && state === 'idle'"
          color="primary"
          variant="flat"
          prepend-icon="mdi-link-variant"
          @click="onStart"
        >
          {{ t("socialaccount.import.start") }}
        </v-btn>
        <v-btn
          v-if="state === 'awaiting'"
          color="error"
          variant="flat"
          @click="onCancel"
        >
          {{ t("socialaccount.import.cancel") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  getBrowserImportAvailability,
  startBrowserPairing,
  cancelBrowserImport,
  receiveBrowserImportEvent,
  type BrowserImportAvailability,
  type PairingInfo,
} from "@/views/api/socialaccount";

const props = defineProps<{ modelValue: boolean; accountId: number }>();
const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "imported"): void;
}>();

const { t } = useI18n({ inheritLocale: true });

type State = "idle" | "awaiting" | "done";
const state = ref<State>("idle");
const availability = ref<BrowserImportAvailability | null>(null);
const pairing = ref<PairingInfo | null>(null);
const result = ref<{ type: "success" | "warning" | "error" | "info"; message: string } | null>(null);

const disabledReasonText = computed(() => {
  const reason = availability.value?.reason;
  if (reason === "feature_disabled") return t("socialaccount.import.reason_feature_disabled");
  if (reason === "platform_unsupported") return t("socialaccount.import.reason_platform_unsupported");
  return t("socialaccount.import.reason_unavailable");
});

async function loadAvailability() {
  availability.value = await getBrowserImportAvailability(props.accountId);
}

watch(
  () => [props.modelValue, props.accountId] as const,
  ([open, id]) => {
    if (open && id > 0) {
      state.value = "idle";
      pairing.value = null;
      result.value = null;
      void loadAvailability();
    }
  },
  { immediate: true }
);

// Listen for a terminal import result pushed from the main process.
receiveBrowserImportEvent((data) => {
  if (state.value !== "awaiting") return;
  const r = data as {
    state?: string;
    importedCookieCount?: number;
    verificationUrl?: string;
  };
  if (!r || !r.state) return;
  state.value = "done";
  if (r.state === "success" || r.state === "partial_success") {
    result.value = {
      type: r.state === "success" ? "success" : "warning",
      message: t("socialaccount.import.result_success", { count: r.importedCookieCount ?? 0 }),
    };
    emit("imported");
  } else if (r.state === "no_eligible_cookies") {
    result.value = { type: "warning", message: t("socialaccount.import.result_no_cookies") };
  } else if (r.state === "request_expired") {
    result.value = { type: "error", message: t("socialaccount.import.result_expired") };
  } else {
    result.value = { type: "error", message: t("socialaccount.import.result_failed") };
  }
});

async function onStart() {
  try {
    pairing.value = await startBrowserPairing(props.accountId);
    state.value = "awaiting";
    result.value = null;
  } catch {
    result.value = { type: "error", message: t("socialaccount.import.result_failed") };
    state.value = "done";
  }
}

async function onCancel() {
  if (pairing.value) {
    await cancelBrowserImport(pairing.value.requestId);
  }
  state.value = "idle";
  pairing.value = null;
}

function close() {
  // Best-effort cancel if a request is still outstanding.
  if (state.value === "awaiting" && pairing.value) {
    void cancelBrowserImport(pairing.value.requestId);
  }
  state.value = "idle";
  pairing.value = null;
  result.value = null;
  emit("update:modelValue", false);
}
</script>
