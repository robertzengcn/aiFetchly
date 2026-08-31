<template>
  <v-dialog
    :model-value="modelValue"
    max-width="640"
    scrollable
    @update:model-value="onToggle"
  >
    <v-card data-testid="ai-content-report-dialog">
      <v-card-title
        id="ai-content-report-dialog-title"
        ref="titleRef"
        tabindex="-1"
      >
        {{ titleText }}
      </v-card-title>
      <v-card-text>
        <!-- Read-only, escaped preview. NEVER v-html (PRD FR-2.2, §14.5). -->
        <div v-if="previewText" class="report-preview">
          <div class="report-preview__label">
            {{ outputPreviewLabel }}
          </div>
          <div class="report-preview__text">{{ previewText }}</div>
        </div>

        <!-- Image thumbnails with selection (PRD FR-2.7). -->
        <div
          v-if="hasImages"
          class="report-images"
        >
          <div class="report-images__label">{{ imagesLabel }}</div>
          <div class="report-images__grid">
            <label
              v-for="(img, index) in images"
              :key="index"
              class="report-images__item"
            >
              <input
                type="checkbox"
                :checked="selectedImageIndices.has(index)"
                :aria-label="imageAltLabel(index)"
                @change="toggleImage(index)"
              />
              <img
                v-if="img.dataBase64"
                :src="`data:${img.mimeType || 'image/png'};base64,${img.dataBase64}`"
                :alt="imageAltLabel(index)"
                class="report-images__thumb"
                loading="lazy"
              />
              <span v-else class="report-images__placeholder">
                {{ imageUnavailableText }}
              </span>
            </label>
          </div>
          <div v-if="imageSelectionError" class="report-error" aria-live="polite">
            {{ imageSelectionError }}
          </div>
        </div>

        <!-- Category select (required, PRD FR-2.3). -->
        <v-select
          v-model="category"
          :items="categoryItems"
          :label="categoryLabel"
          item-title="label"
          item-value="value"
          density="compact"
          class="mt-3"
          :error-messages="categoryError ? [categoryError] : []"
          aria-required="true"
        />

        <!-- Optional explanation (PRD FR-2.4). -->
        <v-textarea
          v-model="comment"
          :label="commentLabel"
          density="compact"
          rows="3"
          counter="2000"
          maxlength="2000"
          auto-grow
          class="mt-2"
        />

        <!-- Transmission notice (PRD FR-2.5, §11.1). -->
        <div class="report-notice">
          <v-icon size="small" start>mdi-shield-lock-outline</v-icon>
          <span>{{ consentText }}</span>
        </div>
        <a
          v-if="privacyPolicyUrl"
          :href="privacyPolicyUrl"
          target="_blank"
          rel="noreferrer"
          class="report-privacy-link"
        >
          {{ privacyPolicyLabel }}
        </a>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="submitting" @click="onCancel">
          {{ cancelText }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="submitting"
          :disabled="submitting"
          @click="onSubmit"
        >
          {{ submitText }}
        </v-btn>
      </v-card-actions>

      <!-- Result / error region, announced to assistive tech (PRD §11.5). -->
      <div v-if="resultMessage" class="report-result" aria-live="polite" role="status">
        <v-icon
          :color="resultIsError ? 'error' : 'success'"
          size="small"
          start
        >
          {{ resultIsError ? "mdi-alert-circle" : "mdi-check-circle" }}
        </v-icon>
        <span>{{ resultMessage }}</span>
        <v-btn
          v-if="!resultIsError && reportId"
          variant="text"
          size="small"
          @click="copyReference"
        >
          {{ copyReferenceText }}
        </v-btn>
        <v-btn
          v-if="resultIsError"
          variant="text"
          size="small"
          @click="onSubmit"
        >
          {{ tryAgainText }}
        </v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { createAIContentReport } from "@/views/api/aiContentReport";
import { encodeReportImagePreview } from "./AIContentReportImageEncoder";
import type { ReportableOutputDescriptor } from "./reportableOutput";
import {
  AI_CONTENT_REPORT_CATEGORIES,
  type AIContentReportCategory,
  type AIContentReportErrorCode,
  type CreateAIContentReportRequest,
} from "@/entityTypes/aiContentReportTypes";

const props = defineProps<{
  modelValue: boolean;
  descriptor: ReportableOutputDescriptor | null;
  /** Optional privacy-policy URL (PRD FR-2.6). Not a precondition. */
  privacyPolicyUrl?: string;
  /**
   * The element that opened the dialog, so focus can be restored to it on
   * close (PRD §11.3). Passed by the parent via the button ref.
   */
  activatorEl?: HTMLElement | null;
}>();
const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "submitted", reportId: string): void;
}>();
const { t } = useI18n();

