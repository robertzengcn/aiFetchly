<template>
  <div class="conversation-report-items" role="group" :aria-label="instructionLabel">
    <div class="conversation-report-items__summary">
      {{ countLabel }}
    </div>
    <ul class="conversation-report-items__list">
      <template v-for="c in snapshot.candidates" :key="c.itemId">
        <!--
          FR-3.3 / Journey 11.2 / §10.3: when the user opts into including
          related user context, the related user message MUST be previewed
          here before upload — never uploaded sight-unseen. The row is
          styled distinctly and labeled "Your message — will be sent" so
          there is no ambiguity about what leaves the device. Read-only,
          escaped preview only; never v-html (§14.5).
        -->
        <li
          v-if="includeRelatedUserContext && c.relatedUser"
          class="conversation-report-items__related"
          :data-testid="`related-user-${c.relatedUser.messageId}`"
          aria-live="polite"
        >
          <span class="conversation-report-items__related-label">
            {{ relatedUserLabel }}
          </span>
          <span class="conversation-report-items__related-text">
            {{ preview(c.relatedUser.text) }}
          </span>
          <span
            v-if="c.relatedUser.omittedAttachmentContent"
            class="conversation-report-items__omitted"
          >
            {{ attachmentOmittedLabel }}
          </span>
        </li>
        <li :data-testid="`report-item-${c.itemId}`">
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
      </template>
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
  /** When true, related user messages are previewed before upload (FR-3.3). */
  includeRelatedUserContext?: boolean;
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
const relatedUserLabel = computed(
  () =>
    t("aiConversationReport.relatedUserLabel") || "Your message — will be sent"
);
const attachmentOmittedLabel = computed(
  () =>
    t("aiConversationReport.attachmentOmitted") ||
    "An attachment in your message was omitted; only the message text is included."
);
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
/* Related-user preview rows are visually distinct from AI-output rows so the
 * user can tell at a glance that their own message will be sent (FR-3.3). */
.conversation-report-items__related {
  background: rgba(var(--v-theme-primary), 0.06);
  border-left: 3px solid rgb(var(--v-theme-primary));
  border-radius: 4px;
  padding: 6px 8px;
  margin: 4px 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.conversation-report-items__related-label {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.85;
}
.conversation-report-items__related-text {
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-word;
}
.conversation-report-items__omitted {
  font-size: 11px;
  opacity: 0.7;
  font-style: italic;
}
</style>
