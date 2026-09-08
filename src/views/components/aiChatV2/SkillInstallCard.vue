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

      <!-- Structured plan fields (TODO 8 / design §22.1): source, revision,
           skills, dependencies, credentials, mode, warnings — shown whenever
           the snapshot carries a safePlan (review state onward). -->
      <div
        v-if="safePlan"
        data-testid="skill-install-plan"
        class="mt-2 text-body-2"
      >
        <div class="d-flex ga-1 flex-wrap align-center">
          <v-chip size="x-small" label variant="tonal">
            {{ safePlan.mode }}
          </v-chip>
          <span class="text-caption text-medium-emphasis">
            {{ safePlan.source }} @ {{ safePlan.revision }}
          </span>
        </div>
        <div
          v-for="skillRow in safePlan.skills"
          :key="skillRow.name"
          class="mt-1"
          data-testid="skill-install-plan-skill"
        >
          <strong>{{ skillRow.name }}</strong>
          <span class="text-caption text-medium-emphasis">
            ({{ skillRow.kind }})
          </span>
          <div class="text-caption">{{ skillRow.description }}</div>
        </div>
        <div
          v-if="safePlan.dependencies.length > 0"
          class="mt-1 text-caption"
          data-testid="skill-install-plan-deps"
        >
          <span
            v-for="dep in safePlan.dependencies"
            :key="dep.name"
            class="mr-2"
            :class="dep.status === 'satisfied' ? 'text-success' : 'text-warning'"
          >
            {{ dep.name }}: {{ dep.status }}
          </span>
        </div>
        <div
          v-if="safePlan.credentials.length > 0"
          class="mt-1 text-caption"
          data-testid="skill-install-plan-creds"
        >
          {{ t("skillInstall.planCredentials") }}:
          {{ safePlan.credentials.join(", ") }}
        </div>
      </div>

      <!-- Expandable diagnostics (TODO 8): raw safe summary + warnings. -->
      <details
        v-if="snapshotView?.safeSummary || safePlan?.warnings?.length"
        class="mt-1"
        data-testid="skill-install-diagnostics"
      >
        <summary class="text-caption text-medium-emphasis">
          {{ t("skillInstall.diagnostics") }}
        </summary>
        <div
          v-if="safePlan?.warnings?.length"
          class="text-caption text-warning mt-1"
        >
          <div v-for="(warning, i) in safePlan.warnings" :key="i">
            {{ warning }}
          </div>
        </div>
        <pre class="text-caption mt-1">{{ snapshotView?.safeSummary }}</pre>
      </details>

      <!-- Commands that will execute (review D1): shown on the approval
           card so approving is informed consent for repository-controlled
           execution. Never rendered outside the review state. -->
      <div
        v-if="snapshotView?.state === 'awaiting_approval' && safePlan?.commands?.length"
        data-testid="skill-install-commands"
        class="mt-2"
      >
        <div class="text-caption text-medium-emphasis mb-1">
          {{ t("skillInstall.planCommands") }}
        </div>
        <div
          v-for="cmd in safePlan.commands"
          :key="cmd.id"
          class="text-caption mb-1"
          :class="cmd.riskLevel === 'high' ? 'text-warning' : ''"
          data-testid="skill-install-command-row"
        >
          <code>{{ cmd.executable }} {{ cmd.args.join(" ") }}</code>
          <v-chip
            size="x-small"
            :color="cmd.riskLevel === 'high' ? 'warning' : 'default'"
            variant="tonal"
            class="ml-1"
          >
            {{ cmd.riskLevel }}
          </v-chip>
        </div>
        <div class="text-caption text-warning mb-1">
          {{ t("skillInstall.highRiskHint") }}
        </div>
      </div>

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

      <!-- Typed dependency approval (installing_dependencies / PRD §18):
           one control per MISSING plan dependency. Approve runs the
           catalog-validated system installer; decline rolls the activation
           back and cancels. Token binding is identical to plan approval. -->
      <div
        v-if="snapshot?.state === 'installing_dependencies' && missingDependencies.length > 0"
        data-testid="skill-install-deps"
        class="mt-2"
      >
        <div class="text-caption text-medium-emphasis mb-1">
          {{ t("skillInstall.dependency.hint") }}
        </div>
        <div
          v-for="dep in missingDependencies"
          :key="dep.id"
          class="d-flex align-center ga-2 mb-1"
          data-testid="skill-install-dep-row"
        >
          <div class="flex-grow-1">
            <strong>{{ dep.name }}</strong>
            <div class="text-caption text-medium-emphasis">
              {{ dep.installMethod }}
              <v-chip
                v-if="dep.requiresElevation"
                size="x-small"
                variant="tonal"
                class="ml-1"
              >
                {{ t("skillInstall.dependency.elevation") }}
              </v-chip>
            </div>
          </div>
          <v-btn
            size="x-small"
            color="primary"
            variant="flat"
            :loading="busy"
            :data-testid="`skill-install-dep-approve-${dep.name}`"
            @click="onApproveDependency(dep.id, true)"
          >
            {{ t("skillInstall.dependency.install") }}
          </v-btn>
          <v-btn
            size="x-small"
            variant="outlined"
            :loading="busy"
            :data-testid="`skill-install-dep-decline-${dep.name}`"
            @click="onApproveDependency(dep.id, false)"
          >
            {{ t("skillInstall.dependency.decline") }}
          </v-btn>
        </div>
        <div class="text-caption text-medium-emphasis mt-1">
          {{ t("skillInstall.dependency.typedHint") }}
        </div>
      </div>

      <!-- Approved command execution (FR-06/FR-16): per-command controls
           shown on APPROVED sessions in hold/failure states. The caller
           supplies only the persisted template id — the main process
           revalidates executable/args and injects declared credentials
           directly into the child environment. The model has no channel
           that accepts command text. -->
      <div
        v-if="commandSectionVisible && safePlan?.commands?.length"
        data-testid="skill-install-run-commands"
        class="mt-2"
      >
        <div class="text-caption text-medium-emphasis mb-1">
          {{ t("skillInstall.command.sectionHint") }}
        </div>
        <div
          v-for="cmd in safePlan.commands"
          :key="cmd.id"
          class="mb-2"
          data-testid="skill-install-run-command-row"
        >
          <div class="d-flex align-center ga-2">
            <code class="text-caption flex-grow-1">
              {{ cmd.executable }} {{ cmd.args.join(" ") }}
            </code>
            <v-chip
              size="x-small"
              :color="cmd.riskLevel === 'high' ? 'warning' : 'default'"
              variant="tonal"
            >
              {{ cmd.riskLevel }}
            </v-chip>
            <v-btn
              size="x-small"
              variant="outlined"
              :loading="busy"
              :data-testid="`skill-install-run-${cmd.id}`"
              @click="onRunCommand(cmd.id)"
            >
              {{ t("skillInstall.command.run") }}
            </v-btn>
          </div>
          <div
            v-if="cmd.environmentNames.length > 0"
            class="text-caption text-medium-emphasis"
          >
            {{ t("skillInstall.command.envVars", { names: cmd.environmentNames.join(", ") }) }}
          </div>
          <div
            v-if="commandResults[cmd.id]"
            class="text-caption mt-1"
            :class="commandResults[cmd.id]?.ok ? 'text-success' : 'text-error'"
            :data-testid="`skill-install-run-result-${cmd.id}`"
          >
            {{ commandResults[cmd.id]?.ok
              ? t("skillInstall.command.resultOk", { code: commandResults[cmd.id]?.exitCode ?? "n/a" })
              : t("skillInstall.command.resultFailed", { message: commandResults[cmd.id]?.message ?? commandResults[cmd.id]?.errorCode ?? "" }) }}
            <span v-if="(commandResults[cmd.id]?.injectedEnvNames.length ?? 0) > 0">
              {{ t("skillInstall.command.injected", { names: commandResults[cmd.id]?.injectedEnvNames.join(", ") }) }}
            </span>
            <details
              v-if="commandResults[cmd.id]?.stdoutPreview || commandResults[cmd.id]?.stderrPreview"
            >
              <summary>{{ t("skillInstall.command.output") }}</summary>
              <pre>{{ commandResults[cmd.id]?.stdoutPreview }}</pre>
              <pre class="text-error">{{ commandResults[cmd.id]?.stderrPreview }}</pre>
            </details>
          </div>
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

      <!-- Recoverable failure (failed) or post-activation rollback
           (rollback_required) — both offer recovery guidance. -->
      <div
        v-if="['failed', 'rollback_required'].includes(snapshot?.state ?? '')"
        class="mt-2 d-flex ga-2"
        data-testid="skill-install-failed"
      >
        <v-btn size="small" variant="outlined" :loading="busy" data-testid="skill-install-retry" @click="onRetry">
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
  approveSkillInstallDependency,
  cancelSkillInstall,
  getSkillInstallApprovalToken,
  getSkillInstallStatus,
  onSkillInstallProgress,
  retrySkillInstall,
  runApprovedSkillInstallCommand,
  submitSkillInstallSecret,
  type ApprovedCommandRunView,
} from "@/views/api/skillInstallation";

