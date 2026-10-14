<template>
  <v-sheet class="mx-auto pa-4" rounded>
    <div class="d-flex align-center mb-4">
      <v-btn color="error" variant="text" @click="router.go(-1)">
        <v-icon start>mdi-arrow-left</v-icon>{{ t("common.return") }}
      </v-btn>
      <h2 class="ml-2">{{ t("emailAutoReplyAudit.detail_title") }}</h2>
    </div>

    <v-progress-linear v-if="loading" indeterminate></v-progress-linear>

    <div v-if="audit">
      <v-row>
        <v-col cols="12" md="6">
          <v-card variant="tonal" class="pa-3">
            <div class="text-subtitle-2">{{ t("emailAutoReplyAudit.decision_status") }}</div>
            <v-chip :color="statusColor" size="small">
              {{ t("emailAutoReplyAudit.status." + audit.decisionStatus) || audit.decisionStatus }}
            </v-chip>
            <div class="mt-2 text-subtitle-2">{{ t("emailAutoReplyAudit.classification") }}</div>
            <div>{{ audit.classification || "—" }}</div>
            <div class="mt-2 text-subtitle-2">{{ t("emailAutoReplyAudit.confidence") }}</div>
            <div>{{ audit.confidence != null ? (audit.confidence * 100).toFixed(0) + "%" : "—" }}</div>
            <div class="mt-2 text-subtitle-2">{{ t("emailAutoReplyAudit.reason") }}</div>
            <div>{{ audit.reason || "—" }}</div>
            <div v-if="audit.metadataCode" class="mt-2">
              <div class="text-subtitle-2">{{ t("emailAutoReplyAudit.reply_evidence") }}</div>
              <div class="d-flex align-center flex-wrap">
                <v-chip
                  :color="evidenceColor(audit.metadataCode)"
                  size="small"
                  data-testid="audit-detail-evidence-chip"
                >
                  {{ evidenceLabel(audit.metadataCode) }}
                </v-chip>
                <v-chip
                  v-if="nextAction !== 'no_action'"
                  class="ml-2"
                  size="small"
                  variant="outlined"
                >
                  {{ t("emailReply.nextAction." + nextAction) }}
                </v-chip>
              </div>
              <div
                v-if="audit.metadataStage"
                class="mt-1 text-caption text-medium-emphasis"
                data-testid="audit-detail-stage"
              >
                {{ t("emailAutoReplyAudit.stage") }}: {{ audit.metadataStage }}
              </div>
            </div>
            <div class="mt-2 text-subtitle-2">{{ t("emailAutoReplyAudit.requires_approval") }}</div>
            <div>
              <v-icon :color="audit.requiresUserApproval ? 'warning' : 'success'">
                {{ audit.requiresUserApproval ? "mdi-account-check" : "mdi-flash" }}
              </v-icon>
            </div>
            <div v-if="audit.errorMessage" class="mt-2">
              <v-alert type="error" density="compact">{{ audit.errorMessage }}</v-alert>
            </div>
          </v-card>
        </v-col>
        <v-col cols="12" md="6">
          <v-card variant="tonal" class="pa-3">
            <div class="text-subtitle-2">{{ t("emailAutoReplyAudit.knowledge_query") }}</div>
            <div class="text-body-2">{{ audit.knowledgeQuery || "—" }}</div>
            <div class="mt-2 text-subtitle-2">{{ t("emailAutoReplyAudit.knowledge_source_count") }}</div>
            <div>{{ audit.knowledgeSourceCount }}</div>
            <div class="mt-2 text-subtitle-2">{{ t("emailAutoReplyAudit.created_at") }}</div>
            <div>{{ formatDate(audit.createdAt) }}</div>
          </v-card>
        </v-col>
      </v-row>

      <v-card v-if="audit.generatedSubject" variant="outlined" class="pa-3 mt-4">
        <div class="d-flex align-center justify-space-between">
          <div class="text-subtitle-2">{{ t("emailAutoReplyAudit.generated_subject") }}</div>
          <AIContentReportButton
            v-if="replyReportDescriptor"
            :descriptor="replyReportDescriptor"
            :reported="replyReported"
            @report="replyReportDialog = true"
          />
        </div>
        <div>{{ audit.generatedSubject }}</div>
        <div class="text-subtitle-2 mt-2">{{ t("emailAutoReplyAudit.generated_body_preview") }}</div>
        <pre class="text-body-2">{{ audit.generatedBodyPreview || "—" }}</pre>
      </v-card>

      <v-card v-if="audit.sentSubject" variant="outlined" class="pa-3 mt-4">
        <div class="text-subtitle-2">{{ t("emailAutoReplyAudit.sent_subject") }}</div>
        <div>{{ audit.sentSubject }}</div>
        <div class="text-subtitle-2 mt-2">{{ t("emailAutoReplyAudit.sent_body_preview") }}</div>
        <pre class="text-body-2">{{ audit.sentBodyPreview || "—" }}</pre>
      </v-card>

      <!-- T10 (FR-032): diagnostic reply recheck via the AI-gated
           EMAIL_REPLY_CHECK_REPLIED channel. Read-only. -->
      <v-card variant="outlined" class="pa-3 mt-4">
        <div class="d-flex align-center flex-wrap">
          <v-btn
            color="primary"
            variant="tonal"
            size="small"
            :loading="recheckLoading"
            :disabled="recheckLoading"
            data-testid="audit-detail-recheck"
            @click="recheckReplyStatus"
          >
            {{ t("emailReply.replyDetection.check_button") }}
          </v-btn>
          <v-chip
            v-if="recheckResult"
            class="ml-2"
            :color="detectionStateColor(recheckResult.state)"
            size="small"
            data-testid="audit-detail-recheck-result"
          >
            {{ detectionStateLabel(recheckResult.state) }}
          </v-chip>
          <span
            v-if="recheckError"
            class="ml-2 text-caption text-error"
            data-testid="audit-detail-recheck-error"
          >
            {{ recheckError }}
          </span>
        </div>
        <div v-if="recheckResult" class="mt-2 text-caption text-medium-emphasis">
          <span v-if="recheckResult.checked_at">
            {{ t("emailReply.replyDetection.checked_at") }}: {{ formatDate(recheckResult.checked_at) }}
          </span>
          <span v-if="recheckResult.coverage" class="ml-2">
            {{ coverageLabel(recheckResult.coverage) }}
          </span>
        </div>
      </v-card>
    </div>
  </v-sheet>

  <!-- AI Content Report dialog (PRD §8.2 automatic email reply surface) -->
  <AIContentReportDialog
    v-model="replyReportDialog"
    :descriptor="replyReportDescriptor"
    :privacy-policy-url="AIFETCHLY_PRIVACY_POLICY_URL"
    @submitted="replyReported = true"
  />
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { getAutoReplyAuditLog, checkEmailReplied } from "@/views/api/emailreply";
import { nextActionForCode } from "@/service/emailReply/EmailReplyNextAction";
import type { AutoReplyAuditDto } from "@/entityTypes/emailReceiveTypes";
import type { CheckEmailRepliedResult } from "@/service/emailReceive/EmailReplyDetectionTypes";
import AIContentReportButton from "@/views/components/aiContentReport/AIContentReportButton.vue";
import AIContentReportDialog from "@/views/components/aiContentReport/AIContentReportDialog.vue";
import { buildAutoReplyDescriptor } from "@/views/components/aiContentReport/reportableOutput";
import { AIFETCHLY_PRIVACY_POLICY_URL } from "@/config/appInfo";

