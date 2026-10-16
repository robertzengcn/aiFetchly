<template>
  <v-card variant="outlined" class="pa-3" data-testid="draft-review-card">
    <v-progress-linear v-if="loading" indeterminate data-testid="draft-review-loading"></v-progress-linear>

    <template v-if="!loading && draft">
      <div class="d-flex align-center flex-wrap">
        <div class="text-subtitle-2">{{ t("emailReply.drafts_title") }}</div>
        <v-chip
          v-if="draft.requiresHumanReview"
          class="ml-2"
          :color="isResolvedForCurrent ? 'success' : 'warning'"
          size="small"
          data-testid="draft-review-flag-chip"
        >
          {{
            isResolvedForCurrent
              ? t("emailReply.human_review_resolved")
              : t("emailReply.human_review_required")
          }}
        </v-chip>
        <v-chip
          v-else
          class="ml-2"
          color="default"
          size="small"
          data-testid="draft-review-noflag-chip"
        >
          {{ t("emailReply.human_review_no_flag") }}
        </v-chip>
      </div>

      <div class="mt-2 text-body-2">{{ draft.subject }}</div>

      <!-- R07: the exact revision content under review — recipient envelope
        plus the plain-text body. bodyText is rendered as TEXT (interpolation
        escapes markup), never as HTML: the model-generated bodyHtml is a
        derived rendering, not the reviewed content, and must not execute. -->
      <div v-if="draft.recipientAddress" class="mt-2 text-body-2">
        <span class="text-subtitle-2">{{ t("emailReply.human_review_recipient") }}: </span>
        <span data-testid="draft-review-recipient">{{ draft.recipientAddress }}</span>
      </div>
      <div class="mt-3">
        <div class="text-subtitle-2">{{ t("emailReply.human_review_body") }}</div>
        <pre
          class="text-body-2"
          style="white-space: pre-wrap"
          data-testid="draft-review-body"
          >{{ draft.bodyText }}</pre
        >
      </div>

      <!-- Original model reasons + open questions (immutable provenance). -->
      <div v-if="reasons.length > 0" class="mt-3">
        <div class="text-subtitle-2">{{ t("emailReply.human_review_reasons") }}</div>
        <ul data-testid="draft-review-reasons">
          <li v-for="(reason, i) in reasons" :key="i">{{ reason }}</li>
        </ul>
      </div>
      <div v-if="questions.length > 0" class="mt-2">
        <div class="text-subtitle-2">{{ t("emailReply.human_review_questions") }}</div>
        <ul data-testid="draft-review-questions">
          <li v-for="(question, i) in questions" :key="i">{{ question }}</li>
        </ul>
      </div>

      <!-- Current resolution state. -->
      <div
        v-if="isResolvedForCurrent"
        class="mt-3 text-body-2"
        data-testid="draft-review-resolved"
      >
        {{ t("emailReply.human_review_resolved") }}
      </div>
      <div
        v-else-if="isStaleResolution"
        class="mt-3 text-body-2"
        data-testid="draft-review-stale"
      >
        {{ t("emailReply.human_review_stale") }}
      </div>

      <!-- Explicit revision-bound acknowledgment (user gesture only — this
           channel is never exposed to AI tools). -->
      <div v-if="canResolve" class="mt-3">
        <v-textarea
          v-model="note"
          :label="t('emailReply.human_review_note_label')"
          :placeholder="t('emailReply.human_review_resolve_note_placeholder')"
          rows="2"
          auto-grow
          :disabled="resolving"
          data-testid="draft-review-note"
        ></v-textarea>
        <v-btn
          color="primary"
          variant="tonal"
          size="small"
          :loading="resolving"
          :disabled="resolving || draft.currentRevisionId == null"
          data-testid="draft-review-resolve-btn"
          @click="resolveReview"
        >
          {{ t("emailReply.human_review_resolve") }}
        </v-btn>
        <div
          v-if="resolveError"
          class="mt-2 text-caption text-error"
          data-testid="draft-review-error"
        >
          {{ t("emailReply.human_review_resolve_failed") }}
        </div>
      </div>
    </template>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  getEmailReplyDraft,
  resolveEmailReplyHumanReview,
  type ReplyDraftDetail,
} from "@/views/api/emailreply";

