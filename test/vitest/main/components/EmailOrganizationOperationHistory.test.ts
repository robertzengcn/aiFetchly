import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { describe, it, expect, vi, beforeEach } from "vitest";
import History from "@/views/components/emailOrganization/EmailOrganizationOperationHistory.vue";
import {
  listEmailOrganizationOperations,
  restoreFromOperation,
} from "@/views/api/emailorganization";
import type { EmailOrganizationOperationDto } from "@/entityTypes/emailOrganizationTypes";

vi.mock("@/views/api/emailorganization", () => ({
  listEmailOrganizationOperations: vi.fn(),
  restoreFromOperation: vi.fn(),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      emailOrganization: {
        history_title: "Organization history",
        history_load_failed: "The operation history could not be loaded.",
        history_empty: "No organization actions recorded for this message yet.",
        counts_line: "{completed} ok / {failed} failed / {unresolved} unknown",
        op_kind: { forward: "Forward", trash: "Trash", restore: "Restore" },
        op_status: {
          succeeded: "Succeeded",
          partially_succeeded: "Partially succeeded",
          failed: "Failed",
          needs_reconciliation: "Unknown",
          running: "Running",
          cancelled: "Cancelled",
        },
        undo_action: "Undo",
      },
      emailReceive: { retry: "Retry" },
    },
  },
  missingWarn: false,
});

function operationFixture(
  overrides?: Partial<EmailOrganizationOperationDto>
): EmailOrganizationOperationDto {
  return {
    operationId: "op-trash-123456",
    kind: "trash",
    status: "succeeded",
    emailServiceId: 1,
    itemCounts: { completed: 1, failed: 0, unresolved: 0, pending: 0, cancelled: 0 },
    items: [],
    createdAt: new Date("2026-11-10T10:00:00Z").toISOString(),
    completedAt: null,
    cancelRequestedAt: null,
    errorCode: null,
    retryable: false,
    ...overrides,
  };
}

function mountHistory(messageId = 42) {
  return mount(History, {
    props: { messageId },
    global: {
      plugins: [i18n],
      stubs: {
        VCard: { template: "<div><slot /></div>" },
        VList: { template: "<div><slot /></div>" },
        VListItem: { template: "<div data-testid='history-item'><slot /><slot name='append' /></div>" },
        VBtn: {
          props: ["loading", "disabled", "color"],
          emits: ["click"],
          template: `<button :disabled="disabled || loading" @click="$emit('click')"><slot /></button>`,
        },
        VChip: { template: "<span><slot /></span>" },
        VIcon: { template: "<i />" },
        VAlert: { template: "<div role='alert'><slot /></div>", props: ["type"] },
        VSpacer: { template: "<span />" },
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EmailOrganizationOperationHistory (R5-08)", () => {
  it("renders the persisted operations for the message with localized status", async () => {
    vi.mocked(listEmailOrganizationOperations).mockResolvedValue({
      operations: [
        operationFixture(),
        operationFixture({
          operationId: "op-fwd-654321",
          kind: "forward",
          status: "partially_succeeded",
        }),
      ],
    });
    const wrapper = mountHistory();
    await flushPromises();
    expect(listEmailOrganizationOperations).toHaveBeenCalledWith({
      messageId: 42,
      limit: 20,
    });
    const html = wrapper.text();
    expect(html).toContain("Trash");
    expect(html).toContain("Succeeded");
    expect(html).toContain("Forward");
    expect(html).toContain("Partially succeeded");
    // The succeeded Trash row exposes a durable Undo entry.
    const buttons = wrapper.findAll("button");
    expect(buttons.some((button) => button.text().includes("Undo"))).toBe(true);
  });

  it("shows the empty state before any action exists", async () => {
    vi.mocked(listEmailOrganizationOperations).mockResolvedValue({ operations: [] });
    const wrapper = mountHistory();
    await flushPromises();
    expect(wrapper.text()).toContain("No organization actions recorded");
  });

  it("shows an honest failure state instead of pretending the list is empty", async () => {
    vi.mocked(listEmailOrganizationOperations).mockRejectedValue(new Error("ipc down"));
    const wrapper = mountHistory();
    await flushPromises();
    expect(wrapper.text()).toContain("could not be loaded");
  });

  it("a failed restore surfaces the operation through operation-active (never a silent no-op)", async () => {
    vi.mocked(listEmailOrganizationOperations).mockResolvedValue({
      operations: [operationFixture()],
    });
    vi.mocked(restoreFromOperation).mockResolvedValue({
      success: false,
      operationId: "op-trash-123456",
      status: "needs_reconciliation",
      completed: 0,
      failed: 1,
      unresolved: 0,
      pending: 0,
      cancelled: 0,
      errorCode: "LOCATION_STALE",
      retryable: false,
    });
    const wrapper = mountHistory();
    await flushPromises();
    const undoButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Undo"));
    expect(undoButton).toBeDefined();
    await undoButton!.trigger("click");
    await flushPromises();
    expect(restoreFromOperation).toHaveBeenCalledWith("op-trash-123456");
    expect(wrapper.emitted("operation-active")).toEqual([["op-trash-123456"]]);
  });

  it("a successful restore emits restored and reloads the history", async () => {
    vi.mocked(listEmailOrganizationOperations).mockResolvedValue({
      operations: [operationFixture()],
    });
    vi.mocked(restoreFromOperation).mockResolvedValue({
      success: true,
      operationId: "op-restore-99999",
      status: "succeeded",
      completed: 1,
      failed: 0,
      unresolved: 0,
      pending: 0,
      cancelled: 0,
      errorCode: null,
      retryable: false,
    });
    const wrapper = mountHistory();
    await flushPromises();
    const undoButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Undo"));
    await undoButton!.trigger("click");
    await flushPromises();
    expect(wrapper.emitted("restored")).toHaveLength(1);
    // History reloaded after the restore (the Trash row leaves the list).
    expect(listEmailOrganizationOperations).toHaveBeenCalledTimes(2);
  });
});
