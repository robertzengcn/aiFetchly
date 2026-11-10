<template>
  <div class="activity-panel" data-testid="workspace-activity-panel">
    <div class="panel-toolbar">
      <span class="panel-title">
        {{ t('workspaceChat.inspector.activity') || 'Activity' }}
      </span>
      <button
        type="button"
        class="inline-action"
        data-testid="workspace-activity-refresh"
        @click="loadActivity"
      >
        {{ t('common.refresh') || 'Refresh' }}
      </button>
    </div>

    <!-- Tool execution groups for the selected conversation (Stage 6
         projection: one evolving row per paired tool-call identity). -->
    <section v-if="executionGroups.length > 0" class="activity-section">
      <h3 class="section-title">
        {{ t('workspaceChat.activity.execution') || 'Execution' }}
      </h3>
      <AiChatExecutionGroup
        v-for="group in executionGroups"
        :key="group.key"
        :group="group"
        with-details
      />
    </section>

    <!-- Complete versioned plan document (FR-054/FR-059). -->
    <AiChatPlanActivityView
      v-if="planPresentation"
      :plan="planPresentation"
      :messages="props.messages"
    />

    <!-- Goal state (PRD §14.3): objective, iteration, status. -->
    <section v-if="goal" class="activity-section">
      <h3 class="section-title">{{ t('workspaceChat.activity.goal') || 'Goal' }}</h3>
      <div class="detail-row" :data-testid="`workspace-activity-goal-${goal.status}`">
        <WorkspaceStatusIndicator :visual="goalVisual" />
        <span class="run-main">
          <span class="run-title">{{ goal.objective || goal.goalId }}</span>
          <span class="run-meta">
            {{ goal.status }}
            <template v-if="goal.iterationCount !== undefined">
              · {{ t('workspaceChat.activity.iterations') || 'iterations' }}: {{ goal.iterationCount }}
            </template>
          </span>
        </span>
      </div>
    </section>

    <!-- Scheduled loop (PRD §14.3): state + pause/resume/stop controls. -->
    <section v-if="conversationId && loopView" class="activity-section">
      <h3 class="section-title">
        {{ t('workspaceChat.activity.scheduledLoop') || 'Scheduled loop' }}
      </h3>
      <div class="detail-row" :data-testid="`workspace-activity-loop-${loopView.status}`">
        <span class="run-main">
          <span class="run-title">{{ loopLabel }}</span>
          <span class="run-meta">
            {{ loopNextRun }}
          </span>
        </span>
      </div>
      <div v-if="loopControlsEnabled" class="loop-actions">
        <button
          v-if="loopView.status === 'running'"
          type="button"
          class="loop-button"
          data-testid="workspace-activity-loop-pause"
          @click="loopControl('pause')"
        >
          {{ t('workspaceChat.activity.pause') || 'Pause' }}
        </button>
        <button
          v-if="loopView.status === 'paused'"
          type="button"
          class="loop-button"
          data-testid="workspace-activity-loop-resume"
          @click="loopControl('resume')"
        >
          {{ t('workspaceChat.activity.resume') || 'Resume' }}
        </button>
        <button
          type="button"
          class="loop-button danger"
          data-testid="workspace-activity-loop-stop"
          @click="loopControl('stop')"
        >
          {{ t('workspaceChat.activity.stopLoop') || 'Stop loop' }}
        </button>
      </div>
    </section>

    <section class="activity-section">
      <h3 class="section-title">
        {{ t('workspaceChat.activity.runs') || 'Runs' }}
      </h3>
      <p v-if="!conversationId" class="panel-empty">
        {{ t('workspaceChat.activity.selectConversation') || 'Select a conversation to see its runs.' }}
      </p>
      <p v-else-if="runs.length === 0 && !loading" class="panel-empty">
        {{ t('workspaceChat.activity.empty') || 'No activity yet' }}
      </p>
      <ul v-else class="run-list">
        <li
          v-for="run in runs"
          :key="run.runId"
          class="run-row"
          :data-testid="`workspace-activity-run-${run.status}`"
        >
          <WorkspaceStatusIndicator :visual="runVisual(run.status)" />
          <span class="run-main">
            <span class="run-title">
              {{ runLabel(run) }}
            </span>
            <span class="run-meta">
              {{ formatTime(run.queuedAt) }}
              <template v-if="run.errorSummary"> · {{ run.errorSummary }}</template>
            </span>
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import type { ConversationRuntimeStatus } from "@/entityTypes/aiChatWorkspaceTypes";
import {
  loadWorkspaceActivity,
  type WorkspaceActivityRun,
} from "@/views/api/aiChatWorkspace";
import {
  getScheduledLoopStatus,
  controlScheduledLoop,
} from "@/views/api/aiChatScheduledLoop";
import type { ScheduledLoopView } from "@/entityTypes/aiChatScheduledLoopTypes";
import { getActiveGoal } from "@/views/api/aiChatGoal";
import type { AIChatGoalView } from "@/entityTypes/aiChatGoalTypes";
import WorkspaceStatusIndicator from "./WorkspaceStatusIndicator.vue";
import AiChatExecutionGroup from "./AiChatExecutionGroup.vue";
import AiChatPlanActivityView from "./AiChatPlanActivityView.vue";
import { selectPlanPresentation } from "./planPresentationProjection";
import {
  buildToolExecutionGroups,
} from "./toolExecutionProjection";
import { conversationStatusVisual, type ConversationStatusVisual } from "./workspaceStatusUtil";

