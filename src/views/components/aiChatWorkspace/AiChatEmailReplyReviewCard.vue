<template>
  <section class="email-review" data-testid="email-reply-review">
    <h3>{{ t('emailReply.chatReviewTitle') || 'Review email reply' }}</h3>
    <p v-if="loading">{{ t('emailReply.chatLoading') || 'Loading email…' }}</p>
    <template v-if="draft">
      <p>{{ draft.recipientAddress }}</p>
      <strong>{{ draft.subject }}</strong>
      <pre>{{ draft.bodyText }}</pre>
      <ReplyDraftReviewCard v-if="draft.requiresHumanReview" :draft-id="draftId" />
      <button v-if="draft.status === 'draft' || draft.status === 'approved'" :disabled="busy" @click="approveAndSend">
        {{ t('emailReply.chatApproveSend') || 'Approve and send' }}
      </button>
      <p v-if="draft.status === 'sent'" role="status">{{ t('emailReply.chatSent') || 'Email sent' }}</p>
    </template>
    <p v-if="error" role="alert">{{ t('emailReply.chatError') || 'Unable to complete this action. Reload the conversation to check the email status.' }}</p>
  </section>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getEmailReplyDraft, approveEmailReplyDraft, sendEmailReply, type ReplyDraftDetail } from '@/views/api/emailreply';
import ReplyDraftReviewCard from '@/views/pages/emailreply/widgets/ReplyDraftReviewCard.vue';
const props = defineProps<{ draftId: number }>();
const { t } = useI18n();
const draft = ref<ReplyDraftDetail | null>(null);
const loading = ref(false);
const busy = ref(false);
const error = ref(false);
watch(() => props.draftId, async (id): Promise<void> => {
  draft.value = null;
  loading.value = true;
  error.value = false;
  try {
    const detail = await getEmailReplyDraft(id);
    if (props.draftId === id) draft.value = detail;
  } catch { if (props.draftId === id) error.value = true; }
  finally { if (props.draftId === id) loading.value = false; }
}, { immediate: true });
async function approveAndSend(): Promise<void> {
  if (busy.value || !draft.value) return;
  const id = props.draftId;
  const reviewedRevision = draft.value.currentRevisionId;
  busy.value = true;
  error.value = false;
  try {
    const approval = await approveEmailReplyDraft(id);
    if (approval.revisionId !== reviewedRevision) {
      draft.value = await getEmailReplyDraft(id);
      error.value = true;
      return;
    }
    const outcome = await sendEmailReply({ draftId: id, approvalToken: approval.token });
    if (props.draftId === id) {
      // Disable repeat submission even if the following refresh fails.
      draft.value = null;
      error.value = outcome.status !== 'sent';
      draft.value = await getEmailReplyDraft(id);
    }
  } catch { if (props.draftId === id) error.value = true; }
  finally { busy.value = false; }
}
</script>
<style scoped>
.email-review { flex: 0 0 auto; border: 1px solid var(--app-border); border-radius: 12px; padding: 16px; min-width: 0; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
button { padding: 8px 16px; border: 1px solid currentColor; border-radius: 8px; }
</style>
