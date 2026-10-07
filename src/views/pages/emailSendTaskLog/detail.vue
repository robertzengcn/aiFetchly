<template>
  <v-sheet class="mx-auto pa-4" rounded>
    <div class="d-flex align-center mb-4">
      <v-btn color="error" variant="text" @click="router.go(-1)">
        <v-icon start>mdi-arrow-left</v-icon>{{ t("common.return") }}
      </v-btn>
      <h2 class="ml-2">{{ t("emailtasksendlog.detail_title") }}</h2>
    </div>

    <v-progress-linear v-if="loading" indeterminate></v-progress-linear>

    <v-alert v-if="errorMessage" type="error" density="compact" class="mb-4">
      {{ errorMessage }}
    </v-alert>

    <div v-if="detail">
      <!-- Header card: identity + status, shared by both sources -->
      <v-card variant="tonal" class="pa-3">
        <v-row>
          <v-col cols="12" md="6">
            <div class="text-subtitle-2">{{ t("emailtasksendlog.status") }}</div>
            <v-chip :color="statusColor(detail.status)" size="small">
              {{ detail.status }}
            </v-chip>
            <span class="ml-2">
              <v-chip
                size="small"
                :color="detail.source === 'authorized' ? 'primary' : 'default'"
                variant="tonal"
              >
                {{ sourceLabel(detail.source) }}
              </v-chip>
            </span>
            <div class="mt-2 text-subtitle-2">{{ t("emailtasksendlog.receiver") }}</div>
            <div>{{ detail.receiver || "—" }}</div>
            <div class="mt-2 text-subtitle-2">{{ t("emailtasksendlog.title") }}</div>
            <div>{{ detail.title || "—" }}</div>
            <div class="mt-2 text-subtitle-2">{{ t("emailtasksendlog.record_time") }}</div>
            <div>{{ formatRecordTime(detail.record_time) }}</div>
          </v-col>
          <v-col cols="12" md="6">
            <!-- Authorized half: provider envelope + ids -->
            <template v-if="detail.source === 'authorized'">
              <div class="text-subtitle-2">{{ t("emailtasksendlog.sender") }}</div>
              <div>{{ detail.sender || "—" }}</div>
              <div class="mt-2 text-subtitle-2">{{ t("emailtasksendlog.actor") }}</div>
              <div>{{ detail.actor || "—" }}</div>
              <div class="mt-2 text-subtitle-2">{{ t("emailtasksendlog.submitted_at") }}</div>
              <div>{{ formatRecordTime(detail.submittedAt) }}</div>
              <div class="mt-2 text-subtitle-2">{{ t("emailtasksendlog.completed_at") }}</div>
              <div>{{ formatRecordTime(detail.completedAt) }}</div>
            </template>
            <!-- Legacy half: task link + visible From -->
            <template v-else>
              <div class="text-subtitle-2">{{ t("emailtasksendlog.task_id") }}</div>
              <div>{{ detail.taskId ?? "—" }}</div>
              <div class="mt-2 text-subtitle-2">{{ t("emailtasksendlog.from_address") }}</div>
              <div>{{ detail.fromAddress || "—" }}</div>
            </template>
            <!-- Identity metadata (FR-014): service record + SMTP login + Reply-To -->
            <div class="mt-2 text-subtitle-2">{{ t("emailtasksendlog.email_service") }}</div>
            <div>{{ detail.emailServiceId ?? "—" }}</div>
            <div class="mt-2 text-subtitle-2">{{ t("emailtasksendlog.smtp_username") }}</div>
            <div>{{ detail.smtpUsername || "—" }}</div>
            <div class="mt-2 text-subtitle-2">{{ t("emailtasksendlog.reply_to") }}</div>
            <div>{{ detail.replyTo || "—" }}</div>
          </v-col>
        </v-row>
      </v-card>

      <!-- Authorized half: provider envelope details -->
      <v-card
        v-if="detail.source === 'authorized'"
        variant="outlined"
        class="pa-3 mt-4"
      >
        <div class="text-subtitle-2">{{ t("emailtasksendlog.provider_message_id") }}</div>
        <div>{{ detail.providerMessageId || "—" }}</div>
        <div class="mt-2 text-subtitle-2">{{ t("emailtasksendlog.error_code") }}</div>
        <div>
          <v-alert
            v-if="detail.errorCode"
            type="error"
            density="compact"
          >{{ detail.errorCode }}</v-alert>
          <template v-else>—</template>
        </div>
        <div class="mt-2 text-subtitle-2">{{ t("emailtasksendlog.batch_id") }}</div>
        <div>{{ detail.batchId ?? "—" }}</div>
        <div class="mt-2 text-subtitle-2">{{ t("emailtasksendlog.draft_id") }}</div>
        <div>{{ detail.draftId ?? "—" }}</div>
        <div class="mt-2 text-subtitle-2">{{ t("emailtasksendlog.revision_id") }}</div>
        <div>{{ detail.revisionId ?? "—" }}</div>
        <div class="mt-2 text-subtitle-2">{{ t("emailtasksendlog.attempt_id") }}</div>
        <div>{{ detail.attemptId ?? "—" }}</div>
      </v-card>

      <!-- Body card: rendered HTML preview + source text tabs when HTML exists -->
      <v-card variant="outlined" class="pa-3 mt-4">
        <div class="text-subtitle-2">
          {{ detail.source === "authorized"
            ? t("emailtasksendlog.body")
            : t("emailtasksendlog.content") }}
        </div>
        <template v-if="hasHtmlPreview">
          <v-tabs v-model="activeTab" density="compact" class="mb-2">
            <v-tab value="preview">{{ t("emailtasksendlog.html_preview") || "HTML preview" }}</v-tab>
            <v-tab value="source">{{ t("emailtasksendlog.source_text") || "Source" }}</v-tab>
          </v-tabs>
          <v-window v-model="activeTab">
            <v-window-item value="preview">
              <!--
                Security: stored email HTML renders ONLY in this sandboxed
                iframe. sandbox="" disables scripts, forms, popups,
                same-origin, and top navigation. NEVER use v-html here.
                referrerpolicy=no-referrer blocks referrer leakage; remote
                images are stripped to [image hidden] (tracking-pixel defense).
              -->
              <iframe
                class="email-html-frame"
                sandbox=""
                referrerpolicy="no-referrer"
                data-testid="html-preview-frame"
                :srcdoc="renderedHtml"
                :title="t('emailtasksendlog.html_preview') || 'HTML preview'"
              />
            </v-window-item>
            <v-window-item value="source">
              <pre class="text-body-2">{{ bodyText || "—" }}</pre>
            </v-window-item>
          </v-window>
        </template>
        <pre v-else class="text-body-2">{{ bodyText || "—" }}</pre>
      </v-card>

      <!-- Legacy half: raw transport log -->
      <v-card
        v-if="detail.source === 'legacy' && detail.log"
        variant="outlined"
        class="pa-3 mt-4"
      >
        <div class="text-subtitle-2">{{ t("emailtasksendlog.log") }}</div>
        <pre class="text-body-2">{{ detail.log }}</pre>
      </v-card>
    </div>
  </v-sheet>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { getUnifiedEmailSendLogDetail } from "@/views/api/buckemail";
