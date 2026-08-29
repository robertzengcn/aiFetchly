<template>
  <v-card
    class="skill-install-card mx-2 my-2"
    variant="tonal"
    :color="cardColor"
    density="compact"
    data-testid="skill-install-card"
  >
    <v-card-title class="d-flex align-center text-body-1">
      <v-icon class="mr-2" size="20">{{ cardIcon }}</v-icon>
      <span>{{ t("skillInstall.title") }}</span>
      <v-spacer />
      <v-chip size="x-small" :color="cardColor" variant="flat">
        {{ stateLabel }}
      </v-chip>
    </v-card-title>

    <v-card-text class="pt-0">
      <!-- Progress summary -->
      <div class="text-body-2 text-medium-emphasis" data-testid="skill-install-summary">
        {{ snapshot?.safeSummary || t("skillInstall.state.requested") }}
      </div>

      <v-progress-linear
        v-if="inProgress"
        indeterminate
        color="primary"
        height="4"
        class="my-2"
      />

      <!-- Plan review (awaiting_approval) -->
      <div
        v-if="snapshot?.state === 'awaiting_approval'"
        data-testid="skill-install-review"
        class="mt-2"
      >
        <div class="text-caption text-medium-emphasis mb-1">
          {{ t("skillInstall.reviewHint") }}
        </div>
        <div class="d-flex ga-2 flex-wrap">
          <v-btn
            size="small"
            color="primary"
            variant="flat"
            data-testid="skill-install-approve"
            :loading="busy"
            @click="onApprove(true)"
          >
            {{ t("skillInstall.approve") }}
          </v-btn>
          <v-btn
            size="small"
            variant="outlined"
            data-testid="skill-install-reject"
            :loading="busy"
            @click="onApprove(false)"
          >
            {{ t("skillInstall.reject") }}
          </v-btn>
        </div>
      </div>

      <!-- Secure credential input (awaiting_secret) -->
      <div
        v-if="snapshot?.state === 'awaiting_secret'"
        data-testid="skill-install-secret"
        class="mt-2"
      >
        <div class="text-caption mb-1">
          {{ t("skillInstall.secretHint", { name: secretVariableName }) }}
        </div>
        <v-text-field
          v-model="secretValue"
          type="password"
          variant="outlined"
          density="compact"
          hide-details
          autocomplete="off"
          :label="secretVariableName"
          data-testid="skill-install-secret-input"
        />
        <v-btn
          size="small"
          color="primary"
          variant="flat"
          class="mt-2"
          :disabled="secretValue.length === 0"
          :loading="busy"
          data-testid="skill-install-secret-submit"
          @click="onSubmitSecret"
        >
          {{ t("skillInstall.submitSecret") }}
        </v-btn>
        <div class="text-caption text-warning mt-1">
          {{ t("skillInstall.secretNeverInChat") }}
        </div>
      </div>

      <!-- Recoverable failure -->
      <div
        v-if="snapshot?.state === 'failed'"
        class="mt-2 d-flex ga-2"
        data-testid="skill-install-failed"
      >
        <v-btn size="small" variant="outlined" :loading="busy" data-testid="skill-install-retry" @click="onRefresh">
          {{ t("skillInstall.retry") }}
        </v-btn>
        <v-btn size="small" variant="text" data-testid="skill-install-cancel" @click="onCancel">
          {{ t("skillInstall.cancel") }}
        </v-btn>
      </div>

      <!-- Terminal states -->
      <div
        v-if="snapshot?.state === 'ready'"
        class="text-success text-body-2 mt-2"
        data-testid="skill-install-ready"
      >
        {{ t("skillInstall.ready") }}
      </div>
      <div
        v-if="snapshot?.state === 'cancelled'"
        class="text-medium-emphasis text-body-2 mt-2"
      >
        {{ t("skillInstall.cancelled") }}
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { InstallSnapshot } from "@/entityTypes/skillInstallationTypes";
import {
  approveSkillInstall,
  cancelSkillInstall,
  getSkillInstallApprovalToken,
  getSkillInstallStatus,
  onSkillInstallProgress,
  submitSkillInstallSecret,
} from "@/views/api/skillInstallation";

const props = defineProps<{
  /** Latest installation snapshot from the installer (tool result / IPC). */
  snapshot: InstallSnapshot;
}>();

const emit = defineEmits<{
  (e: "updated", snapshot: InstallSnapshot): void;
  (e: "failed", message: string): void;
}>();