const { t } = useI18n({ inheritLocale: true });
const route = useRoute();
const router = useRouter();

const audit = ref<AutoReplyAuditDto | null>(null);
const loading = ref(true);

// T10 (FR-032): diagnostic reply recheck state.
const recheckLoading = ref(false);
const recheckResult = ref<CheckEmailRepliedResult | null>(null);
const recheckError = ref<string | null>(null);

// AI Content Report state (PRD §8.2 automatic email reply surface).
const replyReportDialog = ref(false);
const replyReported = ref(false);
const replyReportDescriptor = computed(() => {
  const a = audit.value;
  if (!a) return null;
  const body = [a.generatedSubject, a.generatedBodyPreview]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join("\n\n");
  return buildAutoReplyDescriptor(body, {
    messageId: String(a.messageId),
    generatedAt: a.createdAt,
  });
});

const statusColor = computed(() => {
  const s = audit.value?.decisionStatus;
  switch (s) {
    case "auto_sent":
      return "success";
    case "draft_created":
      return "info";
    case "approval_required":
    case "needs_human_review":
      return "warning";
    case "blocked":
    case "failed":
      return "error";
    default:
      return "default";
  }
});

/**
 * T10 (FR-033): the typed metadata code is the trusted source for the
 * next-action chip (B12 — derive from the typed store, never parse the
 * English reason text). Delegate to the canonical `nextActionForCode` so
 * the detail page stays in lockstep with the service-layer mapping and
 * the AI tool's next-action hint — never duplicate the code→action table
 * here (review R-5: the inline copy had drifted, omitting `provider_error`
 * from the discard list and `already_replied` (no draft) from the
 * await_human_review list, so the chip showed `no_action` where the
 * service says `discard_and_retry` / `await_human_review`).
 *
 * R22: an audit record is a refusal record — its draftId is context (which
 * draft the refusal touched), never evidence that the draft is eligible to
 * approve/send. The refusal-side map routes already_replied to
 * await_human_review regardless of the draftId; approval guidance belongs
 * only to the reused:true success path (nextActionForReuse).
 */