import { formatRecordTime } from "@/views/utils/function";
import type { UnifiedSendLogDetailEntry } from "@/entityTypes/buckemailType";

const { t } = useI18n({ inheritLocale: true });
const route = useRoute();
const router = useRouter();

const detail = ref<UnifiedSendLogDetailEntry | null>(null);
const loading = ref(true);
const errorMessage = ref("");
const activeTab = ref<string>("preview");

/**
 * The body shown in the source tab: legacy rows carry the sent content on
 * `content`, authorized rows on the revision-pinned `bodyText`. Rendered in
 * <pre> only — never v-html — since this is stored email content.
 */
function getBodyText(): string {
  const d = detail.value;
  if (!d) return "";
  return d.source === "authorized" ? d.bodyText ?? "" : d.content ?? "";
}
const bodyText = computed<string>(() => getBodyText());

/**
 * Raw HTML candidate for the rendered preview: authorized rows use the
 * revision's sanitized `bodyHtml`; legacy rows reuse `content` when it looks
 * like HTML (bulk sends store the rendered template there).
 */
function getRawHtml(): string {
  const d = detail.value;
  if (!d) return "";
  if (d.source === "authorized") return d.bodyHtml ?? "";
  return d.content ?? "";
}
const rawHtml = computed<string>(() => getRawHtml());

/** True when the raw HTML candidate contains at least one tag. */
function containsHtmlTag(html: string): boolean {
  return /<[^>]+>/.test(html);
}
const hasHtmlPreview = computed<boolean>(() => containsHtmlTag(rawHtml.value));

/**
 * Render sanitized HTML with remote images disabled (tracking-pixel defense).
 * Authorized `bodyHtml` is already sanitized at draft time; legacy `content`
 * is raw template HTML, so both render only in the sandboxed iframe and with
 * <img> stripped to a placeholder.
 */
function stripRemoteImages(html: string): string {
  return html.replace(/<img[^>]*>/gi, "[image hidden]");
}
const renderedHtml = computed<string>(() => stripRemoteImages(rawHtml.value));

onMounted(async () => {
  const source = String(route.params.source ?? "");
  const id = Number(route.params.id);
  // Guard: the (source, id) pair is the row's identity; both must be valid.
  if (
    (source !== "legacy" && source !== "authorized") ||
    !Number.isInteger(id) ||
    id <= 0
  ) {
    loading.value = false;
    errorMessage.value = t("emailtasksendlog.detail_not_found") || "Record not found";
    return;
  }
  try {
    detail.value = await getUnifiedEmailSendLogDetail(source, id);
  } catch (err) {
    console.error("Failed to load send log detail:", err);
    errorMessage.value = t("emailtasksendlog.detail_not_found") || "Record not found";
  } finally {
    loading.value = false;
  }
});

function sourceLabel(source: string): string {
  if (source === "authorized") {
    return t("emailtasksendlog.source_authorized") || "Authorized";
  }
  return t("emailtasksendlog.source_legacy") || "Legacy";
}

function statusColor(status: string): string {
  if (status === "Success" || status === "Sent") {
    return "success";
  }
  if (status === "Failure" || status === "Failed") {
    return "error";
  }
  if (status === "Pending" || status === "Submitted") {
    return "warning";
  }
  return "default";
}
</script>
<style scoped>
.email-html-frame {
  width: 100%;
  min-height: 400px;
  max-height: 560px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 4px;
  background: #fff;
}
</style>
