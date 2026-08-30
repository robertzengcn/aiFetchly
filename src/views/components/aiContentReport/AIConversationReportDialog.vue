<template>
  <v-dialog
    :model-value="modelValue"
    max-width="680"
    scrollable
    @update:model-value="onToggle"
  >
    <v-card data-testid="ai-conversation-report-dialog">
      <v-card-title id="ai-conversation-report-title" ref="titleRef" tabindex="-1">
        {{ titleText }}
      </v-card-title>
      <v-card-text>
        <AIConversationReportItemList
          :snapshot="snapshot"
          :selected-item-ids="selectedItemIds"
          @toggle="toggleItem"
        />

        <label
          v-if="canIncludeRelatedUser"
          class="conversation-report__opt-in"
          data-testid="include-related-user-context"
        >
          <input type="checkbox" :checked="includeRelatedUserContext" @change="onToggleRelated" />
          <span>{{ includeRelatedUserLabel }}</span>
        </label>
        <p v-if="includeRelatedUserContext" class="conversation-report__warn">{{ userMessageWillBeSent }}</p>

        <v-select
          v-model="category"
          :items="categoryItems"
          :label="categoryLabel"
          item-title="label"
          item-value="value"
          density="compact"
          class="mt-3"
          aria-required="true"
          :error-messages="categoryError ? [categoryError] : []"
        />
        <v-textarea
          v-model="comment"
          :label="commentLabel"
          density="compact"
          rows="2"
          counter="2000"
          maxlength="2000"
          auto-grow
          class="mt-2"
        />

        <div class="report-notice">
          <v-icon size="small" start>mdi-shield-lock-outline</v-icon>
          <span>{{ consentText }}</span>
        </div>
        <div v-if="localError" class="report-error" aria-live="polite" data-testid="conversation-report-error">
          {{ localError }}
        </div>
        <div v-if="resultMessage" class="report-result" aria-live="polite" role="status">
          <v-icon :color="resultIsError ? 'error' : 'success'" size="small" start>
            {{ resultIsError ? "mdi-alert-circle" : "mdi-check-circle" }}
          </v-icon>
          <span>{{ resultMessage }}</span>
        </div>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" data-testid="conversation-report-cancel" :disabled="submitting" @click="onCancel">
          {{ cancelText }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          data-testid="conversation-report-submit"
          :loading="submitting"
          :disabled="submitting"
          @click="onSubmit"
        >
          {{ submitText }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
/**
 * Multi-select conversation report dialog (design §10.3). Separate from the
 * single-output AIContentReportDialog (design D2). Operates on an immutable
 * snapshot captured at open time; a conversation-ID watch closes the dialog if
 * the active conversation changes underneath it.
 *
 * NOT AI-gated: submission goes through `registerValidatedHandler`, never the
 * AI feature gate. The related-user opt-in is fresh and unchecked per open
 * (PRD §10.3, design §7.3).
 */
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AIConversationReportItemList from "./AIConversationReportItemList.vue";
import {
  buildCreateAIConversationReportRequest,
  AIConversationReportLocalError,
} from "./conversationReportRequest";
import { createAIContentReport } from "@/views/api/aiContentReport";
import type { ConversationReportSnapshot } from "./conversationReportSnapshot";
import {
  AI_CONTENT_REPORT_CATEGORIES,
  type AIContentReportCategory,
} from "@/entityTypes/aiContentReportTypes";

const props = defineProps<{
  modelValue: boolean;
  snapshot: ConversationReportSnapshot;
  privacyPolicyUrl?: string;
  activatorEl?: HTMLElement | null;
}>();
const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "submitted", payload: { reportId: string; selectedMessageIds: string[] }): void;
}>();
const { t, locale } = useI18n();

const titleRef = ref<{ $el?: HTMLElement } | null>(null);
let lastFocusedEl: HTMLElement | null = null;

const selectedItemIds = ref<Set<string>>(new Set());
const includeRelatedUserContext = ref(false);
const category = ref<AIContentReportCategory | null>(null);
const comment = ref("");
const submitting = ref(false);
const localError = ref("");
const resultMessage = ref("");
const resultIsError = ref(false);
const clientReportId = ref("");
const categoryError = ref("");

const titleText = computed(() => t("aiConversationReport.dialogTitle") || "Report conversation");
const submitText = computed(() => t("aiConversationReport.continueAndSubmit") || "Submit report");
const cancelText = computed(() => t("aiConversationReport.cancel") || "Cancel");
const categoryLabel = computed(() => t("aiConversationReport.categoryLabel") || "What is wrong?");
const commentLabel = computed(() => t("aiConversationReport.commentLabel") || "Additional details (optional)");
const includeRelatedUserLabel = computed(
  () => t("aiConversationReport.includeRelatedUserContext") || "Include my related message"
);
const userMessageWillBeSent = computed(
  () => t("aiConversationReport.userMessageWillBeSent") || "Your related message will be sent with the report."
);
const consentText = computed(
  () =>
    t("aiConversationReport.consentDefault") ||
    "Only the selected AI outputs and your description will be sent. Your other messages, files, and AI reasoning are not included."
);