// Focus management (PRD §11.3): focus the title on open, restore to the
// originating Report button on close.
const titleRef = ref<{ $el?: HTMLElement } | null>(null);
let lastFocusedEl: HTMLElement | null = null;

const category = ref<AIContentReportCategory | null>(null);
const comment = ref("");
const submitting = ref(false);
const resultMessage = ref("");
const resultIsError = ref(false);
const reportId = ref<string | null>(null);
const clientReportId = ref<string>("");
const selectedImageIndices = ref<Set<number>>(new Set());
const categoryError = ref("");
const imageSelectionError = ref("");

const MAX_COMMENT = 2000;

const titleText = computed(() => t("aiContentReport.dialogTitle") || "Report AI output");
const outputPreviewLabel = computed(
  () => t("aiContentReport.outputPreview") || "AI output"
);
const imagesLabel = computed(() => t("aiContentReport.imagesLabel") || "Images");
const categoryLabel = computed(
  () => t("aiContentReport.categoryLabel") || "What is wrong with this output?"
);
const commentLabel = computed(
  () => t("aiContentReport.commentLabel") || "Additional details (optional)"
);
const consentText = computed(
  () =>
    t("aiContentReport.consent") ||
    "The selected AI output and your description will be sent to AiFetchly for review. Your prompt, other messages, files, and AI reasoning will not be included."
);
const privacyPolicyLabel = computed(
  () => t("aiContentReport.privacyPolicy") || "Privacy policy"
);
const submitText = computed(() => t("aiContentReport.submit") || "Submit report");
const cancelText = computed(() => t("aiContentReport.cancel") || "Cancel");
const copyReferenceText = computed(
  () => t("aiContentReport.copyReference") || "Copy reference"
);
const tryAgainText = computed(() => t("aiContentReport.tryAgain") || "Try again");
const imageUnavailableText = computed(
  () =>
    t("aiContentReport.imageUnavailable") ||
    "This image could not be attached. You can still submit the report with your description."
);

const previewText = computed(() => {
  const text = props.descriptor?.text;
  if (!text) return "";
  // Preview is bounded for display; service re-truncates for transmission.
  const PREVIEW_LIMIT = 1000;
  return text.length > PREVIEW_LIMIT
    ? `${text.slice(0, PREVIEW_LIMIT)}…`
    : text;
});

const images = computed(() => props.descriptor?.images ?? []);
const hasImages = computed(() => images.value.length > 0);

const categoryItems = computed(() =>
  AI_CONTENT_REPORT_CATEGORIES.map((value) => ({
    value,
    label: t(`aiContentReport.categories.${value}`) || value,
  }))
);

function imageAltLabel(index: number): string {
  const base = t("aiContentReport.imageAlt") || "Generated image {n}";
  return base.replace("{n}", String(index + 1));
}

function toggleImage(index: number): void {
  const next = new Set(selectedImageIndices.value);
  if (next.has(index)) {
    next.delete(index);
  } else {
    next.add(index);
  }
  selectedImageIndices.value = next;
  imageSelectionError.value = "";
}

