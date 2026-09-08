import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2Message from "@/views/components/aiChatV2/AiChatV2Message.vue";
import { getOutboundEmailBatch } from "@/views/api/outboundEmailDelivery";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import { MessageType } from "@/entityTypes/commonType";

// The batch card + review dialog both call the outbound delivery API on mount.
vi.mock("@/views/api/outboundEmailDelivery", () => ({
  getOutboundEmailBatch: vi.fn(),
  updateOutboundEmailDraft: vi.fn(),
  approveOutboundEmailBatch: vi.fn(),
  sendOutboundEmailBatch: vi.fn(),
  discardOutboundEmailBatch: vi.fn(),
  getOutboundEmailBatchStatus: vi.fn().mockResolvedValue({
    batchStatus: "draft_ready",
    attempt: null,
    outcomes: [],
  }),
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
        batch_card_title: "Outbound Email Batch",
        recipient_count: "Recipients",
        mode_send_now: "Send Now",
        mode_review_first: "Review First",
        review_action: "Review",
        review_title: "Review Outbound Email",
        review_reason: "Review required",
        send: "Send",
      },
      aiChatV2: { tool_result_title: "Tool Result", tool_name: "Tool" },
    },
  },
});

function makeToolResultMessage(
  toolResult: Record<string, unknown>
): ChatV2MessageView {
  return {
    id: "m1",
    conversationId: "conv-1",
    role: "tool",
    content: "",
    timestamp: new Date(0).toISOString(),
    messageType: MessageType.TOOL_RESULT,
    metadata: {
      source: "chat-v2",
      toolName: "draft_outbound_email_batch",
      toolResult,
    },
  };
}

function mountMessage(message: ChatV2MessageView) {
  return mount(AiChatV2Message, {
    global: {
      plugins: [i18n],
      stubs: {
        VCard: { template: "<div><slot /></div>" },
        VCardItem: { template: "<div><slot /></div>" },
        VCardActions: { template: "<div><slot /></div>" },
        VCardText: { template: "<div><slot /></div>" },
        VCardTitle: { template: "<div><slot /></div>" },
        VDialog: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template: `<div v-if="modelValue"><slot /></div>`,
        },
        VDivider: true,
        VBtn: {
          inheritAttrs: false,
          emits: ["click"],
          template: `<button v-bind="$attrs" @click="$emit('click')"><slot /></button>`,
        },
        VIcon: true,
        VChip: { template: "<span><slot /></span>" },
        VAlert: { template: "<div><slot /></div>" },
        VSpacer: true,
        VTextField: true,
        VTextarea: true,
        VListItem: { template: "<div><slot /></div>" },
        VProgressCircular: true,
        VProgressLinear: true,
        SkillApprovalCard: true,
        AiArtifactCard: true,
        AiChatV2StreamStatus: true,
        AiChatV2PlanApprovalCard: true,
        AIContentReportButton: true,
        OutboundEmailBatchCard: false,
        OutboundEmailRecipientDraft: true,
        OutboundEmailDeliveryProgress: true,
        OutboundEmailReviewDialog: false,
      },
    },
    props: {
      message,
    },
  });
}

describe("AiChatV2Message outbound batch card integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render a batch card for non-outbound tool results", () => {
    const wrapper = mountMessage(
      makeToolResultMessage({ success: true, files: ["a.txt"] })
    );
    expect(wrapper.text()).not.toContain("Outbound Email Batch");
  });

  it("renders the batch card when the draft tool returns a batch_id", async () => {
    vi.mocked(getOutboundEmailBatch).mockResolvedValue({
      batch: {
        id: 42,
        status: "draft_ready",
        batchHash: "a".repeat(64),
        conversationId: "conv-1",
        recipientCount: 1,
      },
      drafts: [
        {
          id: 1,
          recipientAddress: "alice@example.com",
          recipientDisplayName: "Alice",
          status: "draft",
          revisionNumber: 1,
          subject: "Hello",
          bodyText: "Hi",
          bodyHtml: null,
          emailServiceId: 1,
          senderAddress: "sender@example.com",
        },
      ],
    });
    const wrapper = mountMessage(
      makeToolResultMessage({
        success: true,
        batchId: 42,
        draftCount: 1,
        batchHash: "a".repeat(64),
      })
    );
    await flushPromises();
    expect(wrapper.text()).toContain("Outbound Email Batch");
    const reviewBtn = wrapper.find('[data-testid="outbound-batch-review"]');
    expect(reviewBtn.exists()).toBe(true);
  });

  it("opens the review dialog (with Send disabled) when Review is clicked", async () => {
    vi.mocked(getOutboundEmailBatch).mockResolvedValue({
      batch: {
        id: 43,
        status: "draft_ready",
        batchHash: "b".repeat(64),
        conversationId: "conv-1",
        recipientCount: 2,
      },
      drafts: [
        {
          id: 1,
          recipientAddress: "a@example.com",
          recipientDisplayName: null,
          status: "draft",
          revisionNumber: 1,
          subject: "S",
          bodyText: "B",
          bodyHtml: null,
          emailServiceId: 1,
          senderAddress: "sender@example.com",
        },
        {
          id: 2,
          recipientAddress: "b@example.com",
          recipientDisplayName: null,
          status: "draft",
          revisionNumber: 1,
          subject: "S",
          bodyText: "B",
          bodyHtml: null,
          emailServiceId: 1,
          senderAddress: "sender@example.com",
        },
      ],
    });
    const wrapper = mountMessage(
      makeToolResultMessage({
        success: true,
        batchId: 43,
        draftCount: 2,
        batchHash: "b".repeat(64),
      })
    );
    await flushPromises();
    await wrapper
      .find('[data-testid="outbound-batch-review"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Review Outbound Email");
    // §18: Send must be disabled until the batch is approved.
    const sendBtn = wrapper.find('[data-testid="outbound-review-send"]');
    expect(sendBtn.exists()).toBe(true);
    expect(sendBtn.attributes("disabled")).toBeDefined();
  });
});
