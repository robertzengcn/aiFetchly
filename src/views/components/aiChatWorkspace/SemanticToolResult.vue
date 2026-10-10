<template>
  <!-- Specialized outputs replace the generic result body (FR-047). -->
  <span
    class="semantic-result"
    :class="`kind-${outputKind}`"
    :data-testid="`workspace-semantic-result-${outputKind}`"
  >
    <template v-if="outputKind === 'artifact'">
      <v-icon icon="mdi-language-html5" size="14" aria-hidden="true" />
      {{ t('workspaceChat.execution.artifactCreated') || 'HTML report created — open it in Artifacts' }}
      <button
        v-if="artifactId"
        type="button"
        class="artifact-reopen"
        data-testid="workspace-artifact-reopen"
        :aria-label="t('workspaceChat.execution.openArtifact') || 'Open artifact'"
        @click="emit('reopen-artifact', artifactId)"
      >
        <v-icon icon="mdi-open-in-new" size="12" aria-hidden="true" />
        {{ t('workspaceChat.execution.openArtifact') || 'Open' }}
      </button>
    </template>
    <template v-else-if="outputKind === 'images'">
      <v-icon icon="mdi-image-multiple-outline" size="14" aria-hidden="true" />
      {{ t('workspaceChat.execution.imagesGenerated') || 'Images generated' }}
    </template>
    <template v-else-if="outputKind === 'error'">
      <span class="error-summary">{{ displaySummary }}</span>
    </template>
    <template v-else-if="outputKind === 'summary'">
      <span class="result-summary">{{ displaySummary }}</span>
    </template>
    <template v-else-if="outputKind === 'files'">
      {{ t('workspaceChat.execution.filesChanged') || 'Files changed — see Activity' }}
    </template>
    <template v-else-if="outputKind === 'permission'">
      {{ t('workspaceChat.execution.permissionNeeded') || 'Permission decision required' }}
    </template>
    <template v-else>
      {{ t('workspaceChat.execution.structuredResult') || 'Structured result — see details in Activity' }}
    </template>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ToolOutputKind } from "./toolExecutionProjection";

const props = defineProps<{
  outputKind: ToolOutputKind;
  summary?: string;
  isError: boolean;
  /** FR-030: persisted artifact ID for reopen from history. */
  artifactId?: string;
}>();

const emit = defineEmits<{
  /** FR-030: reopen a persisted artifact in the inspector. */
  (e: "reopen-artifact", artifactId: string): void;
}>();

const { t } = useI18n();

const displaySummary = computed(() => props.summary ?? "");
</script>

<style scoped>
.semantic-result {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  border-radius: 4px;
  padding: 2px 6px;
  background: rgba(var(--v-theme-on-surface), 0.05);
}

.kind-error {
  color: rgb(var(--v-theme-error));
  background: rgba(var(--v-theme-error), 0.08);
}

.result-summary,
.error-summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.artifact-reopen {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  border: none;
  background: none;
  padding: 0 0 0 4px;
  color: rgb(var(--v-theme-primary));
  font-size: 11px;
  cursor: pointer;
  text-decoration: underline;
}

.artifact-reopen:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}

.kind-artifact {
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
}
</style>
