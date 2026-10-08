<template>
  <div data-testid="email-auto-reply-audit-list">
    <div class="d-flex align-center mb-4 ml-2 mr-2">
      <h2>{{ t("emailAutoReplyAudit.title") }}</h2>
    </div>

    <!-- Filters -->
    <div class="d-flex flex-wrap align-center ml-2 mr-2 mb-2">
      <v-select
        v-model="filters.decisionStatus"
        :items="decisionStatusOptions"
        :label="t('emailAutoReplyAudit.decision_status')"
        clearable
        density="compact"
        hide-details
        class="mr-2"
        style="max-width: 220px"
      ></v-select>
      <v-select
        v-model="filters.classification"
        :items="classificationOptions"
        :label="t('emailAutoReplyAudit.classification')"
        clearable
        density="compact"
        hide-details
        class="mr-2"
        style="max-width: 220px"
      ></v-select>
      <v-text-field
        v-model="filters.search"
        :label="t('emailAutoReplyAudit.search')"
        density="compact"
        clearable
        hide-details
        class="mr-2"
        style="max-width: 260px"
        @keyup.enter="reload"
      ></v-text-field>
      <v-btn color="primary" @click="reload">{{ t("common.search") }}</v-btn>
    </div>

    <v-data-table-server
      :headers="headers"
      :items="serverItems"
      :items-length="totalItems"
      :loading="loading"
      :items-per-page="itemsPerPage"
      :page="currentPage"
      item-value="id"
      @update:options="loadItems"
    >
      <template #item.decisionStatus="{ item }">
        <v-chip :color="statusColor(item.decisionStatus)" size="small">
          {{ t("emailAutoReplyAudit.status." + item.decisionStatus) || item.decisionStatus }}
        </v-chip>
      </template>
      <template #item.replyEvidence="{ item }">
        <v-chip
          v-if="item.metadataCode"
          :color="evidenceColor(item.metadataCode)"
          size="small"
          :title="evidenceTitle(item)"
        >
          {{ evidenceLabel(item.metadataCode) }}
        </v-chip>
        <span v-else>—</span>
      </template>
      <template #item.createdAt="{ item }">
        {{ formatDate(item.createdAt) }}
      </template>
      <template #item.confidence="{ item }">
        {{ item.confidence != null ? (item.confidence * 100).toFixed(0) + "%" : "—" }}
      </template>
      <template #item.generatedSubject="{ item }">
        {{ displaySubject(item) }}
      </template>
      <template #item.requiresUserApproval="{ item }">
        <v-icon :color="item.requiresUserApproval ? 'warning' : 'success'">
          {{ item.requiresUserApproval ? "mdi-account-check" : "mdi-flash" }}
        </v-icon>
      </template>
      <template #item.actions="{ item }">
        <v-icon
          size="small"
          data-testid="audit-row-open"
          @click="openDetail(item.id)"
        >mdi-eye</v-icon>
      </template>
    </v-data-table-server>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import type { Header } from "@/entityTypes/commonType";
import { CapitalizeFirstLetter } from "@/views/utils/function";
import { listAutoReplyAuditLogs } from "@/views/api/emailreply";
import type { AutoReplyAuditDto } from "@/entityTypes/emailReceiveTypes";

const { t } = useI18n({ inheritLocale: true });
const router = useRouter();

const serverItems = ref<AutoReplyAuditDto[]>([]);
const totalItems = ref(0);
const loading = ref(true);
const itemsPerPage = ref(20);
const currentPage = ref(1);

const filters = ref({
  decisionStatus: undefined as string | undefined,
  classification: undefined as string | undefined,
  search: "",
});

const decisionStatusOptions = [
  "draft_created",
  "approval_required",
  "auto_sent",
  "blocked",
  "skipped",
  "failed",
  "needs_human_review",
];
const classificationOptions = [
  "interested",
  "not_interested",
  "unsubscribe",
  "bounce",
  "auto_reply",
  "support_request",
  "needs_human_review",
  "unknown",
];

const headers = computed<Array<Header>>(() => [
  { title: CapitalizeFirstLetter(t("emailAutoReplyAudit.created_at")), key: "createdAt", sortable: true },
  { title: CapitalizeFirstLetter(t("emailAutoReplyAudit.decision_status")), key: "decisionStatus", sortable: true },
  { title: CapitalizeFirstLetter(t("emailAutoReplyAudit.subject")), key: "generatedSubject", sortable: false },
  { title: CapitalizeFirstLetter(t("emailAutoReplyAudit.classification")), key: "classification", sortable: false },
  { title: CapitalizeFirstLetter(t("emailAutoReplyAudit.confidence")), key: "confidence", sortable: true },
  { title: CapitalizeFirstLetter(t("emailAutoReplyAudit.requires_approval")), key: "requiresUserApproval", sortable: false },
  { title: CapitalizeFirstLetter(t("emailAutoReplyAudit.reply_evidence")), key: "replyEvidence", sortable: false },
  { title: CapitalizeFirstLetter(t("common.actions")), key: "actions", sortable: false },
]);

function reload() {
  currentPage.value = 1;
  loadItems({ page: 1, itemsPerPage: itemsPerPage.value, sortBy: [] });
}

async function loadItems({ page, itemsPerPage: ips }: { page: number; itemsPerPage: number; sortBy: unknown[] }) {
  loading.value = true;
  itemsPerPage.value = ips;
  currentPage.value = page;
  const offset = (page - 1) * ips;
  try {
    const resp = await listAutoReplyAuditLogs({
      page: offset,
      size: ips,
      decisionStatus: filters.value.decisionStatus,
      classification: filters.value.classification,
      search: filters.value.search || undefined,
    });
    serverItems.value = resp.data;
    totalItems.value = resp.total;
  } catch (err) {
    console.error("Failed to load auto-reply audit logs:", err);
    serverItems.value = [];
    totalItems.value = 0;
  } finally {
    loading.value = false;
  }
}

function openDetail(id: number) {
  router.push({ name: "AI_Auto_Reply_Audit_Detail", params: { id } });
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** Sent rows carry the sent subject; draft rows carry the generated subject. */
function displaySubject(item: AutoReplyAuditDto): string {
  return item.sentSubject || item.generatedSubject || "(no subject)";
}

function statusColor(status: string): string {
  switch (status) {
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
    case "skipped":
      return "default";
    default:
      return "default";
  }
}

/**
 * T10 (FR-033): reply-evidence chip color from the typed refusal/detection
 * code. Positive evidence is green; review-routed unknowns are amber; retriable
 * probe failures are red; informational states are neutral.
 */
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

/** User-facing label for the typed code (i18n key falls back to the code). */
function evidenceLabel(code: string): string {
  return t("emailReply.policyCode." + code) || code;
}

/** Chip tooltip: the human-readable reason text when present. */
function evidenceTitle(item: AutoReplyAuditDto): string {
  return item.reason || item.metadataCode || "";
}
</script>
