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
import { getAutoReplyAuditLog } from "@/views/api/emailreply";
import type { AutoReplyAuditDto } from "@/entityTypes/emailReceiveTypes";
import AIContentReportButton from "@/views/components/aiContentReport/AIContentReportButton.vue";
import AIContentReportDialog from "@/views/components/aiContentReport/AIContentReportDialog.vue";
import { buildAutoReplyDescriptor } from "@/views/components/aiContentReport/reportableOutput";
import { AIFETCHLY_PRIVACY_POLICY_URL } from "@/config/appInfo";

const { t } = useI18n({ inheritLocale: true });
const route = useRoute();
const router = useRouter();

const audit = ref<AutoReplyAuditDto | null>(null);
const loading = ref(true);

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
