import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import OutboundEmailBatchCard from "@/views/components/outboundEmail/OutboundEmailBatchCard.vue";

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
        sent_summary: "Batch sent.",
        partial_summary: "Batch partially sent.",
        unknown_summary: "Delivery status unknown.",
        failed_summary: "Batch failed.",
        discarded_summary: "Batch discarded.",
      },
    },
  },
});

function mountCard(
  props: {
    batchId?: number;
    mode?: string;
    recipientCount?: number;
    batchStatus?: string;
    reasonCode?: string;
    sentCount?: number;
  } = {}
) {
  return mount(OutboundEmailBatchCard, {
    global: {
      plugins: [i18n],
      stubs: {
        VCard: { template: "<div><slot /></div>" },
        VCardItem: { template: "<div><slot /></div>" },
        VCardActions: { template: "<div><slot /></div>" },
        VBtn: {
          inheritAttrs: false,
          emits: ["click"],
          template: `<button v-bind="$attrs" @click="$emit('click')"><slot /></button>`,
        },
        VIcon: true,
        VChip: { template: "<span><slot /></span>" },
        VDivider: true,
      },
    },
    props: {
      batchId: props.batchId ?? 1,
      mode: props.mode ?? "review_first",
      recipientCount: props.recipientCount ?? 2,
      batchStatus: props.batchStatus ?? "draft_ready",
      reasonCode: props.reasonCode ?? "explicit_review_instruction",
      sentCount: props.sentCount ?? 0,
    },
  });
}

describe("OutboundEmailBatchCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the batch title, recipient count, and mode", () => {
    const wrapper = mountCard({ mode: "send_now", recipientCount: 3 });
    expect(wrapper.text()).toContain("Outbound Email Batch");
    expect(wrapper.text()).toContain("3");
    expect(wrapper.text()).toContain("Send Now");
  });

  it("shows a Review button that emits review-requested with the batchId", async () => {
    const wrapper = mountCard({ batchId: 42 });
    await wrapper
      .find('[data-testid="outbound-batch-review"]')
      .trigger("click");
    const payload = wrapper.emitted("review-requested")?.[0]?.[0];
    expect(payload).toBe(42);
  });

  it("shows a review-required reason when mode is review_first", () => {
    const wrapper = mountCard({ mode: "review_first" });
    expect(wrapper.text()).toContain("Review required");
  });

  it("hides the Review button and shows a sent summary when status is sent", () => {
    const wrapper = mountCard({ batchStatus: "sent", sentCount: 2 });
    expect(wrapper.find('[data-testid="outbound-batch-review"]').exists()).toBe(
      false
    );
    expect(wrapper.text()).toContain("Batch sent.");
  });

  it("shows a delivery-unknown summary (no review button) for delivery_unknown", () => {
    const wrapper = mountCard({ batchStatus: "delivery_unknown" });
    expect(wrapper.find('[data-testid="outbound-batch-review"]').exists()).toBe(
      false
    );
    expect(wrapper.text()).toContain("Delivery status unknown.");
  });

  it("shows a discarded summary for discarded status", () => {
    const wrapper = mountCard({ batchStatus: "discarded" });
    expect(wrapper.text()).toContain("Batch discarded.");
  });

  it("shows a partial summary when only some recipients sent", () => {
    const wrapper = mountCard({
      batchStatus: "partially_sent",
      recipientCount: 3,
      sentCount: 1,
    });
    expect(wrapper.text()).toContain("Batch partially sent.");
  });
});