const props = defineProps<{
  conversationId: string | null;
  messages: readonly ChatV2MessageView[];
}>();

const { t } = useI18n();

const runs = ref<readonly WorkspaceActivityRun[]>([]);
const loading = ref(false);
const loopView = ref<ScheduledLoopView | null>(null);

/** Active goal from the durable goal tables (authoritative after reload). */
const goal = ref<AIChatGoalView | null>(null);

async function loadGoal(): Promise<void> {
  if (!props.conversationId) {
    goal.value = null;
    return;
  }
  try {
    goal.value = await getActiveGoal(props.conversationId);
  } catch {
    goal.value = null;
  }
}

const goalVisual = computed<ConversationStatusVisual>(() => ({
  icon: "mdi-flag-outline",
  spinning: goal.value?.status === "running",
  labelKey: "workspaceChat.activity.goal",
  fallback: "Goal",
}));

const loopControlsEnabled = computed(
  () => loopView.value?.status === "running" || loopView.value?.status === "paused"
);

const loopLabel = computed(() => {
  const status = loopView.value?.status ?? "";
  const map: Record<string, { key: string; fallback: string }> = {
    running: { key: "workspaceChat.runStrip.loopRunning", fallback: "Scheduled loop running" },
    paused: { key: "workspaceChat.runStrip.loopPaused", fallback: "Scheduled loop paused" },
    stopped: { key: "workspaceChat.activity.stopped", fallback: "Stopped" },
  };
  const entry = map[status];
  return entry ? t(entry.key) || entry.fallback : status;
});

const loopNextRun = computed(() => {
  const next = loopView.value?.nextRunAt;
  if (!next) return "";
  const parsed = Date.parse(next);
  if (Number.isNaN(parsed)) return "";
  return `${t("workspaceChat.activity.nextRun") || "Next run"}: ${new Date(parsed).toLocaleString()}`;
});

async function loadLoop(): Promise<void> {
  if (!props.conversationId) {
    loopView.value = null;
    return;
  }
  try {
    loopView.value = await getScheduledLoopStatus(props.conversationId);
  } catch {
    loopView.value = null;
  }
}

async function loopControl(
  operation: "pause" | "resume" | "stop"
): Promise<void> {
  if (!props.conversationId) return;
  try {
    loopView.value = await controlScheduledLoop(props.conversationId, operation);
  } catch {
    // Controls remain actionable on failure.
  }
}

async function loadActivity(): Promise<void> {
  if (!props.conversationId) {
    runs.value = [];
    return;
  }
  loading.value = true;
  try {
    runs.value = await loadWorkspaceActivity(props.conversationId);
  } catch {
    runs.value = [];
  } finally {
    loading.value = false;
  }
}

/** Pure projection over persisted tool rows (FR-042..050, Stage 6). */
const executionGroups = computed(() =>
  buildToolExecutionGroups(props.messages)
);

/** Newest plan presentation for the full Activity document (FR-054). */
const planPresentation = computed(() =>
  selectPlanPresentation(props.messages)
);

function runVisual(status: string): ConversationStatusVisual {
  if (status === "completed") {
    return {
      icon: "mdi-check-circle-outline",
      spinning: false,
      labelKey: "workspaceChat.status.completed",
      fallback: "Completed",
    };
  }
  return conversationStatusVisual({
    runtimeStatus: status as ConversationRuntimeStatus,
    attention: "none",
    unread: false,
  });
}

function runLabel(run: WorkspaceActivityRun): string {
  const ownerKey = `workspaceChat.activity.owner.${run.owner}`;
  const ownerLabel = t(ownerKey) || run.owner;
  return ownerLabel;
}

function formatTime(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? "" : new Date(parsed).toLocaleTimeString();
}

onMounted(() => {
  void loadActivity();
  void loadLoop();
  void loadGoal();
});

watch(
  () => props.conversationId,
  () => {
    void loadActivity();
    void loadLoop();
    void loadGoal();
  }
);
</script>

<style scoped>
.activity-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
}

.panel-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
}

.panel-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.inline-action {
  border: none;
  background: none;
  color: rgb(var(--v-theme-primary));
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
}

.activity-section {
  padding: 4px 12px 12px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.65);
  margin: 8px 0 6px;
}

.panel-empty {
  font-size: 12.5px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
}

.detail-row:hover {
  background: rgba(var(--v-theme-on-surface), 0.05);
}

.loop-actions {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

.loop-button {
  border: 1px solid rgba(var(--v-border-color, 0, 0, 0), 0.25);
  border-radius: 6px;
  background: transparent;
  font-size: 11.5px;
  padding: 3px 12px;
  cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

.loop-button.danger {
  color: rgb(var(--v-theme-error));
  border-color: rgba(var(--v-theme-error), 0.4);
}

.loop-button:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}

.run-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.run-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
}

.run-row:hover {
  background: rgba(var(--v-theme-on-surface), 0.05);
}

.run-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.run-title {
  font-size: 12.5px;
}

.run-meta {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
