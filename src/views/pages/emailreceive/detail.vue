<template>
  <AppPageShell
    page-id="email-receive-detail"
    title-key="route.email_receive_detail"
    content-width="wide"
  >
    <v-sheet class="mx-auto pa-4" rounded>
    <div class="d-flex align-center mb-4">
      <v-btn color="error" variant="text" @click="goBack">
        <v-icon start>mdi-arrow-left</v-icon>{{ t("common.return") }}
      </v-btn>
      <h2 class="ml-2">{{ message?.subject || t("emailReceive.message_detail") }}</h2>
    </div>

    <v-progress-linear v-if="loading" indeterminate></v-progress-linear>

    <!-- BUG-04: actionable load-failure / invalid-selection states with retry. -->
    <v-alert
      v-if="!loading && loadError"
      type="error"
      variant="tonal"
      class="mb-3"
      role="alert"
      data-testid="detail-load-error"
    >
      {{ t("emailReceive.load_failed") || "The message could not be loaded." }}
      <span v-if="loadErrorDetail" class="text-body-2">({{ loadErrorDetail }})</span>
    </v-alert>
    <v-alert
      v-else-if="!loading && invalidId"
      type="warning"
      variant="tonal"
      class="mb-3"
      role="alert"
      data-testid="detail-invalid-id"
    >{{ t("emailReceive.invalid_message_id") || "This message id is not valid." }}</v-alert>

    <div v-if="!loading && !invalidId && (loadError || !message)" class="mb-3">
      <v-btn
        variant="text"
        color="primary"
        data-testid="detail-retry"
        :loading="loading"
        @click="loadMessage"
      >
        <v-icon start>mdi-refresh</v-icon>{{ t("emailReceive.retry") || "Retry" }}
      </v-btn>
    </div>

    <div v-if="message">
      <!-- Organization actions: forward / trash / restore (Stage B). -->
      <div class="d-flex align-center mb-3" data-testid="email-org-actions">
        <v-btn
          color="primary"
          variant="tonal"
          density="comfortable"
          data-testid="org-forward-button"
          :disabled="!canOrganize"
          @click="openForwardDialog"
        >
          <v-icon start>mdi-forward</v-icon>{{ t("emailOrganization.forward_button") || "Forward" }}
        </v-btn>
        <v-btn
          class="ml-2"
          color="error"
          variant="tonal"
          density="comfortable"
          data-testid="org-trash-button"
          :loading="trashing"
          :disabled="!canOrganize || trashing"
          @click="trashMessage"
        >
          <v-icon start>mdi-delete</v-icon>{{ t("emailOrganization.trash_button") || "Trash" }}
        </v-btn>
        <v-btn
          v-if="lastTrashOperationId"
          class="ml-2"
          color="warning"
          variant="tonal"
          density="comfortable"
          data-testid="org-restore-button"
          :loading="restoring"
          :disabled="restoring"
          @click="restoreLastTrash"
        >
          <v-icon start>mdi-undo</v-icon>{{ t("emailOrganization.undo_action") || "Undo" }}
        </v-btn>
      </div>

      <v-alert
        v-if="actionMessage"
        :type="actionMessageType"
        variant="tonal"
        density="compact"
        class="mb-3"
        role="alert"
        data-testid="email-org-action-message"
      >{{ actionMessage }}</v-alert>

      <EmailOrganizationOperationCard
        v-if="operationCardVisible"
        :operation-id="activeOperationId"
        class="mb-3"
        @restored="onRestored"
      ></EmailOrganizationOperationCard>

      <v-card variant="tonal" class="pa-3 mb-4">
        <div><b>{{ t("emailReceive.from") }}:</b> {{ message.fromName ? message.fromName + " <" + message.fromAddress + ">" : message.fromAddress }}</div>
        <div><b>{{ t("emailReceive.reply_to") }}:</b> {{ message.replyToAddress || "—" }}</div>
        <div><b>{{ t("emailReceive.received_at") }}:</b> {{ formatDate(message.receivedAt) }}</div>
        <div><b>{{ t("emailReceive.classification") }}:</b> {{ classificationLabel }}</div>
        <div><b>{{ t("emailReceive.reply_status") }}:</b> {{ replyStatusLabel }}</div>
        <div v-if="message.threadKey"><b>{{ t("emailReceive.thread_label") || "Thread" }}:</b> {{ message.threadKey }}</div>
      </v-card>

      <!-- Sanitized body. Remote images are NOT loaded automatically. -->
      <v-card v-if="message.bodyHtmlSanitized" variant="outlined" class="pa-3 mb-4">
        <div class="text-subtitle-2 mb-2">{{ t("emailReceive.body_html") }}</div>
        <div class="email-body" v-html="renderedHtml"></div>
      </v-card>
      <v-card v-else-if="message.bodyText" variant="outlined" class="pa-3 mb-4">
        <div class="text-subtitle-2 mb-2">{{ t("emailReceive.body_text") }}</div>
        <pre style="white-space: pre-wrap">{{ message.bodyText }}</pre>
      </v-card>
    </div>
    </v-sheet>

    <EmailForwardReviewDialog
      :message-id="forwardDialogMessageId"
      @closed="forwardDialogMessageId = null"
      @sent="onForwardSent"
      @draft-saved="onDraftSaved"
    ></EmailForwardReviewDialog>
  </AppPageShell>
</template>