const props = defineProps<{
  /** Latest installation snapshot from the installer (tool result / IPC). */
  snapshot: InstallSnapshot;
  /** FR-29: binds lifecycle calls to this conversation when provided. */
  conversationId?: string;
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

/** Structured plan fields when the snapshot carries a safePlan (TODO 8). */
const safePlan = computed(() => snapshotView.value?.safePlan ?? null);

/** Missing plan dependencies — the approveDependency targets (PRD §18). */
const missingDependencies = computed(
  () =>
    safePlan.value?.dependencies.filter((d) => d.status !== "satisfied") ?? []
);

/**
 * Approved-command run controls appear only on APPROVED sessions in
 * hold/failure states (the runner rejects unapproved sessions anyway) —
 * never during review, and never after a terminal state.
 */
const commandSectionVisible = computed(() =>
  [
    "awaiting_secret",
    "installing_dependencies",
    "failed",
    "rollback_required",
  ].includes(snapshotView.value?.state ?? "")
);

/** Per-command-id results from manual runs (previews are redacted). */
const commandResults = ref<Record<string, ApprovedCommandRunView>>({});

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
      ...(props.conversationId
        ? { conversationId: props.conversationId }
        : {}),
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

/** Approve or decline ONE missing dependency (PRD §18 / FR-14). */
async function onApproveDependency(
  dependencyId: string,
  approve: boolean
): Promise<void> {
  busy.value = true;
  try {
    // Same opaque-token binding as the plan approval (review D1): the
    // model can report the missing dependency but never approve the
    // system-level install itself.
    const approvalToken = await getSkillInstallApprovalToken(
      snapshotView.value.sessionId
    );
    if (!approvalToken) {
      emit("failed", t("skillInstall.errors.actionFailed"));
      return;
    }
    const snapshot = await approveSkillInstallDependency({
      sessionId: snapshotView.value.sessionId,
      dependencyId,
      approve,
      planRevision: snapshotView.value.planRevision ?? "",
      approvalToken,
      ...(props.conversationId
        ? { conversationId: props.conversationId }
        : {}),
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

/** Run ONE approved command template by id (FR-06/FR-16). */
async function onRunCommand(commandId: string): Promise<void> {
  busy.value = true;
  try {
    // Token-bound like every other mutation on this card (review D3): run
    // execution is authorized at the same strength as approve.
    const approvalToken = await getSkillInstallApprovalToken(
      snapshotView.value.sessionId
    );
    if (!approvalToken) {
      emit("failed", t("skillInstall.errors.actionFailed"));
      return;
    }
    const result = await runApprovedSkillInstallCommand({
      sessionId: snapshotView.value.sessionId,
      commandId,
      approvalToken,
    });
    if (result) {
      // Immutable update: never mutate the previous results object.
      commandResults.value = { ...commandResults.value, [commandId]: result };
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
    const snapshot = await cancelSkillInstall(snapshotView.value.sessionId, {
      ...(props.conversationId
        ? { conversationId: props.conversationId }
        : {}),
    });
    if (snapshot) emit("updated", snapshot);
  } finally {
    busy.value = false;
  }
}

/**
 * Typed retry (FR-20): re-run the failed installation from the recorded
 * canonical source. A refused retry (three-same-cause stop rule) surfaces
 * the typed error through the failed event; success swaps in the new
 * session's snapshot.
 */
async function onRetry(): Promise<void> {
  busy.value = true;
  try {
    const snapshot = await retrySkillInstall(snapshotView.value.sessionId, {
      ...(props.conversationId
        ? { conversationId: props.conversationId }
        : {}),
    });
    if (snapshot) {
      localSnapshot.value = snapshot;
      emit("updated", snapshot);
    } else {
      emit("failed", t("skillInstall.errors.actionFailed"));
    }
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.skill-install-card {
  max-width: 560px;
  border-radius: 12px;
}
</style>
