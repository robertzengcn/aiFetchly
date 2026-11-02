import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Card from "@/views/components/emailOrganization/EmailOrganizationOperationCard.vue";
import {
  getEmailOrganizationOperation,
  restoreFromOperation,
  reconcileEmailOrganizationOperation,
} from "@/views/api/emailorganization";
import type { EmailOrganizationOperationDto } from "@/entityTypes/emailOrganizationTypes";

vi.mock("@/views/api/emailorganization", () => ({
  getEmailOrganizationOperation: vi.fn(),
  restoreFromOperation: vi.fn(),
  reconcileEmailOrganizationOperation: vi.fn(),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      emailOrganization: {
        op_trash_succeeded: "Moved to Trash",
        op_trash_needs_reconciliation: "Trash outcome unknown",
        undo_action: "Undo",
        check_status_action: "Check status",
        count_completed: "{n} completed",
      },
    },
  },
  missingWarn: false,
});

function operationFixture(
  overrides?: Partial<EmailOrganizationOperationDto>
): EmailOrganizationOperationDto {
  return {
    operationId: "op-abc-12345",
    kind: "trash",
    status: "succeeded",
    emailServiceId: 1,
    itemCounts: { completed: 1, failed: 0, unresolved: 0, pending: 0, cancelled: 0 },
    items: [
      {
        itemId: 1,
        messageId: 42,
        status: "succeeded",
        beforeFolderPath: "INBOX",
        destinationFolderPath: "Trash",
        errorCode: null,
        sanitizedError: null,
        recipientOutcomes: [],
      },
    ],
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    cancelRequestedAt: null,
    errorCode: null,
    retryable: false,
    ...overrides,
  };
}

function mountCard(operationId: string | null = "op-abc-12345") {
  return mount(Card, {
    props: { operationId },
    global: {
      plugins: [i18n],
      stubs: {
        VCard: { template: "<div><slot /></div>" },
        VCardText: { template: "<div><slot /></div>" },
        VBtn: {
          props: ["loading", "disabled", "color"],
          emits: ["click"],
          template: `<button :disabled="disabled || loading" @click="$emit('click')"><slot /></button>`,
        },
        VAlert: { template: "<div role='alert'><slot /></div>", props: ["type"] },
        VIcon: { template: "<i></i>", props: ["icon", "color", "size"] },
        VSpacer: { template: "<span></span>" },
      },
    },
  });
}

const mockGet = vi.mocked(getEmailOrganizationOperation);
const mockRestore = vi.mocked(restoreFromOperation);
const mockReconcile = vi.mocked(reconcileEmailOrganizationOperation);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EmailOrganizationOperationCard", () => {
  it("renders a successful trash operation with an Undo action", async () => {
    mockGet.mockResolvedValue({ operation: operationFixture() });
    const wrapper = mountCard();
    await flushPromises();

    expect(wrapper.text()).toContain("Moved to Trash");
    expect(wrapper.text()).toContain("1 completed");
    expect(wrapper.find("[data-testid='org-op-undo']").exists()).toBe(true);
  });

  it("hides Undo for non-trash kinds", async () => {
    mockGet.mockResolvedValue({
      operation: operationFixture({ kind: "forward", status: "succeeded" }),
    });
    const wrapper = mountCard();
    await flushPromises();
    expect(wrapper.find("[data-testid='org-op-undo']").exists()).toBe(false);
  });

  it("offers reconciliation for unknown outcomes instead of retry", async () => {
    mockGet.mockResolvedValue({
      operation: operationFixture({
        status: "needs_reconciliation",
        itemCounts: { completed: 0, failed: 0, unresolved: 1, pending: 0, cancelled: 0 },
      }),
    });
    const wrapper = mountCard();
    await flushPromises();
    expect(wrapper.find("[data-testid='org-op-undo']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='org-op-reconcile']").exists()).toBe(true);
  });

  it("restores via the prior operation id and refreshes", async () => {
    mockGet.mockResolvedValue({ operation: operationFixture() });
    mockRestore.mockResolvedValue({
      success: true,
      operationId: "op-restore-1",
      status: "succeeded",
      completed: 1,
      failed: 0,
      unresolved: 0,
      pending: 0,
      cancelled: 0,
      errorCode: null,
      retryable: false,
      priorOperationId: "op-abc-12345",
    });
    const wrapper = mountCard();
    await flushPromises();

    await wrapper.find("[data-testid='org-op-undo']").trigger("click");
    await flushPromises();
    expect(mockRestore).toHaveBeenCalledWith("op-abc-12345");
    expect(wrapper.emitted("restored")).toEqual([["op-restore-1"]]);
  });

  it("shows per-item errors when an item failed", async () => {
    mockGet.mockResolvedValue({
      operation: operationFixture({
        status: "failed",
        itemCounts: { completed: 0, failed: 1, unresolved: 0, pending: 0, cancelled: 0 },
        items: [
          {
            itemId: 2,
            messageId: 42,
            status: "failed",
            beforeFolderPath: "INBOX",
            destinationFolderPath: "Trash",
            errorCode: "CAPABILITY_UNSUPPORTED",
            sanitizedError: "Server does not support native MOVE.",
            recipientOutcomes: [],
          },
        ],
      }),
    });
    const wrapper = mountCard();
    await flushPromises();
    expect(wrapper.text()).toContain("CAPABILITY_UNSUPPORTED");
    expect(wrapper.find("[data-testid='org-op-undo']").exists()).toBe(false);
  });

  it("renders nothing meaningful for a missing operation id", async () => {
    const wrapper = mountCard(null);
    await flushPromises();
    expect(mockGet).not.toHaveBeenCalled();
    expect(wrapper.find("[data-testid='org-op-undo']").exists()).toBe(false);
  });
});

void mockReconcile;
