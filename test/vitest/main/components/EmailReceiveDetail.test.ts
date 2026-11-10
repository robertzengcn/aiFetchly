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
  getForwardDraftForMessage: vi.fn(),
  listEmailOrganizationOperations: vi.fn(),
}));

vi.mock("@/views/api/emailreceive", () => ({
  getReceivedMessage: mocks.getReceivedMessage,
}));
vi.mock("@/views/api/emailorganization", () => ({
  moveMessageToTrash: mocks.moveMessageToTrash,
  restoreFromOperation: mocks.restoreFromOperation,
  getForwardDraftForMessage: mocks.getForwardDraftForMessage,
  listEmailOrganizationOperations: mocks.listEmailOrganizationOperations,
}));
vi.mock("vue-router", () => ({
  useRoute: () => ({ params: { id: routeId.value }, query: {} }),
  useRouter: () => ({ push: vi.fn() }),
}));

import Detail from "@/views/pages/emailreceive/detail.vue";
import EmailOrganizationOperationHistory from "@/views/components/emailOrganization/EmailOrganizationOperationHistory.vue";

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
        classification_state: {
          interested: "Interested",
          support_request: "Support request",
        },
        reply_status: "Reply status",
        thread_label: "Thread",
        image_hidden: "[image hidden]",
        load_failed: "The message could not be loaded.",
        invalid_message_id: "This message id is not valid.",
        retry: "Retry",
        status: { not_started: "Not started", sent: "Sent" },
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
        EmailForwardReviewDialog: {
          props: ["messageId", "existingDraftId"],
          emits: ["closed", "sent", "draft-saved"],
          template: `<div data-testid='forward-dialog-stub' v-if='messageId'>draft={{ existingDraftId === null ? 'none' : existingDraftId }}</div>`,
        },
        EmailOrganizationOperationCard: {
          props: ["operationId"],
          template: `<div data-testid='operation-card-stub'>card {{ operationId }}</div>`,
        },
        EmailOrganizationOperationHistory: {
          props: ["messageId"],
          emits: ["restored", "operation-active"],
          template: `<div data-testid='history-stub'>history {{ messageId }}</div>`,
        },
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
  mocks.getForwardDraftForMessage.mockResolvedValue({ draftId: null, status: null });
  mocks.listEmailOrganizationOperations.mockResolvedValue({ operations: [] });
});

describe("EmailReceiveDetail durable draft resume + history (R5-08)", () => {
  it("opening Forward resolves the SAVED draft durably from the database (remount-safe)", async () => {
    mocks.getReceivedMessage.mockResolvedValue(detailRow);
    mocks.getForwardDraftForMessage.mockResolvedValue({ draftId: 77, status: "ready" });
    const wrapper = mountDetail();
    await flushPromises();
    const forwardButton = wrapper.find("[data-testid='org-forward-button']");
    await forwardButton.trigger("click");
    await flushPromises();
    // The resume anchor came from the durable lookup, not page memory.
    expect(mocks.getForwardDraftForMessage).toHaveBeenCalledWith(42);
    expect(wrapper.find("[data-testid='forward-dialog-stub']").text()).toContain("draft=77");
  });

  it("after a send (terminal state) the next Forward opens fresh — no stale draft id", async () => {
    mocks.getReceivedMessage.mockResolvedValue(detailRow);
    // The durable lookup no longer returns a draft once it was submitted.
    mocks.getForwardDraftForMessage.mockResolvedValue({ draftId: null, status: null });
    const wrapper = mountDetail();
    await flushPromises();
    await wrapper.find("[data-testid='org-forward-button']").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid='forward-dialog-stub']").text()).toContain("draft=none");
  });

  it("the durable history mounts for the loaded message (Undo survives navigation)", async () => {
    mocks.getReceivedMessage.mockResolvedValue(detailRow);
    const wrapper = mountDetail();
    await flushPromises();
    expect(wrapper.find("[data-testid='history-stub']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='history-stub']").text()).toContain("history 42");
  });

  it("an operation surfaced from history renders through the shared operation card", async () => {
    mocks.getReceivedMessage.mockResolvedValue(detailRow);
    const wrapper = mountDetail();
    await flushPromises();
    const historyComponent = wrapper.findComponent(EmailOrganizationOperationHistory);
    expect(historyComponent.exists()).toBe(true);
    historyComponent.vm.$emit("operation-active", "op-hist-123456");
    await flushPromises();
    const card = wrapper.find("[data-testid='operation-card-stub']");
    expect(card.exists()).toBe(true);
    expect(card.text()).toContain("op-hist-123456");
  });
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
