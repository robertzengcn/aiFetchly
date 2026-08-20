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
      />
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
import WorkspaceStatusIndicator from "./WorkspaceStatusIndicator.vue";
import AiChatExecutionGroup from "./AiChatExecutionGroup.vue";
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
});

watch(
  () => props.conversationId,
  () => {
    void loadActivity();
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
