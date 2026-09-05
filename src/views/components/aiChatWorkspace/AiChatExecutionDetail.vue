<template>
  <!-- Safe technical detail for ONE execution row (FR-046, design §15.11):
       bounded escaped text only — arguments, summary, timing, error. -->
  <div
    v-if="execution"
    class="execution-detail"
    :data-testid="`workspace-execution-detail-${execution.status}`"
  >
    <button
      type="button"
      class="details-toggle"
      :aria-expanded="expanded"
      data-testid="workspace-execution-details-toggle"
      @click="expanded = !expanded"
    >
      <v-icon
        :icon="expanded ? 'mdi-chevron-down' : 'mdi-chevron-right'"
        size="14"
        aria-hidden="true"
      />
      {{ t('workspaceChat.execution.details') || 'Details' }}
    </button>
    <dl v-if="expanded" class="details-grid">
      <div v-if="execution.toolCallId" class="details-entry">
        <dt>id</dt>
        <dd class="mono">{{ execution.toolCallId }}</dd>
      </div>
      <div v-if="execution.argumentsPreview" class="details-entry">
        <dt>{{ t('workspaceChat.execution.arguments') || 'Arguments' }}</dt>
        <dd class="mono pre-wrap">{{ execution.argumentsPreview }}</dd>
      </div>
      <div v-if="execution.summary" class="details-entry">
        <dt>{{ t('workspaceChat.execution.resultSummary') || 'Result' }}</dt>
        <dd class="pre-wrap">{{ execution.summary }}</dd>
      </div>
      <div v-if="execution.durationMs !== undefined" class="details-entry">
        <dt>{{ t('workspaceChat.execution.duration') || 'Duration' }}</dt>
        <dd>{{ (execution.durationMs / 1000).toFixed(1) }}s</dd>
      </div>
      <div v-if="execution.finishedAt" class="details-entry">
        <dt>{{ t('workspaceChat.execution.finishedAt') || 'Finished' }}</dt>
        <dd>{{ formatTime(execution.finishedAt) }}</dd>
      </div>
    </dl>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import type { ToolExecutionView } from "./toolExecutionProjection";

defineProps<{
  execution: ToolExecutionView;
}>();

const { t } = useI18n();
// Session-only expansion: collapsed by default (FR-046).
const expanded = ref(false);

function formatTime(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleTimeString();
}
</script>

<style scoped>
.execution-detail {
  margin-left: 18px;
}

.details-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: none;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 11px;
  cursor: pointer;
  padding: 2px 0;
}

.details-toggle:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}

.details-grid {
  margin: 2px 0 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-left: 2px solid rgba(var(--v-theme-on-surface), 0.12);
  padding-left: 8px;
}

.details-entry dt {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.details-entry dd {
  margin: 0;
  font-size: 11.5px;
  color: rgba(var(--v-theme-on-surface), 0.8);
  overflow-wrap: anywhere;
}

.mono {
  font-family: "JetBrains Mono", "Fira Code", Consolas, monospace;
  font-size: 10.5px;
}

.pre-wrap {
  white-space: pre-wrap;
}
</style>
