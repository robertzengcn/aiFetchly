import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { describe, it, expect, vi, beforeEach } from "vitest";

// BUG-04/BUG-05: the receive detail page must surface load failures with a
// retry control, refuse invalid ids, and translate every displayed label and
// enum state (Thread, image placeholder, classification, reply status).

const mocks = vi.hoisted(() => ({
  getReceivedMessage: vi.fn(),
  moveMessageToTrash: vi.fn(),
  restoreFromOperation: vi.fn(),
}));

vi.mock("@/views/api/emailreceive", () => ({
  getReceivedMessage: mocks.getReceivedMessage,
}));
vi.mock("@/views/api/emailorganization", () => ({
  moveMessageToTrash: mocks.moveMessageToTrash,
  restoreFromOperation: mocks.restoreFromOperation,
}));
vi.mock("vue-router", () => ({
  useRoute: () => ({ params: { id: routeId.value }, query: {} }),
  useRouter: () => ({ push: vi.fn() }),
}));

import Detail from "@/views/pages/emailreceive/detail.vue";

const routeId = { value: "42" };

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      common: { return: "Return" },
      route: { email_receive_detail: "Message" },
      emailReceive: {
        message_detail: "Message detail",
        from: "From",
        reply_to: "Reply-To",
        received_at: "Received",
        classification: "Classification",
        reply_status: "Reply status",
        thread_label: "Thread",
        image_hidden: "[image hidden]",
        load_failed: "The message could not be loaded.",
        invalid_message_id: "This message id is not valid.",
        retry: "Retry",
        status: { not_started: "Not started", sent: "Sent" },
        classification: {
          interested: "Interested",
          support_request: "Support request",
        },
      },
      emailOrganization: {
        forward_button: "Forward",
        trash_button: "Trash",
        undo_action: "Undo",
      },
    },
  },
  missingWarn: false,
});

const detailRow = {
  id: 42,
  emailServiceId: 1,
  fromAddress: "sender@example.test",
  fromName: "Sender",
  replyToAddress: null,
  receivedAt: "2026-11-01T00:00:00Z",
  classification: "support_request",
  replyStatus: "not_started",
  threadKey: "thread-abc",
  subject: "Hello",
  bodyText: "body text",
  bodyHtmlSanitized: '<p>hi <img src="https://x.test/p.png"></p>',
};

function mountDetail() {
  return mount(Detail, {
    global: {
      plugins: [i18n],
      stubs: {
        AppPageShell: { template: "<div><slot /></div>", props: ["pageId", "titleKey"] },
        VSheet: { template: "<div><slot /></div>" },
        VBtn: {
          props: ["loading", "disabled", "color"],
          emits: ["click"],
          template: `<button :disabled="disabled || loading" @click="$emit('click')"><slot /></button>`,
        },
        VAlert: { template: "<div role='alert'><slot /></div>", props: ["type"] },
        VCard: { template: "<div><slot /></div>", props: ["variant"] },
        VIcon: { template: "<i></i>", props: ["start"] },
        VProgressLinear: { template: "<div></div>", props: ["indeterminate"] },
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  routeId.value = "42";
});

describe("EmailReceiveDetail load states (BUG-04)", () => {
  it("renders the message and translated enum labels on success", async () => {
    mocks.getReceivedMessage.mockResolvedValue(detailRow);
    const wrapper = mountDetail();
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain("Thread:");
    expect(text).toContain("Support request");
    expect(text).toContain("Not started");
  });

  it("shows a retryable error state when loading rejects", async () => {
    mocks.getReceivedMessage.mockRejectedValue(new Error("ipc boom"));
    const wrapper = mountDetail();
    await flushPromises();
    const alert = wrapper.find("[data-testid='detail-load-error']");
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("could not be loaded");

    // Retry recovers.
    mocks.getReceivedMessage.mockResolvedValue(detailRow);
    await wrapper.find("[data-testid='detail-retry']").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid='detail-load-error']").exists()).toBe(false);
    expect(wrapper.text()).toContain("Hello");
    expect(mocks.getReceivedMessage).toHaveBeenCalledTimes(2);
  });

  it("refuses an invalid route id without any fetch", async () => {
    routeId.value = "not-a-number";
    const wrapper = mountDetail();
    await flushPromises();
    expect(mocks.getReceivedMessage).not.toHaveBeenCalled();
    expect(wrapper.find("[data-testid='detail-invalid-id']").exists()).toBe(true);
  });

  it("keyboard-operates the retry control (button element)", async () => {
    mocks.getReceivedMessage.mockRejectedValue(new Error("boom"));
    const wrapper = mountDetail();
    await flushPromises();
    const retry = wrapper.find("[data-testid='detail-retry']");
    expect(retry.element.tagName).toBe("BUTTON");
    expect((retry.element as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("EmailReceiveDetail image placeholder (BUG-05)", () => {
  it("replaces remote images with a translated placeholder and keeps them blocked", async () => {
    mocks.getReceivedMessage.mockResolvedValue(detailRow);
    const wrapper = mountDetail();
    await flushPromises();
    const html = wrapper.find(".email-body").html();
    expect(html).not.toContain("https://x.test/p.png");
    expect(wrapper.text()).toContain("[image hidden]");
  });
});
