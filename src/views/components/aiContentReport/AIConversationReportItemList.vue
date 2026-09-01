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
              :disabled="limitReached && !selectedItemIds.has(c.itemId)"
              :aria-label="rowLabel(c)"
              @change="onToggle(c.itemId)"
            />
            <span class="conversation-report-items__type">{{ typeLabel(c.contentType) }}</span>
            <span class="conversation-report-items__text">{{ preview(c.text) }}</span>
            <!--
              FR-2.2 / §10.1: each row shows when the AI output was generated so
              the user can identify it by time as well as content. The snapshot
              carries an RFC3339 generatedAt; rendered as a locale-aware string.
              Read-only, escaped — never v-html (§14.5).
            -->
            <span
              v-if="c.generatedAt"
              class="conversation-report-items__timestamp"
              :data-testid="`report-item-timestamp-${c.itemId}`"
              :title="generatedAtLabel"
            >
              {{ formatTimestamp(c.generatedAt) }}
            </span>
          </label>
          <!--
            FR-2.5 / §10.2: per-image checkboxes for candidates that carry
            generated images. Images default to selected so a single-image
            report is one click; the dialog clamps the submission to ≤3 images
            total via the encoder + request builder. Each checkbox owns its own
            sourceId so toggling one image never silently changes another.
          -->
          <ul
            v-if="c.images.length > 0"
            class="conversation-report-items__images"
            :data-testid="`report-images-${c.itemId}`"
          >
            <li v-for="img in c.images" :key="img.sourceId" :data-testid="`report-image-${img.sourceId}`">
              <label class="conversation-report-items__image">
                <input
                  type="checkbox"
                  :checked="isImageSelected(img.sourceId)"
                  :aria-label="imageLabel"
                  @change="onToggleImage(img.sourceId)"
                />
                <span class="conversation-report-items__image-label">{{ imageLabel }}</span>
              </label>
            </li>
          </ul>
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
  /** Image sourceIds selected for submission (FR-2.5, §10.2). */
  selectedImageIds?: ReadonlySet<string>;
  /** PRD §10.2: maximum number of selectable AI items (10). When set, disables
   * checkboxes for unselected items once the limit is reached and shows
   * "X of maximum" in the summary. */
  maxSelected?: number;
}>();
const emit = defineEmits<{
  (e: "toggle", itemId: string): void;
  (e: "toggleImage", imageSourceId: string): void;
}>();
const { t } = useI18n();

const instructionLabel = computed(
  () => t("aiConversationReport.selectionInstruction") || "Select the AI outputs to report"
);
// PRD §10.2: when a maxSelected limit is set and the selection reaches it,
// the summary shows "X of maximum selected" so the user knows why further
// checkboxes are disabled. Otherwise it shows "{n} selected".
const countLabel = computed(() => {
  const n = props.selectedItemIds.size;
  const max = props.maxSelected;
  if (max && n >= max) {
    return t("aiConversationReport.selectionCountOfMax", { n, max }) || `${n} of ${max} selected`;
  }
  return t("aiConversationReport.selectionCount", { n }) || `${n} selected`;
});
// PRD §10.2: when at the selection limit, unselected item checkboxes are
// disabled so the user cannot exceed the cap. The limit is only enforced
// when maxSelected is provided.
const limitReached = computed(
  () => props.maxSelected !== undefined && props.selectedItemIds.size >= props.maxSelected
);
const relatedUserLabel = computed(
  () =>
    t("aiConversationReport.relatedUserLabel") || "Your message — will be sent"
);
const attachmentOmittedLabel = computed(
  () =>
    t("aiConversationReport.attachmentOmitted") ||
    "An attachment in your message was omitted; only the message text is included."
);
// FR-2.5 / §10.2: the per-image checkbox label announces the action of
// including a generated image in the report.
const imageLabel = computed(
  () => t("aiConversationReport.imageLabel") || "Include image in report"
);
// FR-2.2 / §10.1: accessible label for the per-row generated-at timestamp.
const generatedAtLabel = computed(
  () => t("aiConversationReport.generatedAtLabel") || "Generated at"
);
function typeLabel(ct: AIContentType): string {
  return t(`aiConversationReport.itemTypes.${ct}`) || ct;
}
function preview(text?: string): string {
  if (!text) return "";
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}
// FR-2.2 / §10.1: render the RFC3339 generatedAt as a locale-aware string so
// the user can identify an output by time. Invalid/falsy input yields "".
function formatTimestamp(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return "";
  }
}
function rowLabel(c: ConversationReportSnapshot["candidates"][number]): string {
  const parts = [typeLabel(c.contentType), preview(c.text)];
  const ts = formatTimestamp(c.generatedAt);
  if (ts) parts.push(ts);
  return parts.join(" — ");
}
function onToggle(itemId: string): void {
  emit("toggle", itemId);
}
// FR-2.5 / §10.2: image selection helpers. The parent dialog owns the
// selectedImageIds set; the list is pure presentational and merely reflects
// the current state and bubbles toggle events upward.
function isImageSelected(sourceId: string): boolean {
  return props.selectedImageIds?.has(sourceId) ?? false;
}
function onToggleImage(imageSourceId: string): void {
  emit("toggleImage", imageSourceId);
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
/* FR-2.2 / §10.1: timestamp sits with the content type as small meta text. */
.conversation-report-items__timestamp {
  font-size: 11px;
  opacity: 0.6;
  margin-left: auto;
  white-space: nowrap;
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
/* FR-2.5 / §10.2: nested image checkboxes sit inside the AI-item row, indented
 * to visually group them under their parent item. */
.conversation-report-items__images {
  list-style: none;
  padding: 0 0 0 28px;
  margin: 0;
}
.conversation-report-items__image {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px;
  cursor: pointer;
  font-size: 12px;
}
.conversation-report-items__image-label {
  opacity: 0.85;
}
</style>