<script setup lang="ts">
import AppPageShell from "@/views/components/pageTemplates/AppPageShell.vue";
import EmailForwardReviewDialog from "@/views/components/emailOrganization/EmailForwardReviewDialog.vue";
import EmailOrganizationOperationCard from "@/views/components/emailOrganization/EmailOrganizationOperationCard.vue";
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { getReceivedMessage } from "@/views/api/emailreceive";
import {
  moveMessageToTrash,
  restoreFromOperation,
} from "@/views/api/emailorganization";
import type { ReceivedMessageDetailDto } from "@/entityTypes/emailReceiveTypes";
import type { SendForwardResultDto } from "@/views/api/emailorganization";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const message = ref<ReceivedMessageDetailDto | null>(null);
const loading = ref(true);

const forwardDialogMessageId = ref<number | null>(null);
const trashing = ref(false);
const restoring = ref(false);
const actionMessage = ref<string | null>(null);
const actionMessageType = ref<"success" | "error" | "warning" | "info">("info");
const activeOperationId = ref<string | null>(null);
const lastTrashOperationId = ref<string | null>(null);
const operationCardVisible = ref(false);

const canOrganize = computed(() => message.value !== null && !loading.value);

/**
 * Render sanitized HTML with remote images disabled (tracking-pixel defense).
 * The stored body is already sanitized server-side; we additionally strip
 * src attributes so no remote image loads until the user opts in.
 */
const renderedHtml = computed(() => {
  const html = message.value?.bodyHtmlSanitized;
  if (!html) return "";
  return html.replace(/<img[^>]*>/gi, t("emailReceive.image_hidden") || "[image hidden]");
});

const invalidId = ref(false);
const loadError = ref(false);
const loadErrorDetail = ref<string | null>(null);

// Displayed enum states go through i18n keys; unknown values fall back to
// the raw stored value so nothing renders as a bare key.
const classificationLabel = computed(() => {
  const value = message.value?.classification;
  if (!value) return "—";
  return t(`emailReceive.classification_state.${value}`) || value;
});
const replyStatusLabel = computed(() => {
  const value = message.value?.replyStatus;
  if (!value) return "—";
  return t(`emailReceive.status.${value}`) || value;
});

async function loadMessage(): Promise<void> {
  const id = Number(route.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    invalidId.value = true;
    loading.value = false;
    return;
  }
  loading.value = true;
  loadError.value = false;
  loadErrorDetail.value = null;
  try {
    message.value = await getReceivedMessage(id, true);
  } catch (err) {
    console.error("Failed to load message:", err);
    loadError.value = true;
    loadErrorDetail.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadMessage();
});

function goBack() {
  router.push({ name: "Email_Receive_List", query: route.query });
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function setActionMessage(text: string, type: "success" | "error" | "warning" | "info"): void {
  actionMessage.value = text;
  actionMessageType.value = type;
}

function openForwardDialog(): void {
  if (message.value === null) return;
  forwardDialogMessageId.value = message.value.id;
}

async function trashMessage(): Promise<void> {
  if (message.value === null) return;
  trashing.value = true;
  actionMessage.value = null;
  try {
    const result = await moveMessageToTrash(message.value.id);
    activeOperationId.value = result.operationId;
    operationCardVisible.value = true;
    if (result.success) {
      lastTrashOperationId.value = result.operationId;
      setActionMessage(
        t("emailOrganization.trash_success") || "Moved to Trash. You can undo this from here.",
        "success"
      );
    } else if (result.status === "needs_reconciliation") {
      setActionMessage(
        t("emailOrganization.outcome_unknown") ||
          "Outcome unknown; checking the mailbox. You can check status below.",
        "warning"
      );
    } else {
      setActionMessage(
        `${t("emailOrganization.action_failed") || "Action failed"}: ${result.errorCode ?? result.status}`,
        "error"
      );
    }
  } catch (error) {
    setActionMessage(error instanceof Error ? error.message : String(error), "error");
  } finally {
    trashing.value = false;
  }
}

async function restoreLastTrash(): Promise<void> {
  if (lastTrashOperationId.value === null) return;
  restoring.value = true;
  actionMessage.value = null;
  try {
    const result = await restoreFromOperation(lastTrashOperationId.value);
    activeOperationId.value = result.operationId;
    operationCardVisible.value = true;
    if (result.success) {
      lastTrashOperationId.value = null;
      setActionMessage(
        t("emailOrganization.restore_success") || "Restored to its original folder.",
        "success"
      );
    } else {
      setActionMessage(
        `${t("emailOrganization.action_failed") || "Action failed"}: ${result.errorCode ?? result.status}`,
        "error"
      );
    }
  } catch (error) {
    setActionMessage(error instanceof Error ? error.message : String(error), "error");
  } finally {
    restoring.value = false;
  }
}

function onForwardSent(result: SendForwardResultDto): void {
  forwardDialogMessageId.value = null;
  if (result.status === "submitted") {
    setActionMessage(
      t("emailOrganization.forward_submitted") ||
        "Forward submitted. Delivery depends on the receiving server.",
      "success"
    );
  } else if (result.status === "outcome_unknown") {
    setActionMessage(
      t("emailOrganization.outcome_unknown") || "Outcome unknown; checking the mailbox.",
      "warning"
    );
  } else if (result.status === "already_processed") {
    setActionMessage(
      t("emailOrganization.already_submitted") || "This forward was already submitted.",
      "info"
    );
  } else {
    setActionMessage(
      `${t("emailOrganization.action_failed") || "Action failed"}: ${result.code ?? result.status}`,
      "error"
    );
  }
}

function onDraftSaved(): void {
  setActionMessage(
    t("emailOrganization.draft_saved") || "Forward draft saved. Reopen Forward to review and send it.",
    "info"
  );
}

function onRestored(): void {
  lastTrashOperationId.value = null;
}
</script>
<style scoped>
.email-body {
  max-height: 480px;
  overflow-y: auto;
}
</style>
