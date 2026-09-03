import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import OutboundEmailReviewDialog from "@/views/components/outboundEmail/OutboundEmailReviewDialog.vue";
import {
  getOutboundEmailBatch,
  updateOutboundEmailDraft,
  approveOutboundEmailBatch,
  sendOutboundEmailBatch,
  discardOutboundEmailBatch,
} from "@/views/api/outboundEmailDelivery";
import type { OutboundEmailBatchGetResult } from "@/views/api/outboundEmailDelivery";

vi.mock("@/views/api/outboundEmailDelivery", () => ({
  getOutboundEmailBatch: vi.fn(),
  updateOutboundEmailDraft: vi.fn(),
  approveOutboundEmailBatch: vi.fn(),
  sendOutboundEmailBatch: vi.fn(),
  discardOutboundEmailBatch: vi.fn(),
  getOutboundEmailBatchStatus: vi.fn(),
  subscribeOutboundEmailProgress: vi.fn().mockReturnValue(() => {}),
  removeOutboundEmailProgressListener: vi.fn(),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: {
      outboundEmail: {
        review_title: "Review Outbound Email",
        recipient_count: "Recipients",
        mode: "Mode",
        send: "Send",
        discard: "Discard",
        approve: "Approve",
        edit: "Edit",
        save: "Save",
        cancel: "Cancel",
        subject: "Subject",
        body: "Body",
        sender: "Sender",
        recipient: "Recipient",
        approval_invalidated: "Edits invalidate prior approval. Re-approve before sending.",
        preflight_blocked: "Cannot approve: blocking findings.",
        send_success: "Batch queued for delivery.",
        discarded: "Batch discarded.",
        no_approval: "Approve before sending.",
      },
    },
  },
});

function makeBatchResult(
  overrides: Partial<OutboundEmailBatchGetResult> = {}
): OutboundEmailBatchGetResult {
  return {
    batch: {
      id: 1,
      status: "draft_ready",
      batchHash: "a".repeat(64),
      conversationId: "conv-1",
      recipientCount: 1,
    },
    drafts: [
      {
        id: 10,
        recipientAddress: "alice@example.com",
        recipientDisplayName: "Alice",
        status: "draft",
        revisionNumber: 1,
        subject: "Hello Alice",
        bodyText: "Hi Alice",
        bodyHtml: null,
        emailServiceId: 1,
        senderAddress: "sender@example.com",
      },
    ],
    ...overrides,
  };
}

function mountDialog(props: { batchId?: number; modelValue?: boolean } = {}) {
  return mount(OutboundEmailReviewDialog, {
    global: {
      plugins: [i18n],
      stubs: {
        VDialog: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template: `<div v-if="modelValue"><slot /></div>`,
        },
        VCard: { template: "<div><slot /></div>" },
        VCardTitle: { template: "<div><slot /></div>" },
        VCardText: { template: "<div><slot /></div>" },
        VCardActions: { template: "<div><slot /></div>" },
        VDivider: true,
        VBtn: {
          inheritAttrs: false,
          emits: ["click"],
          template: `<button v-bind="$attrs" @click="$emit('click')"><slot /></button>`,
        },
        VIcon: true,
        VSpacer: true,
        VAlert: { template: "<div><slot /></div>" },
        VTextField: { props: ["modelValue"], emits: ["update:modelValue"], template: "<input />" },
        VTextarea: { props: ["modelValue"], emits: ["update:modelValue"], template: "<textarea />" },
        VChip: { template: "<span><slot /></span>" },
        VProgressCircular: true,
        OutboundEmailRecipientDraft: true,
      },
    },
    props: {
      modelValue: props.modelValue ?? true,
      batchId: props.batchId ?? 1,
    },
  });
}

describe("OutboundEmailReviewDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOutboundEmailBatch).mockResolvedValue(makeBatchResult());
    vi.mocked(updateOutboundEmailDraft).mockResolvedValue({
      revisionId: 2,
      batchHash: "b".repeat(64),
      batchStatus: "draft_ready",
    });
    vi.mocked(approveOutboundEmailBatch).mockResolvedValue({
      authorizationId: 100,
      token: "raw-token-xyz",
      batchHash: "a".repeat(64),
    });
    vi.mocked(sendOutboundEmailBatch).mockResolvedValue({
      status: "claimed",
      attemptId: 200,
    });
    vi.mocked(discardOutboundEmailBatch).mockResolvedValue({ discarded: true });
  });

  it("loads the batch + drafts and renders the recipient count and mode", async () => {
    const wrapper = mountDialog();
    await flushPromises();
    expect(getOutboundEmailBatch).toHaveBeenCalledWith(1);
    expect(wrapper.text()).toContain("Recipients");
    expect(wrapper.text()).toContain("1");
  });

  it("disables Send until the batch is approved", async () => {
    const wrapper = mountDialog();
    await flushPromises();
    const sendBtn = wrapper.find('[data-testid="outbound-review-send"]');
    expect(sendBtn.attributes("disabled")).toBeDefined();
  });

  it("approves the batch and then enables Send", async () => {
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper.find('[data-testid="outbound-review-approve"]').trigger("click");
    await flushPromises();
    expect(approveOutboundEmailBatch).toHaveBeenCalledWith(1, "a".repeat(64));
    const sendBtn = wrapper.find('[data-testid="outbound-review-send"]');
    expect(sendBtn.attributes("disabled")).toBeUndefined();
  });

  it("surfaces preflight_failed and keeps Send disabled when approve throws", async () => {
    vi.mocked(approveOutboundEmailBatch).mockRejectedValue(
      new Error("preflight_failed: subject_missing")
    );
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper.find('[data-testid="outbound-review-approve"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toMatch(/blocking findings/i);
    const sendBtn = wrapper.find('[data-testid="outbound-review-send"]');
    expect(sendBtn.attributes("disabled")).toBeDefined();
  });

  it("sends the batch after approval and emits sent", async () => {
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper.find('[data-testid="outbound-review-approve"]').trigger("click");
    await flushPromises();
    await wrapper.find('[data-testid="outbound-review-send"]').trigger("click");
    await flushPromises();
    expect(sendOutboundEmailBatch).toHaveBeenCalledWith(
      1,
      100,
      "a".repeat(64)
    );
    expect(wrapper.emitted("sent")).toBeTruthy();
  });

  it("discards the batch and emits discarded", async () => {
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper.find('[data-testid="outbound-review-discard"]').trigger("click");
    await flushPromises();
    expect(discardOutboundEmailBatch).toHaveBeenCalledWith(1);
    expect(wrapper.emitted("discarded")).toBeTruthy();
  });
});
