<template>
  <!-- Complete versioned plan document in Activity (FR-054/055): structured
       hierarchy, change reason, decisions — no nested conversation scroller. -->
  <section
    v-if="plan"
    class="plan-activity"
    data-testid="workspace-plan-activity"
    aria-live="polite"
  >
    <header class="plan-header">
      <h3 class="plan-title">{{ plan.title }}</h3>
      <span class="plan-status">
        {{ t(`workspaceChat.plan.status.${plan.status}`) || plan.status }}
      </span>
      <span class="plan-version">v{{ version.version }}</span>
    </header>
    <p v-if="plan.objective" class="plan-objective">{{ plan.objective }}</p>
    <p v-if="version.changeReason" class="plan-change-reason">
      <strong>
        {{ t('workspaceChat.plan.changedSince', { version: version.version - 1 }) || `Changed since v${version.version - 1}` }}:
      </strong>
      {{ version.changeReason }}
    </p>

    <!-- FR-054: every version is selectable; the stored change reason and
         author/timestamps render per version. -->
    <div v-if="versions.length > 1" class="version-selector">
      <label for="plan-version-select">
        {{ t('workspaceChat.plan.version') || 'Version' }}
      </label>
      <select
        id="plan-version-select"
        v-model.number="selectedVersion"
        data-testid="workspace-plan-version-select"
      >
        <option
          v-for="v in versions"
          :key="v.version"
          :value="v.version"
        >
          v{{ v.version }}
          <template v-if="v.version === plan.version">
            ({{ t('workspaceChat.plan.current') || 'current' }})
          </template>
        </option>
      </select>
    </div>

    <div class="plan-document">
      <SafePlanMarkdown :markdown="selectedVersionDoc.planMarkdown || ''" />
    </div>

    <p v-if="selectedVersionDoc.changeReason" class="plan-change-reason">
      <strong>{{ t('workspaceChat.plan.changeReason') || 'Change reason' }}:</strong>
      {{ selectedVersionDoc.changeReason }}
    </p>
    <p class="plan-timeline">
      {{ formatTime(selectedVersionDoc.createdAt) }}
      · {{ selectedVersionDoc.createdBy }}
    </p>

    <!-- FR-059: submitted clarification answers stay inspectable. -->
    <div v-if="answeredQuestions.length > 0" class="plan-answers">
      <h4>{{ t('workspaceChat.plan.clarificationAnswers') || 'Clarification answers' }}</h4>
      <ul>
        <li
          v-for="(entry, index) in answeredQuestions"
          :key="index"
          :data-testid="`workspace-plan-answer-${index}`"
        >
          <span class="answer-question">{{ entry.question }}</span>
          <span class="answer-value">{{ entry.answer }}</span>
        </li>
      </ul>
    </div>

    <!-- FR-054/FR-059: durable decision timeline from message history. -->
    <div v-if="decisions.length > 0" class="plan-decisions">
      <h4>{{ t('workspaceChat.plan.decisions') || 'Decisions' }}</h4>
      <ul>
        <li
          v-for="(entry, index) in decisions"
          :key="index"
          :data-testid="`workspace-plan-decision-${entry.kind}`"
        >
          <span class="decision-label">{{ entry.label }}</span>
          <span class="decision-time">{{ entry.time }}</span>
        </li>
      </ul>
    </div>

    <p v-if="plan.approvedAt" class="plan-timeline">
      {{ t('workspaceChat.plan.approvedAt') || 'Approved' }}:
      {{ formatTime(plan.approvedAt) }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { PlanPresentationView } from "./planPresentationProjection";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import type { AIChatPlanVersionView } from "@/entityTypes/aiChatPlanTypes";
import { getChatV2PlanVersions } from "@/views/api/aiChatV2";
import SafePlanMarkdown from "./SafePlanMarkdown.vue";

const props = defineProps<{
  plan: PlanPresentationView | null;
  /** Message history carries durable answers and decision receipts. */
  messages?: readonly ChatV2MessageView[];
}>();

const { t } = useI18n();

// Render only when a version document exists; versionless states (draft
// before first save) show nothing rather than an empty shell.
const plan = computed(() =>
  props.plan?.latestVersion ? props.plan : null
);
const version = computed(
  // Non-null inside the template: `plan` renders only when latestVersion
  // exists (computed guard above).
  () => plan.value?.latestVersion ?? { version: 0, planMarkdown: "", changeReason: undefined }
);

function formatTime(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleString();
}

// FR-054: full version list with a selector; default follows the plan view.
const versions = ref<readonly AIChatPlanVersionView[]>([]);
const selectedVersion = ref<number | null>(null);

async function loadVersions(): Promise<void> {
  if (!props.plan) return;
  try {
    versions.value = await getChatV2PlanVersions(props.plan.planId);
    selectedVersion.value =
      props.plan.latestVersion?.version ?? versions.value[0]?.version ?? null;
  } catch {
    versions.value = props.plan.latestVersion ? [props.plan.latestVersion] : [];
    selectedVersion.value = props.plan.latestVersion?.version ?? null;
  }
}

const selectedVersionDoc = computed<AIChatPlanVersionView>(
  () =>
    versions.value.find((v) => v.version === selectedVersion.value) ??
    props.plan?.latestVersion ?? {
      planId: props.plan?.planId ?? "",
      version: 0,
      planMarkdown: "",
      createdAt: "",
      createdBy: "user",
    }
);

// FR-059: answered clarification questions from durable message metadata.
const answeredQuestions = computed(() => {
  const entries: Array<{ question: string; answer: string }> = [];
  for (const message of props.messages ?? []) {
    const questionView = message.metadata?.questionView;
    if (questionView?.status !== "answered" || !questionView.answers) continue;
    for (const answer of questionView.answers) {
      entries.push({
        question: answer.question,
        answer: Array.isArray(answer.answer)
          ? answer.answer.join(", ")
          : answer.answer,
      });
    }
  }
  return entries;
});

// Decision receipts from durable plan event rows (FR-054 decision history).
const decisions = computed(() => {
  const labels: Record<string, { key: string; fallback: string }> = {
    plan_approved: { key: "workspaceChat.plan.receiptApproved", fallback: "Plan approved" },
    plan_rejected: { key: "workspaceChat.plan.receiptRejected", fallback: "Plan discarded" },
    plan_changes_requested: {
      key: "workspaceChat.plan.receiptChangesRequested",
      fallback: "Changes requested",
    },
    plan_submitted: { key: "workspaceChat.plan.submitted", fallback: "Plan submitted" },
  };
  const entries: Array<{ kind: string; label: string; time: string }> = [];
  for (const message of props.messages ?? []) {
    const kind = message.metadata?.planEventType;
    if (!kind || !labels[kind]) continue;
    entries.push({
      kind,
      label: t(labels[kind].key) || labels[kind].fallback,
      time: formatTime(message.timestamp),
    });
  }
  return entries.reverse();
});

onMounted(() => {
  void loadVersions();
});

watch(
  () => props.plan?.planId,
  () => {
    void loadVersions();
  }
);
</script>

<style scoped>
.plan-activity {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 2px 12px;
}

.plan-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.plan-title {
  font-size: 13.5px;
  font-weight: 700;
  margin: 0;
  flex: 1;
}

.plan-status {
  font-size: 11px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.25);
  border-radius: 999px;
  padding: 0 8px;
  color: rgba(var(--v-theme-on-surface), 0.75);
}

