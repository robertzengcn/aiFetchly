<template>
  <div class="conversation-report-items" role="group" :aria-label="instructionLabel">
    <div class="conversation-report-items__summary">
      {{ countLabel }}
    </div>
    <ul class="conversation-report-items__list">
      <li
        v-for="c in snapshot.candidates"
        :key="c.itemId"
        :data-testid="`report-item-${c.itemId}`"
      >
        <label class="conversation-report-items__row">
          <input
            type="checkbox"
            :checked="selectedItemIds.has(c.itemId)"
            :aria-label="rowLabel(c)"
            @change="onToggle(c.itemId)"
          />
          <span class="conversation-report-items__type">{{ typeLabel(c.contentType) }}</span>
          <span class="conversation-report-items__text">{{ preview(c.text) }}</span>
        </label>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
/**
 * Multi-select list of AI outputs captured in the immutable snapshot
 * (design §10.2). Pure presentational — selection state is owned by the
 * dialog, communicated via `toggle`/`selectAll`. Read-only preview only;
 * never v-html (PRD FR-2.2, §14.5).
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ConversationReportSnapshot } from "./conversationReportSnapshot";
import type { AIContentType } from "@/entityTypes/aiContentReportTypes";

const props = defineProps<{
  snapshot: ConversationReportSnapshot;
  selectedItemIds: ReadonlySet<string>;
}>();
const emit = defineEmits<{
  (e: "toggle", itemId: string): void;
}>();
const { t } = useI18n();

const instructionLabel = computed(
  () => t("aiConversationReport.selectionInstruction") || "Select the AI outputs to report"
);
// vue-i18n v9 interpolates the named token `{n}` itself; pass the value
// through so the rendered label is e.g. "2 selected". Falls back to a plain
// string when the locale (or key) is absent entirely.
const countLabel = computed(() => {
  const n = props.selectedItemIds.size;
  return t("aiConversationReport.selectionCount", { n }) || `${n} selected`;
});
function typeLabel(ct: AIContentType): string {
  return t(`aiConversationReport.itemTypes.${ct}`) || ct;
}
function preview(text?: string): string {
  if (!text) return "";
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}
function rowLabel(c: ConversationReportSnapshot["candidates"][number]): string {
  return `${typeLabel(c.contentType)} — ${preview(c.text)}`;
}
function onToggle(itemId: string): void {
  emit("toggle", itemId);
}
</script>

<style scoped>
.conversation-report-items__list {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 280px;
  overflow-y: auto;
}
.conversation-report-items__row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 4px;
  cursor: pointer;
}
.conversation-report-items__type {
  font-size: 11px;
  opacity: 0.7;
  min-width: 52px;
}
.conversation-report-items__text {
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-word;
}
.conversation-report-items__summary {
  font-size: 12px;
  opacity: 0.8;
  margin-bottom: 6px;
}
</style>
