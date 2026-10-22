/**
 * Component tests for AiChatOutboundBatchReviewCard (FR-OUT-002/007, P1-6):
 * the transcript card must leave its frozen draft — on send, discard, and
 * terminal delivery events the card's displayed status updates from the
 * authoritative batch read, with the sent count and reason code rendered,
 * and Review stays hidden for every terminal status.
 */
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiChatOutboundBatchReviewCard from "@/views/components/aiChatWorkspace/AiChatOutboundBatchReviewCard.vue";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import { MessageType } from "@/entityTypes/commonType";
import type { AuthorizedEmailWorkerEvent } from "@/entityTypes/outboundEmailDeliveryTypes";

let progressListener: ((event: AuthorizedEmailWorkerEvent) => void) | null =
  null;

vi.mock("@/views/api/outboundEmailDelivery", () => ({
  getOutboundEmailBatch: vi.fn().mockResolvedValue({
    batch: { id: 21, status: "draft_ready", batchHash: null, conversationId: "conv-1", recipientCount: 5 },
    drafts: [],
  }),
  updateOutboundEmailDraft: vi.fn(),
  approveOutboundEmailBatch: vi.fn(),
  sendOutboundEmailBatch: vi.fn(),
  discardOutboundEmailBatch: vi.fn(),
  getOutboundEmailBatchStatus: vi.fn(),
  subscribeOutboundEmailProgress: vi
    .fn()
    .mockImplementation((listener: (e: AuthorizedEmailWorkerEvent) => void) => {
      progressListener = listener;
      return listener;
    }),
  removeOutboundEmailProgressListener: vi.fn(),
}));

import { getOutboundEmailBatchStatus } from "@/views/api/outboundEmailDelivery";

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
        mode_draft_only: "Draft Only",
        review_reason: "Review required",
        review_action: "Review",
        review_title: "Review Outbound Email",
        sent_summary: "Batch sent.",
        partial_summary: "Batch partially sent.",
        unknown_summary: "Delivery status unknown.",
        failed_summary: "Batch failed.",
        discarded_summary: "Batch discarded.",
        cancelled_summary: "Batch cancelled.",
        summary_detail: "Sent: {sent}/{total} · Reason: {reason}",
      },
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

const draftReadyMessage = makeToolResultMessage({
  batchId: 21,
  mode: "review_first",
  draftCount: 5,
  batchStatus: "draft_ready",
  reasonCode: "explicit_review_instruction",
  sentCount: 0,
});

function mountCard(message: ChatV2MessageView = draftReadyMessage) {
  return mount(AiChatOutboundBatchReviewCard, {
    props: { message },
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
        OutboundEmailBatchCard: false,
        OutboundEmailReviewDialog: {
          props: ["modelValue", "batchId"],
          emits: ["update:modelValue", "sent", "discarded"],
          template: `<div v-if="modelValue"><button data-testid="dialog-send" @click="$emit('sent', batchId, 900); $emit('update:modelValue', false)" /><button data-testid="dialog-discard" @click="$emit('discarded', batchId); $emit('update:modelValue', false)" /></div>`,
        },
      },
    },
  });
}

function statusResult(
  batchStatus: string,
  count: number
): {
  batchStatus: string;
  attempt: { id: number; status: string } | null;
  outcomes: Array<{
    id: number;
    draftId: number;
    recipientAddress: string;
    status: string;
    errorCode: string | null;
    providerMessageId: string | null;
  }>;
} {
  return {
    batchStatus,
    attempt: { id: 900, status: "completed" },
    outcomes: Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      draftId: i + 1,
      recipientAddress: `r${i + 1}@example.com`,
      status: "sent",
      errorCode: null,
      providerMessageId: `pm-${i + 1}`,
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  progressListener = null;
});

describe("AiChatOutboundBatchReviewCard", () => {
  it("starts as a reviewable draft card with the review dialog reachable", () => {
    const wrapper = mountCard();
    expect(
      wrapper.find('[data-testid="outbound-batch-review"]').exists()
    ).toBe(true);
    expect(
      wrapper.find('[data-testid="workspace-outbound-batch"]').exists()
    ).toBe(true);
  });

  it("a sent outcome refreshes the card from the authoritative read and hides Review (FR-OUT-002 P1-6)", async () => {
    vi.mocked(getOutboundEmailBatchStatus).mockResolvedValue(
      statusResult("sent", 3)
    );
    const wrapper = mountCard();
    // Review the batch, then send.
    await wrapper
      .find('[data-testid="outbound-batch-review"]')
      .trigger("click");
    await flushPromises();
    await wrapper.find('[data-testid="dialog-send"]').trigger("click");
    await flushPromises();

    expect(getOutboundEmailBatchStatus).toHaveBeenCalledWith(21);
    // The frozen draft card left its draft state: terminal status, sent
    // count, reason code — and no Review replay.
    expect(
      wrapper.find('[data-testid="outbound-batch-review"]').exists()
    ).toBe(false);
    expect(wrapper.text()).toContain("Batch sent.");
    const detail = wrapper.find(
      '[data-testid="outbound-batch-summary-detail"]'
    );
    expect(detail.exists()).toBe(true);
    expect(detail.text()).toContain("3/5");
    expect(detail.text()).toContain("sent");
    // The dialog closed after send (no dialog lingering).
    expect(wrapper.find('[data-testid="dialog-send"]').exists()).toBe(false);
  });

  it("a discarded outcome updates the card to the discarded terminal state (FR-OUT-007 P1-6)", async () => {
    vi.mocked(getOutboundEmailBatchStatus).mockResolvedValue(
      statusResult("discarded", 0)
    );
    const wrapper = mountCard();
    await wrapper
      .find('[data-testid="outbound-batch-review"]')
      .trigger("click");
    await flushPromises();
    await wrapper.find('[data-testid="dialog-discard"]').trigger("click");
    await flushPromises();

    expect(getOutboundEmailBatchStatus).toHaveBeenCalledWith(21);
    expect(
      wrapper.find('[data-testid="outbound-batch-review"]').exists()
    ).toBe(false);
    expect(wrapper.text()).toContain("Batch discarded.");
  });

  it("a terminal worker-complete delivery event refreshes the card (FR-OUT-002 P1-6)", async () => {
    vi.mocked(getOutboundEmailBatchStatus).mockResolvedValue(
      statusResult("sent", 5)
    );
    const wrapper = mountCard();
    await flushPromises();
    // Rejected first call: response will be mocked after the listener exists.
    expect(progressListener).not.toBeNull();

    vi.mocked(getOutboundEmailBatchStatus).mockResolvedValue(
      statusResult("sent", 5)
    );
    const listener = progressListener as
      | ((e: AuthorizedEmailWorkerEvent) => void)
      | null;
    await listener?.({
      type: "authorized-email-worker-complete",
      batchId: 21,
      sendAttemptId: 900,
    });
    await flushPromises();

    expect(getOutboundEmailBatchStatus).toHaveBeenCalledWith(21);
    expect(
      wrapper.find('[data-testid="outbound-batch-review"]').exists()
    ).toBe(false);
    expect(wrapper.text()).toContain("Batch sent.");
    const detail = wrapper.find(
      '[data-testid="outbound-batch-summary-detail"]'
    );
    expect(detail.text()).toContain("5/5");
  });
});
