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
            <!-- Legacy half: task link -->
            <template v-else>
              <div class="text-subtitle-2">{{ t("emailtasksendlog.task_id") }}</div>
              <div>{{ detail.taskId ?? "—" }}</div>
            </template>
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

      <!-- Body card: legacy content / authorized bodyText -->
      <v-card variant="outlined" class="pa-3 mt-4">
        <div class="text-subtitle-2">
          {{ detail.source === "authorized"
            ? t("emailtasksendlog.body")
            : t("emailtasksendlog.content") }}
        </div>
        <pre class="text-body-2">{{ bodyText || "—" }}</pre>
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

/**
 * The body shown in the body card: legacy rows carry the sent content on
 * `content`, authorized rows on the revision-pinned `bodyText`. Rendered in
 * <pre> only — never v-html — since this is stored email content.
 */
const bodyText = computed(() => {
  const d = detail.value;
  if (!d) return "";
  return d.source === "authorized" ? d.bodyText ?? "" : d.content ?? "";
});

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