const { t } = useI18n();
const busy = ref(false);
const secretValue = ref("");
// Local override: newer snapshots (progress events, refresh) shadow the
// prop without rewriting the persisted tool-result message.
const localSnapshot = ref<InstallSnapshot | null>(null);
const snapshotView = computed(
  () => localSnapshot.value ?? props.snapshot
);

// TODO 7: live progress — refresh the snapshot when a NEWER event for this
// session arrives on the monotonic SKILL_INSTALL_PROGRESS channel. Stale or
// duplicate events (renderer retries) are ignored via the seq gate.
let lastSeq = 0;
let unsubscribe: (() => void) | null = null;
onMounted(() => {
  unsubscribe = onSkillInstallProgress((event) => {
    if (
      event.sessionId !== snapshotView.value.sessionId ||
      event.seq <= lastSeq ||
      busy.value
    ) {
      return;
    }
    lastSeq = event.seq;
    void refreshSnapshot();
  });
});
onUnmounted(() => {
  unsubscribe?.();
  unsubscribe = null;
});

async function refreshSnapshot(): Promise<void> {
  const snapshot = await getSkillInstallStatus(snapshotView.value.sessionId);
  if (snapshot) {
    localSnapshot.value = snapshot;
  }
}

const inProgress = computed(() =>
  [
    "requested",
    "acquiring",
    "inspecting",
    "planning",
    "activating",
    "verifying",
    "installing_dependencies",
  ].includes(snapshotView.value?.state)
);

const cardColor = computed(() => {
  switch (snapshotView.value?.state) {
    case "ready":
      return "success";
    case "failed":
    case "rollback_required":
      return "error";
    case "cancelled":
      return "grey";
    case "awaiting_approval":
    case "awaiting_secret":
      return "warning";
    default:
      return "primary";
  }
});

const cardIcon = computed(() => {
  switch (snapshotView.value?.state) {
    case "ready":
      return "mdi-check-circle";
    case "failed":
    case "rollback_required":
      return "mdi-alert";
    default:
      return "mdi-download";
  }
});

const stateLabel = computed(() => {
  const key = `skillInstall.state.${snapshotView.value?.state ?? "requested"}`;
  const label = t(key);
  return label === key ? snapshotView.value?.state ?? "" : label;
});

/** The environment variable name from the safe summary, when surfaced. */
const secretVariableName = computed(() => {
  const match = snapshotView.value?.safeSummary?.match(/[A-Z][A-Z0-9_]{4,}/);
  return match?.[0] ?? "API_KEY";
});

async function onApprove(approve: boolean): Promise<void> {
  busy.value = true;
  try {
    // The opaque token binds approval to this card (review D1): the model
    // can plan but never self-approve.
    const approvalToken = await getSkillInstallApprovalToken(
      snapshotView.value.sessionId
    );
    if (!approvalToken) {
      emit("failed", t("skillInstall.errors.actionFailed"));
      return;
    }
    const snapshot = await approveSkillInstall({
      sessionId: snapshotView.value.sessionId,
      planRevision: snapshotView.value.planRevision ?? "",
      approve,
      approvalToken,
    });
    if (snapshot) {
      emit("updated", snapshot);
    } else {
      emit("failed", t("skillInstall.errors.actionFailed"));
    }
  } finally {
    busy.value = false;
  }
}

async function onSubmitSecret(): Promise<void> {
  busy.value = true;
  try {
    const result = await submitSkillInstallSecret({
      sessionId: snapshotView.value.sessionId,
      environmentVariable: secretVariableName.value,
      value: secretValue.value,
    });
    if (result?.snapshot) {
      // Clear ONLY on success — the value lives in the secure store now.
      // On failure the typed value stays so the user can retry (D2 test).
      secretValue.value = "";
      emit("updated", result.snapshot);
    } else {
      emit("failed", t("skillInstall.errors.secretFailed"));
    }
  } finally {
    busy.value = false;
  }
}

async function onCancel(): Promise<void> {
  busy.value = true;
  try {
    const snapshot = await cancelSkillInstall(snapshotView.value.sessionId);
    if (snapshot) emit("updated", snapshot);
  } finally {
    busy.value = false;
  }
}

async function onRefresh(): Promise<void> {
  await refreshSnapshot();
  if (localSnapshot.value) {
    emit("updated", localSnapshot.value);
  }
}
</script>

<style scoped>
.skill-install-card {
  max-width: 560px;
  border-radius: 12px;
}
</style>