// Generate clientReportId ONCE per dialog open; reuse on retry (PRD §13.2,
// FR-4.8). Reset form state on each open. Manage focus on open/close (§11.3).
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      lastFocusedEl =
        (document.activeElement as HTMLElement | null) ?? props.activatorEl ?? null;
      clientReportId.value = generateClientReportId();
      category.value = null;
      comment.value = "";
      resultMessage.value = "";
      resultIsError.value = false;
      reportId.value = null;
      categoryError.value = "";
      imageSelectionError.value = "";
      // Analytics: report opened. Metadata-only — no report content
      // (PRD §15, §14.3). A future analytics sink can subscribe to the
      // `[analytics]` console prefix.
      const d = props.descriptor;
      if (d) {
        // eslint-disable-next-line no-console
        console.info("[analytics] ai_content_report_opened", {
          surface: d.surface,
          contentType: d.contentType,
        });
      }
      // Default-select EVERY available image, including a single one (PRD
      // §9.2: thumbnails with each image selected by default). The user may
      // deselect extras when there are multiple, but at least one must remain.
      const imgCount = props.descriptor?.images?.length ?? 0;
      selectedImageIndices.value = new Set(
        Array.from({ length: imgCount }, (_, i) => i)
      );
      // Move focus to the dialog title on open (PRD §11.3). nextTick lets
      // Vuetify mount the card before we focus it.
      nextTick(() => {
        const el = titleRef.value?.$el ?? null;
        el?.focus?.();
      });
    } else {
      // Closing (cancel, overlay, or post-success dismiss) restores focus to
      // the originating Report button (PRD §11.3).
      const target = lastFocusedEl ?? props.activatorEl ?? null;
      target?.focus?.();
      lastFocusedEl = null;
    }
  }
);