.plan-version {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.plan-objective {
  margin: 0;
  font-size: 12.5px;
  color: rgba(var(--v-theme-on-surface), 0.75);
}

.plan-change-reason {
  margin: 0;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.8);
}

.plan-document {
  border: 1px solid rgba(var(--v-border-color, 0, 0, 0), 0.14);
  border-radius: 8px;
  padding: 10px 12px;
  max-height: 100%;
  overflow-y: auto;
}

.version-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.version-selector select {
  border: 1px solid rgba(var(--v-border-color, 0, 0, 0), 0.25);
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 12px;
  background: rgb(var(--v-theme-surface));
}

.plan-answers,
.plan-decisions {
  border-top: 1px solid rgba(var(--v-border-color, 0, 0, 0), 0.15);
  padding-top: 6px;
}

.plan-answers h4,
.plan-decisions h4 {
  font-size: 11.5px;
  margin: 4px 0 4px;
  color: rgba(var(--v-theme-on-surface), 0.65);
}

.plan-answers ul,
.plan-decisions ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.answer-question {
  display: block;
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.answer-value {
  font-size: 12px;
  font-weight: 600;
}

.decision-label {
  font-size: 12px;
  font-weight: 600;
}

.decision-time {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin-left: 8px;
}

.plan-timeline {
  margin: 0;
  font-size: 11.5px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
</style>