const props = defineProps<{
  draftId: number;
}>();

const { t } = useI18n({ inheritLocale: true });

const draft = ref<ReplyDraftDetail | null>(null);
const loading = ref(true);
const resolving = ref(false);
const resolveError = ref(false);
const note = ref("");

function decodeList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.slice(0, 500));
  } catch {
    return [];
  }
}

const reasons = computed(() => decodeList(draft.value?.reviewReasonsJson ?? null));
const questions = computed(() =>
  decodeList(draft.value?.unresolvedQuestionsJson ?? null)
);

/** A resolution counts only when bound to the CURRENT revision. */
const isResolvedForCurrent = computed(() => {
  const d = draft.value;
  return (
    d !== null &&
    d.currentRevisionId !== null &&
    d.humanReviewResolvedAt !== null &&
    d.humanReviewResolvedRevisionId === d.currentRevisionId
  );
});

/** A resolution exists but targets an older revision — review again. */
const isStaleResolution = computed(() => {
  const d = draft.value;
  return (
    d !== null &&
    d.humanReviewResolvedAt !== null &&
    !isResolvedForCurrent.value
  );
});

/** The resolve control shows for a pending flag with a reviewable revision. */
const canResolve = computed(() => {
  const d = draft.value;
  return d !== null && d.requiresHumanReview && !isResolvedForCurrent.value;
});

/**
 * R08: request generation + requested id. Load A pending, navigate to B
 * (load B starts), B resolves, then A resolves last — without these
 * guards A would overwrite B while the screen still shows B, and a stale
 * failure could clear a newer successful result. Every load captures its
 * generation and requested id; only the latest generation for the
 * currently displayed draft may touch reactive state.
 */
let loadGeneration = 0;

async function loadDetail(): Promise<void> {
  const generation = ++loadGeneration;
  const requestedId = props.draftId;
  loading.value = true;
  try {
    const detail = await getEmailReplyDraft(requestedId);
    if (generation !== loadGeneration || requestedId !== props.draftId) {
      return;
    }
    draft.value = detail;
  } catch {
    if (generation !== loadGeneration || requestedId !== props.draftId) {
      return;
    }
    draft.value = null;
  } finally {
    if (generation === loadGeneration && requestedId === props.draftId) {
      loading.value = false;
    }
  }
}

async function resolveReview(): Promise<void> {
  const draftId = props.draftId;
  const revisionId = draft.value?.currentRevisionId;
  if (revisionId == null || resolving.value) return;
  // R08: never submit a revision loaded for a different draft — the
  // backend's binding check would refuse, but the screen must not even
  // send a mismatched draft/revision pair.
  if (draft.value?.id !== draftId) return;
  resolving.value = true;
  resolveError.value = false;
  try {
    const result = await resolveEmailReplyHumanReview({
      draftId,
      revisionId,
      note: note.value || undefined,
    });
    // Navigated mid-resolve: leave the new draft's loader/state alone.
    if (props.draftId !== draftId) return;
    if (result.resolved) {
      note.value = "";
      await loadDetail();
    } else {
      resolveError.value = true;
    }
  } catch {
    if (props.draftId !== draftId) return;
    resolveError.value = true;
  } finally {
    resolving.value = false;
  }
}

onMounted(() => {
  void loadDetail();
});

watch(
  () => props.draftId,
  () => {
    note.value = "";
    resolveError.value = false;
    // R08: clear previous content on navigation — never show A's settled
    // content while B loads.
    draft.value = null;
    void loadDetail();
  }
);
</script>
