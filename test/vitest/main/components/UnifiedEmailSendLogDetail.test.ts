import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createRouter, createMemoryHistory } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SendLogDetail from "@/views/pages/emailSendTaskLog/detail.vue";
import type { UnifiedSendLogDetailEntry } from "@/entityTypes/buckemailType";

// Mock the detail API so no IPC is invoked.
const apiMocks = vi.hoisted(() => ({
  getUnifiedEmailSendLogDetail: vi.fn(),
}));

vi.mock("@/views/api/buckemail", () => ({
  getUnifiedEmailSendLogDetail: (...args: unknown[]) =>
    apiMocks.getUnifiedEmailSendLogDetail(...args),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: {
      common: { return: "return" },
      emailtasksendlog: {
        id: "id",
        status: "status",
        receiver: "receiver",
        title: "title",
        content: "content",
        record_time: "record time",
        source: "source",
        source_legacy: "Legacy",
        source_authorized: "Authorized",
        detail_title: "Send Log Detail",
        log: "log",
        task_id: "task id",
        sender: "sender",
        actor: "actor",
        body: "body",
        provider_message_id: "provider message id",
        error_code: "error code",
        submitted_at: "submitted at",
        completed_at: "completed at",
        batch_id: "batch id",
        draft_id: "draft id",
        revision_id: "revision id",
        attempt_id: "send attempt id",
        detail_not_found: "Send log record not found",
      },
    },
  },
});

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/sendlog/detail/:source/:id",
        name: "UNIFIED_EMAIL_SEND_LOG_DETAIL",
        component: SendLogDetail,
      },
      {
        path: "/sendlog",
        name: "UNIFIED_EMAIL_SEND_LOG",
        component: { template: "<div />" },
      },
    ],
  });
}

const stubs = {
  VSheet: { template: "<div><slot /></div>" },
  VCard: { template: '<div class="v-card"><slot /></div>' },
  VRow: { template: "<div><slot /></div>" },
  VCol: { template: "<div><slot /></div>" },
  VChip: {
    props: ["size", "color", "variant"],
    template: '<span class="v-chip"><slot /></span>',
  },
  VBtn: {
    props: ["color", "variant"],
    template:
      '<button data-testid="back-btn" @click="$emit(\'click\')"><slot /></button>',
  },
  VProgressLinear: { props: ["indeterminate"], template: "<div />" },
  VAlert: {
    props: ["type", "density"],
    template: '<div data-testid="error-alert"><slot /></div>',
  },
  VIcon: { props: ["start", "size", "color"], template: "<i><slot /></i>" },
};

const LEGACY_DETAIL: UnifiedSendLogDetailEntry = {
  id: 11,
  source: "legacy",
  status: "Success",
  receiver: "alice@example.com",
  title: "Welcome Alice",
  record_time: "2026-09-01T00:00:00.000Z",
  content: "full legacy body",
  log: "smtp transcript",
  taskId: 1001,
};

const AUTHORIZED_DETAIL: UnifiedSendLogDetailEntry = {
  id: 12,
  source: "authorized",
  status: "Failure",
  receiver: "bob@example.com",
  title: "Authorized Send",
  record_time: "2026-09-02T00:00:00.000Z",
  sender: "sender@example.com",
  actor: "ai",
  bodyText: "authorized body text",
  providerMessageId: "prov-123",
  errorCode: "smtp_rejected",
  submittedAt: "2026-09-02T00:00:01.000Z",
  completedAt: "2026-09-02T00:00:02.000Z",
  batchId: 5,
  draftId: 7,
  revisionId: 9,
  attemptId: 3,
};

async function mountDetail(source: string, id: string) {
  const router = createTestRouter();
  await router.push(`/sendlog/detail/${source}/${id}`);
  await router.isReady();
  const wrapper = mount(SendLogDetail, {
    global: { plugins: [i18n, router], stubs },
  });
  // Flush the onMounted async work. Tests that expect an API call do their
  // own waitFor — the invalid-source guard test must NOT see one.
  await vi.dynamicImportSettled();
  return { wrapper, router };
}

describe("SendLogDetail (unified send-log detail page)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the legacy variant (content + log + task id)", async () => {
    apiMocks.getUnifiedEmailSendLogDetail.mockResolvedValue(LEGACY_DETAIL);
    const { wrapper } = await mountDetail("legacy", "11");
    await vi.waitFor(() => {
      expect(apiMocks.getUnifiedEmailSendLogDetail).toHaveBeenCalled();
    });
    await vi.dynamicImportSettled();

    expect(wrapper.text()).toContain("Welcome Alice");
    expect(wrapper.text()).toContain("alice@example.com");
    expect(wrapper.text()).toContain("full legacy body");
    expect(wrapper.text()).toContain("smtp transcript");
    expect(wrapper.text()).toContain("1001");
    // The authorized-only envelope card is absent on a legacy row.
    expect(wrapper.text()).not.toContain("provider message id");
  });

  it("renders the authorized variant (revision body + sender + envelope)", async () => {
    apiMocks.getUnifiedEmailSendLogDetail.mockResolvedValue(AUTHORIZED_DETAIL);
    const { wrapper } = await mountDetail("authorized", "12");
    await vi.waitFor(() => {
      expect(apiMocks.getUnifiedEmailSendLogDetail).toHaveBeenCalled();
    });
    await vi.dynamicImportSettled();

    expect(wrapper.text()).toContain("Authorized Send");
    expect(wrapper.text()).toContain("bob@example.com");
    expect(wrapper.text()).toContain("authorized body text");
    expect(wrapper.text()).toContain("sender@example.com");
    expect(wrapper.text()).toContain("prov-123");
    expect(wrapper.text()).toContain("smtp_rejected");
    // The legacy-only log card is absent on an authorized row.
    expect(wrapper.text()).not.toContain("smtp transcript");
  });

  it("shows an error alert when the detail fetch fails", async () => {
    apiMocks.getUnifiedEmailSendLogDetail.mockRejectedValue(
      new Error("send log record not found")
    );
    const { wrapper } = await mountDetail("legacy", "999999");
    // Wait for the rejection to surface in the error alert.
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="error-alert"]').exists()).toBe(true);
    });
    expect(wrapper.text()).toContain("Send log record not found");
  });

  it("shows an error alert for an invalid source param (route guard)", async () => {
    // An invalid source must not reach the API.
    const { wrapper } = await mountDetail("bogus", "11");
    await vi.dynamicImportSettled();
    expect(apiMocks.getUnifiedEmailSendLogDetail).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="error-alert"]').exists()).toBe(true);
  });

  it("returns to the previous page via the back button", async () => {
    apiMocks.getUnifiedEmailSendLogDetail.mockResolvedValue(LEGACY_DETAIL);
    const { wrapper, router } = await mountDetail("legacy", "11");
    await vi.waitFor(() => {
      expect(apiMocks.getUnifiedEmailSendLogDetail).toHaveBeenCalled();
    });

    const goSpy = vi.spyOn(router, "go");
    await wrapper.find('[data-testid="back-btn"]').trigger("click");
    expect(goSpy).toHaveBeenCalledWith(-1);
  });
});