const canIncludeRelatedUser = computed(() => props.snapshot.candidates.some((c) => c.relatedUser));

const categoryItems = computed(() =>
  AI_CONTENT_REPORT_CATEGORIES.map((value) => ({
    value,
    label: t(`aiContentReport.categories.${value}`) || value,
  }))
);

function toggleItem(itemId: string): void {
  const next = new Set(selectedItemIds.value);
  if (next.has(itemId)) next.delete(itemId);
  else next.add(itemId);
  selectedItemIds.value = next;
  localError.value = "";
}

function onToggleRelated(): void {
  includeRelatedUserContext.value = !includeRelatedUserContext.value;
}

function onToggle(v: boolean): void {
  emit("update:modelValue", v);
}

function onCancel(): void {
  emit("update:modelValue", false);
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      lastFocusedEl = (document.activeElement as HTMLElement | null) ?? props.activatorEl ?? null;
      clientReportId.value = generateClientReportId();
      selectedItemIds.value = new Set();
      includeRelatedUserContext.value = false;
      category.value = null;
      comment.value = "";
      localError.value = "";
      resultMessage.value = "";
      resultIsError.value = false;
      categoryError.value = "";
      nextTick(() => titleRef.value?.$el?.focus?.());
    } else {
      const target = lastFocusedEl ?? props.activatorEl ?? null;
      target?.focus?.();
      lastFocusedEl = null;
    }
  }
);

function generateClientReportId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `cr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function localErrorText(code: AIConversationReportLocalError["code"]): string {
  const map: Record<AIConversationReportLocalError["code"], string> = {
    selection_required: t("aiConversationReport.errors.selectionRequired") || "Select at least one AI output.",
    selection_limit: t("aiConversationReport.errors.selectionLimit") || "Select at most 10 AI outputs.",
    image_limit: t("aiConversationReport.errors.imageLimit") || "At most 3 images per report.",
    related_message_unavailable: t("aiConversationReport.errors.relatedMessageUnavailable") || "No related message is available.",
    conversation_changed: t("aiConversationReport.errors.conversationChanged") || "The conversation changed; reopen the report.",
    evidence_unavailable: t("aiConversationReport.errors.unsupportedSchema") || "Evidence unavailable.",
  };
  return map[code] || "Unable to submit.";
}

async function onSubmit(): Promise<void> {
  localError.value = "";
  categoryError.value = "";

  // Selection gate first: the empty-selection error takes precedence over a
  // missing category because selection is the dialog's primary action (the
  // user clicked "Report conversation" to get here).
  if (selectedItemIds.value.size === 0) {
    localError.value = localErrorText("selection_required");
    return;
  }
  if (!category.value) {
    categoryError.value = t("aiContentReport.errors.categoryRequired") || "Please choose a category.";
    return;
  }

  let request;
  try {
    request = await buildCreateAIConversationReportRequest({
      snapshot: props.snapshot,
      selectedAIItemIds: selectedItemIds.value,
      selectedImageIds: new Set<string>(),
      includeRelatedUserContext: includeRelatedUserContext.value,
      category: category.value,
      comment: comment.value,
      locale: locale.value || "en-US",
      clientReportId: clientReportId.value,
    });
  } catch (err) {
    if (err instanceof AIConversationReportLocalError) {
      localError.value = localErrorText(err.code);
    } else {
      localError.value = t("aiConversationReport.errors.unsupportedSchema") || "Unable to build the report.";
    }
    return;
  }

  submitting.value = true;
  resultIsError.value = false;
  resultMessage.value = "";
  try {
    const response = await createAIContentReport(request);
    const selectedMessageIds = request.items.map((i) => i.messageId);
    resultMessage.value = (t("aiContentReport.success") || "Report submitted. Reference: {reportId}").replace(
      "{reportId}",
      response.reportId
    );
    emit("submitted", { reportId: response.reportId, selectedMessageIds });
  } catch (err) {
    resultIsError.value = true;
    const code = err instanceof Error ? err.message : "unknown";
    resultMessage.value =
      t(`aiContentReport.errors.${code}`) || t("aiContentReport.errors.unknown") || "The report could not be submitted.";
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.conversation-report__opt-in {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 13px;
}
.conversation-report__warn {
  font-size: 12px;
  opacity: 0.85;
  margin: 4px 0 0 24px;
}
.report-notice {
  font-size: 12px;
  opacity: 0.85;
  margin-top: 12px;
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.report-error {
  color: rgb(var(--v-theme-error));
  font-size: 12px;
  margin-top: 6px;
}
.report-result {
  padding: 8px 0;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