function generateClientReportId(): string {
  // crypto.randomUUID is available in the renderer (secure context).
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback RFC4122-ish (should not occur in Electron renderer).
  return `cr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function onToggle(v: boolean): void {
  emit("update:modelValue", v);
}

function onCancel(): void {
  // Closing before submission sends nothing (PRD FR-2.8).
  emit("update:modelValue", false);
}

async function onSubmit(): Promise<void> {
  if (!props.descriptor) return;
  categoryError.value = "";
  imageSelectionError.value = "";

  if (!category.value) {
    categoryError.value =
      t("aiContentReport.errors.categoryRequired") || "Please choose a category.";
    return;
  }

  // Build image previews for the selected images.
  const imageSources = props.descriptor.images ?? [];
  const selectedIndices = Array.from(selectedImageIndices.value).sort();
  const previews: CreateAIContentReportRequest["output"]["imagePreviews"] = [];
  let evidenceUnavailable = false;
  if (imageSources.length > 0 && selectedIndices.length === 0) {
    imageSelectionError.value =
      t("aiContentReport.errors.imageRequired") ||
      "Select at least one image to report.";
    return;
  }
  for (const idx of selectedIndices) {
    const src = imageSources[idx];
    if (!src) continue;
    const preview = await encodeReportImagePreview({
      dataBase64: src.dataBase64,
      mimeType: src.mimeType,
    });
    if (preview) {
      previews.push(preview);
    } else {
      evidenceUnavailable = true;
      resultIsError.value = false;
      // Surface the "image could not be attached" notice (PRD FR-3.7).
      resultMessage.value = imageUnavailableText.value;
    }
  }

  const text = props.descriptor.text ?? undefined;
  const hasNoEvidence =
    !text &&
    previews.length === 0 &&
    !evidenceUnavailable;
  if (hasNoEvidence && (!comment.value || comment.value.trim().length === 0)) {
    resultIsError.value = true;
    resultMessage.value =
      t("aiContentReport.errors.noEvidence") ||
      "Add a description so the report can be submitted.";
    return;
  }

  submitting.value = true;
  resultMessage.value = evidenceUnavailable ? imageUnavailableText.value : "";
  resultIsError.value = false;

  const request: CreateAIContentReportRequest = {
    schemaVersion: 1,
    clientReportId: clientReportId.value,
    surface: props.descriptor.surface,
    contentType: props.descriptor.contentType,
    category: category.value,
    comment: comment.value.trim() ? comment.value.slice(0, MAX_COMMENT) : undefined,
    output: {
      text,
      imagePreviews: previews.length > 0 ? previews : undefined,
      evidenceUnavailable: evidenceUnavailable || undefined,
    },
    context: {
      conversationId: props.descriptor.context.conversationId,
      messageId: props.descriptor.context.messageId,
      artifactId: props.descriptor.context.artifactId,
      model: props.descriptor.context.model,
      generatedAt: props.descriptor.context.generatedAt,
      appVersion: "unknown", // filled by main-process service
      platform: "win32", // filled by main-process service
      locale: useI18n().locale.value || "en-US",
    },
  };

  try {
    const response = await createAIContentReport(request);
    reportId.value = response.reportId;
    resultIsError.value = false;
    resultMessage.value =
      (t("aiContentReport.success") || "Report submitted. Reference: {reportId}")
        .replace("{reportId}", response.reportId);
    emit("submitted", response.reportId);
    // Keep the dialog open to show the reference; close after a short delay
    // is avoided so the user can copy the reference (PRD FR-5.2).
  } catch (err) {
    const code = resolveErrorCode(err);
    resultIsError.value = true;
    resultMessage.value = errorText(code);
  } finally {
    submitting.value = false;
  }
}

const VALID_ERROR_CODES: readonly AIContentReportErrorCode[] = [
  "network",
  "auth_failed",
  "invalid_evidence",
  "payload_too_large",
  "rate_limited",
  "service_disabled",
  "server_error",
  "unknown",
];

function resolveErrorCode(err: unknown): AIContentReportErrorCode {
  // The service throws AIContentReportError whose .message IS the code (e.g.
  // "rate_limited"). registerValidatedHandler extracts err.message into
  // envelope.msg, and windowInvoke re-throws it. So the thrown message is
  // the structured code itself — check for an exact match first.
  const message = err instanceof Error ? err.message : String(err);
  if ((VALID_ERROR_CODES as readonly string[]).includes(message)) {
    return message as AIContentReportErrorCode;
  }
  // Fallback: best-effort text matching for any unexpected message shape.
  const m = message.toLowerCase();
  if (m.includes("rate") || m.includes("429")) return "rate_limited";
  if (m.includes("network") || m.includes("fetch")) return "network";
  if (m.includes("auth")) return "auth_failed";
  if (m.includes("too large") || m.includes("413")) return "payload_too_large";
  if (m.includes("disabled") || m.includes("503")) return "service_disabled";
  if (m.includes("invalid") || m.includes("400") || m.includes("422"))
    return "invalid_evidence";
  if (m.includes("server") || m.includes("500")) return "server_error";
  return "unknown";
}

function errorText(code: AIContentReportErrorCode): string {
  // t() returns the translated string for a leaf key; the English fallback
  // is the second arg. tm() is wrong here because these keys map to strings,
  // not objects.
  return (
    t(`aiContentReport.errors.${code}`) ||
    (code === "rate_limited"
      ? "Too many reports were submitted. Please try again later."
      : code === "auth_failed"
        ? "Authentication failed. Your details have been kept so you can try again."
        : code === "service_disabled"
          ? "Reporting is temporarily unavailable. Please try again later."
          : "The report could not be submitted. Your details have been kept so you can try again.")
  );
}

function copyReference(): void {
  if (!reportId.value) return;
  try {
    navigator.clipboard?.writeText(reportId.value);
  } catch {
    // Clipboard may be unavailable; ignore silently.
  }
}
</script>

<style scoped>
.report-preview {
  background: rgba(0, 0, 0, 0.03);
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 12px;
}
.report-preview__label {
  font-size: 12px;
  opacity: 0.7;
  margin-bottom: 4px;
}
.report-preview__text {
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow-y: auto;
}
.report-images {
  margin-bottom: 12px;
}
.report-images__label {
  font-size: 12px;
  opacity: 0.7;
  margin-bottom: 4px;
}
.report-images__grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.report-images__item {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
.report-images__thumb {
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.15);
}
.report-images__placeholder {
  width: 72px;
  height: 72px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  text-align: center;
  border: 1px dashed rgba(0, 0, 0, 0.25);
  border-radius: 4px;
  padding: 4px;
}
.report-notice {
  font-size: 12px;
  opacity: 0.85;
  margin-top: 12px;
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.report-privacy-link {
  display: inline-block;
  font-size: 12px;
  margin-top: 6px;
  text-decoration: none;
}
.report-error {
  color: rgb(var(--v-theme-error));
  font-size: 12px;
  margin-top: 4px;
}
.report-result {
  padding: 8px 16px 16px;
  font-size: 13px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