const nextAction = computed(() =>
  nextActionForCode(audit.value?.metadataCode)
);

function evidenceColor(code: string): string {
  switch (code) {
    case "already_replied":
    case "no_reply_observed":
      return "success";
    case "reply_in_progress":
    case "generation_in_progress":
      return "info";
    case "needs_human_review":
    case "delivery_unknown":
    case "reply_state_unknown":
    case "reply_state_conflict":
    case "unsupported_protocol":
    case "missing_message_id":
    case "receive_unavailable":
    case "sent_folder_unavailable":
    case "ambiguous_match":
    case "identity_conflict":
      return "warning";
    case "probe_timeout":
    case "probe_limit_exceeded":
    case "probe_failed":
      return "error";
    default:
      return "default";
  }
}

function evidenceLabel(code: string): string {
  return t("emailReply.policyCode." + code) || code;
}

function detectionStateColor(state: string): string {
  switch (state) {
    case "replied":
      return "success";
    case "not_replied":
      return "info";
    default:
      return "warning";
  }
}

function detectionStateLabel(state: string): string {
  return (
    t("emailReply.replyDetection.state_" + state) || state
  );
}

function coverageLabel(coverage: string): string {
  return (
    t("emailReply.replyDetection.coverage_" + coverage) || coverage
  );
}

/**
 * T10 (FR-032): run the diagnostic reply check through the AI-gated IPC
 * channel. The typed IpcRequestError carries the structured failure fields;
 * the user sees a bounded message, never a raw provider error.
 */
async function recheckReplyStatus(): Promise<void> {
  const a = audit.value;
  if (!a || recheckLoading.value) return;
  recheckLoading.value = true;
  recheckError.value = null;
  try {
    recheckResult.value = await checkEmailReplied(a.messageId);
  } catch (err: unknown) {
    recheckResult.value = null;
    recheckError.value =
      err instanceof Error && err.message
        ? err.message
        : t("emailAutoReplyAudit.recheck_failed");
  } finally {
    recheckLoading.value = false;
  }
}

onMounted(async () => {
  const id = Number(route.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    loading.value = false;
    return;
  }
  try {
    audit.value = await getAutoReplyAuditLog(id);
  } catch (err) {
    console.error("Failed to load audit log:", err);
  } finally {
    loading.value = false;
  }
});

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
</script>
