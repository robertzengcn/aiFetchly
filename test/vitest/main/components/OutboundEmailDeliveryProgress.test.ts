import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import OutboundEmailDeliveryProgress from "@/views/components/outboundEmail/OutboundEmailDeliveryProgress.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: {
      outboundEmail: {
        progress_title: "Delivery Progress",
        recipient: "Recipient",
        status: "Status",
        submitted: "Submitted",
        sent: "Sent",
        failed: "Failed",
        delivery_unknown: "Delivery Unknown",
        unknown_no_retry: "Status unknown — do not auto-retry.",
        retry: "Retry",
        completed: "Complete",
      },
    },
  },
});

interface ProgressProps {
  outcomes?: Array<{
    draftId: number;
    recipientAddress: string;
    status: string;
    errorCode: string | null;
    providerMessageId: string | null;
  }>;
  attemptStatus?: string | null;
}

function mountProgress(props: ProgressProps = {}) {
  return mount(OutboundEmailDeliveryProgress, {
    global: {
      plugins: [i18n],
      stubs: {
        VCard: { template: "<div><slot /></div>" },
        VCardItem: { template: "<div><slot /></div>" },
        VCardText: { template: "<div><slot /></div>" },
        VListItem: { template: "<div><slot /></div>" },
        VIcon: true,
        VChip: { template: "<span><slot /></span>" },
        VBtn: {
          inheritAttrs: false,
          emits: ["click"],
          template: `<button v-bind="$attrs" @click="$emit('click')"><slot /></button>`,
        },
        VProgressLinear: true,
      },
    },
    props: {
      outcomes: props.outcomes ?? [],
      attemptStatus: props.attemptStatus ?? null,
    },
  });
}

describe("OutboundEmailDeliveryProgress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders empty state when there are no outcomes", () => {
    const wrapper = mountProgress();
    expect(wrapper.text()).toContain("Delivery Progress");
  });

  it("renders one row per outcome with recipient address + status", () => {
    const wrapper = mountProgress({
      outcomes: [
        {
          draftId: 1,
          recipientAddress: "alice@example.com",
          status: "submitted",
          errorCode: null,
          providerMessageId: "mid-1",
        },
        {
          draftId: 2,
          recipientAddress: "bob@example.com",
          status: "sent",
          errorCode: null,
          providerMessageId: "mid-2",
        },
      ],
    });
    expect(wrapper.text()).toContain("alice@example.com");
    expect(wrapper.text()).toContain("bob@example.com");
    expect(wrapper.text()).toContain("Submitted");
    expect(wrapper.text()).toContain("Sent");
  });

  it("shows a Failed status and a retry button for a failed recipient", () => {
    const wrapper = mountProgress({
      outcomes: [
        {
          draftId: 3,
          recipientAddress: "carol@example.com",
          status: "failed",
          errorCode: "smtp_timeout",
          providerMessageId: null,
        },
      ],
    });
    expect(wrapper.text()).toContain("Failed");
    expect(
      wrapper.find('[data-testid="outbound-progress-retry-3"]').exists()
    ).toBe(true);
  });

  it("shows delivery_unknown status WITHOUT a one-click retry button", () => {
    const wrapper = mountProgress({
      outcomes: [
        {
          draftId: 4,
          recipientAddress: "dave@example.com",
          status: "delivery_unknown",
          errorCode: null,
          providerMessageId: null,
        },
      ],
    });
    expect(wrapper.text()).toContain("Delivery Unknown");
    expect(wrapper.text()).toMatch(/do not auto-retry/i);
    // CRITICAL (§18): never offer one-click retry for delivery_unknown.
    expect(
      wrapper.find('[data-testid="outbound-progress-retry-4"]').exists()
    ).toBe(false);
  });

  it("emits retry with draftId when the retry button is clicked for a failed recipient", async () => {
    const wrapper = mountProgress({
      outcomes: [
        {
          draftId: 5,
          recipientAddress: "eve@example.com",
          status: "failed",
          errorCode: "smtp_timeout",
          providerMessageId: null,
        },
      ],
    });
    await wrapper
      .find('[data-testid="outbound-progress-retry-5"]')
      .trigger("click");
    expect(wrapper.emitted("retry")?.[0]?.[0]).toBe(5);
  });
});
