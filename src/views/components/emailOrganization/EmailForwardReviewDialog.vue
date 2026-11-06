<template>
  <v-dialog
    :model-value="messageId !== null"
    persistent
    max-width="720"
    @update:model-value="onDialogToggle"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon start>mdi-forward</v-icon>
        {{ t("emailOrganization.forward_dialog_title") || "Forward email" }}
      </v-card-title>
      <v-card-text>
        <v-progress-linear v-if="loading" indeterminate class="mb-3"></v-progress-linear>

        <v-alert
          v-if="errorMessage"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-3"
          role="alert"
        >{{ errorMessage }}</v-alert>
        <v-alert
          v-else-if="preview && preview.expired"
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-3"
          role="alert"
        >{{ t("emailOrganization.draft_expired") || "The draft content expired. Cancel and reopen to refresh it." }}</v-alert>

        <template v-if="preview && !preview.expired">
          <div class="mb-2 text-body-2">
            <b>{{ t("emailOrganization.from_identity") || "Send as" }}:</b>
            {{ preview.fromName ? preview.fromName + " <" + preview.fromAddress + ">" : preview.fromAddress }}
            <span class="ml-2 text-medium-emphasis">({{ t("emailOrganization.source_account") || "source account" }}: #{{ preview.sourceEmailServiceId }})</span>
          </div>

          <v-text-field
            v-model="toInput"
            :label="t('emailOrganization.to_recipients') || 'To (comma-separated addresses)'"
            density="compact"
            hide-details="auto"
            class="mb-2"
            :disabled="submitting"
          ></v-text-field>
          <v-text-field
            v-model="ccInput"
            :label="t('emailOrganization.cc_recipients') || 'Cc (optional)'"
            density="compact"
            hide-details="auto"
            class="mb-2"
            :disabled="submitting"
          ></v-text-field>
          <v-text-field
            v-model="bccInput"
            :label="t('emailOrganization.bcc_recipients') || 'Bcc (optional, private)'"
            density="compact"
            hide-details="auto"
            class="mb-2"
            :disabled="submitting"
          ></v-text-field>
          <v-text-field
            v-model="subjectInput"
            :label="t('emailOrganization.subject_label') || 'Subject'"
            density="compact"
            hide-details="auto"
            class="mb-2"
            :disabled="submitting"
          ></v-text-field>
          <v-textarea
            v-model="noteInput"
            :label="t('emailOrganization.note_label') || 'Add a note (optional)'"
            rows="2"
            density="compact"
            hide-details="auto"
            class="mb-2"
            :disabled="submitting"
          ></v-textarea>

          <div v-if="preview.attachmentManifest.length > 0" class="mb-2">
            <div class="text-subtitle-2">
              {{ t("emailOrganization.attachments_header") || "Attachments" }}
              <span class="text-medium-emphasis">
                ({{ selectedAttachmentCount }}/{{ preview.attachmentManifest.length }},
                {{ formattedSelectedBytes }})
              </span>
            </div>
            <v-checkbox
              v-for="entry in preview.attachmentManifest"
              :key="entry.partId"
              v-model="selectedPartIds"
              :value="entry.partId"
              density="compact"
              hide-details
              :disabled="submitting"
              :label="`${entry.displayName} (${entry.contentType ?? 'unknown'}, ${formatBytes(entry.decodedSize)})`"
            ></v-checkbox>
          </div>

          <div
            v-if="preview.validationFindings.length > 0"
            class="text-caption text-warning mb-1"
            data-testid="forward-findings"
          >
            {{ t("emailOrganization.findings_header") || "Content findings:" }}
            {{ preview.validationFindings.join(", ") }}
          </div>
          <div class="text-subtitle-2 mb-1">
            {{ t("emailOrganization.preview_header") || "Preview" }}
            <span
              v-if="preview.bodyPreviewText.length >= 4000"
              class="text-medium-emphasis text-caption"
            >
              {{ t("emailOrganization.preview_truncated") || "(truncated preview)" }}
            </span>
          </div>
          <v-card variant="outlined" class="pa-2 preview-scroll">
            <pre style="white-space: pre-wrap; margin: 0">{{ preview.bodyPreviewText }}</pre>
          </v-card>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn
          variant="text"
          :disabled="loading || submitting"
          @click="cancel"
        >{{ t("emailOrganization.cancel_button") || "Cancel" }}</v-btn>
        <v-btn
          variant="text"
          color="primary"
          :disabled="loading || submitting || !preview || preview.expired"
          :loading="savingDraft"
          @click="saveDraft"
        >{{ t("emailOrganization.save_draft_button") || "Save draft" }}</v-btn>
        <v-btn
          color="primary"
          :disabled="!canSend"
          :loading="submitting"
          @click="send"
        >{{ t("emailOrganization.send_button") || "Send forward" }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  createForwardDraft,
  getForwardDraftDetail,
  updateForwardDraft,
  authorizeForwardRevision,
  sendApprovedForward,
  discardForwardDraft,
  type ForwardDraftPreviewDto,
  type SendForwardResultDto,
} from "@/views/api/emailorganization";

const props = defineProps<{
  /** When non-null, the dialog is open for this received message. */
  messageId: number | null;
  /** R11: an existing saved draft resumes here instead of creating anew. */
  existingDraftId?: number | null;
}>();

const emit = defineEmits<{
  (event: "closed"): void;
  (event: "sent", result: SendForwardResultDto): void;
  (event: "draft-saved", draftId: number): void;
}>();

const { t, locale } = useI18n();

const loading = ref(false);
const submitting = ref(false);
const savingDraft = ref(false);
const errorMessage = ref<string | null>(null);
const preview = ref<ForwardDraftPreviewDto | null>(null);
const draftId = ref<number | null>(null);

const toInput = ref("");
const ccInput = ref("");
const bccInput = ref("");
const subjectInput = ref("");
const noteInput = ref("");
const selectedPartIds = ref<string[]>([]);

const selectedAttachmentCount = computed(
  () => preview.value?.attachmentManifest.filter((entry) => selectedPartIds.value.includes(entry.partId)).length ?? 0
);

const formattedSelectedBytes = computed(() => {
  const bytes = preview.value?.attachmentManifest
    .filter((entry) => selectedPartIds.value.includes(entry.partId))
    .reduce((sum, entry) => sum + entry.decodedSize, 0) ?? 0;
  return formatBytes(bytes);
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

const canSend = computed(() => {
  if (loading.value || submitting.value || !preview.value || preview.value.expired) return false;
  return parseAddresses(toInput.value).length > 0;
});

function parseAddresses(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

watch(
  () => props.messageId,
  async (messageId) => {
    if (messageId === null) return;
    void openForMessage(messageId);
  },
  { immediate: true }
);

async function openForMessage(messageId: number): Promise<void> {
  loading.value = true;
  errorMessage.value = null;
  preview.value = null;
  draftId.value = null;
  try {
    // R11: a saved draft resumes — never silently replaced by a new one.
    if (props.existingDraftId !== undefined && props.existingDraftId !== null) {
      const existing = await getForwardDraftDetail(props.existingDraftId);
      draftId.value = existing.draftId;
      applyPreview(existing);
      toInput.value = existing.to.join(", ");
      ccInput.value = existing.cc.join(", ");
      bccInput.value = existing.bcc.join(", ");
      selectedPartIds.value = existing.attachmentManifest
        .filter((entry: { selected: boolean }) => entry.selected)
        .map((entry: { partId: string }) => entry.partId);
      return;
    }
    const created = await createForwardDraft({
      messageId,
      // R4-16: generated headers use the active UI locale.
      locale: locale.value as "en" | "zh" | "es" | "fr" | "de" | "ja",
      attachments: { mode: "all" },
    });
    draftId.value = created.draftId;
    applyPreview(created);
    selectedPartIds.value = created.attachmentManifest
      .filter((entry) => entry.selected)
      .map((entry) => entry.partId);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

function applyPreview(next: ForwardDraftPreviewDto): void {
  preview.value = next;
  subjectInput.value = next.subject;
  noteInput.value = next.note ?? "";
}

async function refreshDraftWithBcc(): Promise<ForwardDraftPreviewDto | null> {
  if (draftId.value === null) return null;
  const updated = await updateForwardDraft({
    draftId: draftId.value,
    expectedRevisionId: preview.value?.revisionId ?? 0,
    to: parseAddresses(toInput.value),
    cc: parseAddresses(ccInput.value),
    bcc: parseAddresses(bccInput.value),
    subject: subjectInput.value,
    note: noteInput.value === "" ? null : noteInput.value,
    attachments:
      selectedPartIds.value.length ===
      (preview.value?.attachmentManifest.length ?? -1)
        ? { mode: "all" }
        : selectedPartIds.value.length === 0
          ? { mode: "none" }
          : { mode: "parts", partIds: selectedPartIds.value },
  });
  applyPreview(updated);
  return updated;
}

async function send(): Promise<void> {
  if (draftId.value === null) return;
  submitting.value = true;
  errorMessage.value = null;
  try {
    // Bcc participates in the approved payload (private review, envelope-only).
    const refreshed = await refreshDraftWithBcc();
    if (!refreshed) return;
    // One-time hash-bound authorization for the exact displayed revision.
    const authorization = await authorizeForwardRevision({
      draftId: refreshed.draftId,
      revisionId: refreshed.revisionId,
    });
    const result = await sendApprovedForward({
      draftId: refreshed.draftId,
      revisionId: refreshed.revisionId,
      authorizationId: authorization.authorizationId,
    });
    emit("sent", result);
    close();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    submitting.value = false;
  }
}

async function saveDraft(): Promise<void> {
  if (draftId.value === null) return;
  savingDraft.value = true;
  errorMessage.value = null;
  try {
    await refreshDraftWithBcc();
    emit("draft-saved", draftId.value);
    close();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    savingDraft.value = false;
  }
}

async function cancel(): Promise<void> {
  if (draftId.value !== null) {
    try {
      await discardForwardDraft(draftId.value);
    } catch {
      // Discard is best-effort on cancel.
    }
  }
  close();
}

function close(): void {
  preview.value = null;
  draftId.value = null;
  errorMessage.value = null;
  toInput.value = "";
  ccInput.value = "";
  bccInput.value = "";
  emit("closed");
}

function onDialogToggle(value: boolean): void {
  if (value === false) void cancel();
}
</script>

<style scoped>
.preview-scroll {
  max-height: 240px;
  overflow-y: auto;
}
</style>
