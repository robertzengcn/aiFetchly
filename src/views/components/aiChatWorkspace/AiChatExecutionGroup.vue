<template>
  <div
    class="execution-group"
    :data-testid="`workspace-execution-group-${group.completedCount}-${group.totalCount}`"
  >
    <button
      type="button"
      class="group-summary"
      :aria-expanded="expanded"
      @click="toggle"
    >
      <v-icon
        :icon="expanded ? 'mdi-chevron-down' : 'mdi-chevron-right'"
        size="16"
        aria-hidden="true"
      />
      <span class="group-label">
        {{ t('workspaceChat.execution.groupTitle') || 'Execution' }}
      </span>
      <span class="group-progress">
        {{
          t('workspaceChat.execution.progress', {
            completed: group.completedCount,
            total: group.totalCount,
          }) || `${group.completedCount} of ${group.totalCount} complete`
        }}
      </span>
    </button>
    <ul v-if="expanded" class="execution-rows">
      <li v-for="execution in group.executions" :key="execution.key">
        <AiChatExecutionRow :execution="execution" :with-details="withDetails" @reopen-artifact="$emit('reopen-artifact', $event)" />
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { ToolExecutionGroupView } from "./toolExecutionProjection";
import AiChatExecutionRow from "./AiChatExecutionRow.vue";

const emit = defineEmits<{
  (e: 'reopen-artifact', artifactId: string): void;
}>();
void emit;

const props = defineProps<{
  group: ToolExecutionGroupView;
  /** Activity shows the expandable Details disclosure per row (FR-046). */
  withDetails?: boolean;
}>();

const { t } = useI18n();

// User override persists for the session (design §15.10 collapse policy).
const userOverride = ref<boolean | null>(null);
const expanded = computed(
  () => userOverride.value ?? props.group.defaultExpanded
);

function toggle(): void {
  userOverride.value = !expanded.value;
}
</script>

<style scoped>
.execution-group {
  border: 1px solid rgba(var(--v-border-color, 0, 0, 0), 0.14);
  border-radius: 8px;
  margin-bottom: 6px;
  background: rgba(var(--v-theme-surface), 1);
}

.group-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-size: 12.5px;
}

.group-summary:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}

.group-label {
  font-weight: 600;
}

.group-progress {
  margin-left: auto;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 11.5px;
}

.execution-rows {
  list-style: none;
  margin: 0;
  padding: 0 10px 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
</style>
