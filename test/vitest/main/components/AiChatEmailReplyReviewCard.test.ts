import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Card from '@/views/components/aiChatWorkspace/AiChatEmailReplyReviewCard.vue';
import { getEmailReplyDraft, approveEmailReplyDraft, sendEmailReply } from '@/views/api/emailreply';
vi.mock('@/views/api/emailreply', () => ({ getEmailReplyDraft: vi.fn(), approveEmailReplyDraft: vi.fn(), sendEmailReply: vi.fn() }));
const detail = { id: 3, currentRevisionId: 1, status: 'draft', recipientAddress: 'customer@example.com', subject: 'Re: Question', bodyText: '<script>unsafe</script>\nReply content', requiresHumanReview: false };
function render(): ReturnType<typeof mount> {
  return mount(Card, {
    props: { draftId: 3 },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false })],
      stubs: {
        // Mirrors the stub shape used by ReplyDraftReviewCard.test.ts: the
        // loading/disabled props surface as real button attributes so the
        // busy affordance is assertable without booting full Vuetify.
        VBtn: {
          inheritAttrs: false,
          props: ['loading', 'disabled'],
          emits: ['click'],
          template: `<button v-bind="$attrs" :disabled="disabled" :class="{ 'v-btn--loading': loading }" :data-loading="loading ? 'true' : undefined" @click="$emit('click')"><slot /></button>`,
        },
      },
    },
  });
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getEmailReplyDraft).mockResolvedValue(detail as Awaited<ReturnType<typeof getEmailReplyDraft>>); });
describe('email review approval', () => {
  it('shows saved content safely and only sends after approval click', async () => {
    const wrapper = render(); await flushPromises();
    expect(wrapper.text()).toContain('customer@example.com');
    expect(wrapper.text()).toContain('Reply content');
    expect(wrapper.find('script').exists()).toBe(false);
    expect(sendEmailReply).not.toHaveBeenCalled();
    vi.mocked(approveEmailReplyDraft).mockResolvedValue({ approvalId: 1, token: 'token', revisionId: 1, contentHash: 'hash' });
    vi.mocked(sendEmailReply).mockResolvedValue({ status: 'sent', attemptId: 1, sentAt: '', requestCorrelationId: 'r' });
    vi.mocked(getEmailReplyDraft).mockResolvedValue({ ...detail, status: 'sent' } as Awaited<ReturnType<typeof getEmailReplyDraft>>);
    await wrapper.get('button').trigger('click'); await flushPromises();
    expect(sendEmailReply).toHaveBeenCalledWith({ draftId: 3, approvalToken: 'token' });
    expect(wrapper.find('button').exists()).toBe(false);
  });
  it('requires another review when the saved revision changed', async () => {
    vi.mocked(approveEmailReplyDraft).mockResolvedValue({ approvalId: 1, token: 'token', revisionId: 2, contentHash: 'changed' });
    const wrapper = render(); await flushPromises();
    await wrapper.get('button').trigger('click'); await flushPromises();
    expect(sendEmailReply).not.toHaveBeenCalled();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  });
  it('does not send if approval is refused', async () => {
    vi.mocked(approveEmailReplyDraft).mockRejectedValue(new Error('stale revision'));
    const wrapper = render(); await flushPromises();
    await wrapper.get('button').trigger('click'); await flushPromises();
    expect(sendEmailReply).not.toHaveBeenCalled();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  });
  it('shows a busy affordance while approve/send is in flight', async () => {
    const wrapper = render(); await flushPromises();
    // Hold the approve IPC open so the in-flight busy state is observable —
    // real sends run the pre-send mailbox probe and can take many seconds.
    let resolveApprove!: (v: { approvalId: number; token: string; revisionId: number; contentHash: string }) => void;
    vi.mocked(approveEmailReplyDraft).mockImplementation(() => new Promise((resolve) => { resolveApprove = resolve; }));
    await wrapper.get('button').trigger('click');
    const busyButton = wrapper.get('button');
    expect(busyButton.attributes('disabled')).toBeDefined();
    expect(busyButton.classes()).toContain('v-btn--loading');
    expect(busyButton.text()).toContain('Sending');
    resolveApprove({ approvalId: 1, token: 'token', revisionId: 1, contentHash: 'hash' });
    await flushPromises();
    expect(sendEmailReply).toHaveBeenCalledWith({ draftId: 3, approvalToken: 'token' });
  });
});
