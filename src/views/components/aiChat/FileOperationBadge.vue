<script setup lang="ts">
import { ref } from "vue";
import type { FileOperationRecord } from "@/entityTypes/fileOperationTypes";
import { AI_FILE_OPEN } from "@/config/channellist";
import { windowInvoke } from "@/views/utils/apirequest";
import { useI18n } from "vue-i18n";

interface Props {
  records: readonly FileOperationRecord[];
}

defineProps<Props>();

const { t } = useI18n();

const expandedDiffs = ref<Set<string>>(new Set());
const showFullDiff = ref<Set<string>>(new Set());

function toggleDiff(recordId: string): void {
  const next = new Set(expandedDiffs.value);
  if (next.has(recordId)) {
    next.delete(recordId);
  } else {
    next.add(recordId);
  }
  expandedDiffs.value = next;
}

function toggleFullDiff(recordId: string): void {
  const next = new Set(showFullDiff.value);
  if (next.has(recordId)) {
    next.delete(recordId);
  } else {
    next.add(recordId);
  }
  showFullDiff.value = next;
}

function getBasename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

function getColor(record: FileOperationRecord): string {
  if (!record.success) return "error";
  switch (record.type) {
    case "create":
      return "success";
    case "overwrite":
      return "warning";
    case "edit":
      return "info";
    default:
      return "default";
  }
}

function getIcon(record: FileOperationRecord): string {
  if (!record.success) return "mdi-alert-circle-outline";
  switch (record.type) {
    case "create":
      return "mdi-plus";
    case "overwrite":
      return "mdi-file-refresh-outline";
    case "edit":
      return "mdi-pencil-outline";
    default:
      return "mdi-file-outline";
  }
}

function getAppendIcon(record: FileOperationRecord): string {
  return record.success ? "mdi-check-circle" : "mdi-alert-circle";
}

function openFile(filePath: string): void {
  windowInvoke(AI_FILE_OPEN, { filePath }).catch((openErr: unknown) => {
    console.error("[file-ops] Failed to open file:", openErr);
  });
}

function getDiffLines(diff: string): string[] {
  return diff.split("\n");
}

function getVisibleLines(diff: string, recordId: string): string[] {
  const lines = getDiffLines(diff);
  if (showFullDiff.value.has(recordId) || lines.length <= 50) {
    return lines;
  }
  return lines.slice(0, 50);
}

function hasMoreLines(diff: string, recordId: string): boolean {
  return (
    !showFullDiff.value.has(recordId) && getDiffLines(diff).length > 50
  );
}

function getDiffLineClass(line: string): string {
  if (line.startsWith("+")) return "diff-add";
  if (line.startsWith("-")) return "diff-remove";
  return "diff-context";
}
</script>

<template>
  <div v-if="records.length > 0" class="file-operation-badges">
    <div
      v-for="record in records"
      :key="record.id"
      class="badge-wrapper"
    >
      <v-chip
        :color="getColor(record)"
        size="small"
        variant="tonal"
        density="compact"
        class="cursor-pointer"
        :title="t('fileOperations.open_with_tooltip') || 'Open with…'"
        @click="openFile(record.filePath)"
      >
        <v-icon start size="x-small">{{ getIcon(record) }}</v-icon>
        {{ getBasename(record.filePath) }}
        <v-icon end size="x-small">{{ getAppendIcon(record) }}</v-icon>
      </v-chip>
      <v-icon
        v-if="record.diff"
        size="x-small"
        class="diff-toggle ml-1 cursor-pointer"
        @click.stop="toggleDiff(record.id)"
      >
        {{ expandedDiffs.has(record.id) ? 'mdi-chevron-up' : 'mdi-chevron-down' }}
      </v-icon>
      <div v-if="!record.success && record.error" class="badge-error">
        {{ record.error }}
      </div>
      <div
        v-if="record.diff && expandedDiffs.has(record.id)"
        class="diff-preview"
      >
        <pre class="diff-content"><template v-for="(line, i) in getVisibleLines(record.diff, record.id)" :key="i"><span :class="getDiffLineClass(line)">{{ line }}</span>
</template></pre>
        <div
          v-if="hasMoreLines(record.diff, record.id)"
          class="diff-expand"
          @click.stop="toggleFullDiff(record.id)"
        >
          {{ t('fileOperations.show_full_diff', { count: getDiffLines(record.diff).length }) || 'Show full diff' }}
        </div>
        <div
          v-else-if="showFullDiff.has(record.id)"
          class="diff-expand"
          @click.stop="toggleFullDiff(record.id)"
        >
          {{ t('fileOperations.collapse_diff') || 'Collapse diff' }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-operation-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.badge-wrapper {
  display: flex;
  flex-direction: column;
}

.cursor-pointer {
  cursor: pointer;
}

.diff-toggle {
  opacity: 0.6;
  vertical-align: middle;
}

.diff-toggle:hover {
  opacity: 1;
}

.badge-error {
  font-size: 11px;
  color: rgb(var(--v-theme-error));
  margin-top: 2px;
  padding-left: 4px;
}

.diff-preview {
  margin-top: 4px;
  border-radius: 4px;
  overflow: hidden;
  max-width: 100%;
}

.diff-content {
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.4;
  margin: 0;
  padding: 8px;
  background-color: rgb(var(--v-theme-surface-variant));
  border-radius: 4px;
  overflow-x: auto;
  white-space: pre;
}

.diff-add {
  color: #22863a;
  background-color: #f0fff4;
}

.diff-remove {
  color: #cb2431;
  background-color: #ffeef0;
}

.diff-context {
  color: #6a737d;
}

.diff-expand {
  font-size: 11px;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
  padding: 4px 8px;
  text-decoration: underline;
}

.diff-expand:hover {
  opacity: 0.8;
}
</style>
