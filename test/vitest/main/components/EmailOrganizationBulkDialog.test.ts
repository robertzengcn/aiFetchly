import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { describe, it, expect, vi, beforeEach } from "vitest";
import BulkDialog from "@/views/components/emailOrganization/EmailOrganizationBulkDialog.vue";
import {
  getEmailOrganizationCapabilities,
  getEmailOrganizationOperation,
  searchEmailsOrganization,
  prepareEmailSelection,
  startTrashSelection,
  cancelEmailOrganizationOperation,
} from "@/views/api/emailorganization";
import type { OrganizationSearchResultDto, SelectionPreviewDto } from "@/views/api/emailorganization";
import type { EmailOrganizationOperationDto } from "@/entityTypes/emailOrganizationTypes";

vi.mock("@/views/api/emailorganization", () => ({
  getEmailOrganizationCapabilities: vi.fn(),
  getEmailOrganizationOperation: vi.fn(),
  searchEmailsOrganization: vi.fn(),
  prepareEmailSelection: vi.fn(),
  startTrashSelection: vi.fn(),
  cancelEmailOrganizationOperation: vi.fn(),
  restoreFromOperation: vi.fn(),
  listEmailOrganizationOperations: vi.fn(),
}));

vi.mock("@/views/components/emailOrganization/EmailOrganizationOperationCard.vue", () => ({
  default: {
    name: "EmailOrganizationOperationCard",
    props: ["operationId"],
    template: "<div data-testid='operation-card-stub'>card {{ operationId }}</div>",
  },
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      emailOrganization: {
        bulk_title: "Bulk trash",
        bulk_subject: "Subject",
        bulk_from: "From",
        bulk_search: "Search",
        bulk_result_line: "{count} rows",
        bulk_clear_selection: "Clear selection",
        bulk_col_subject: "Subject",
        bulk_col_folder: "Folder",
        bulk_freeze: "Freeze selection",
        bulk_preview_title: "Frozen selection",
        bulk_preview_line: "{count} messages will move to {destination}. Expires in {minutes} min.",
        bulk_preview_expires: "Expires at {at}",
        bulk_execute: "Move to Trash",
        bulk_progress: "{done}/{total}",
        bulk_unavailable: "This account cannot move messages to Trash.",
        bulk_incomplete: "Results are incomplete; page again before freezing.",
        cancel_button: "Cancel",
      },
      common: { close: "Close", search: "Search" },
    },
  },
  missingWarn: false,
});

function searchFixture(): OrganizationSearchResultDto {
  return {
    source: "local",
    emailServiceId: 7,
    searchedFolders: ["ALL_LOCAL"],
    failedFolders: [],
    rows: [
      { messageId: 101, providerUid: "u1", folderPath: "INBOX", fromAddress: "a@b.test", subject: "invoice 1", receivedAt: "2026-09-01T10:00:00Z", isUnread: false, hasAttachments: false },
      { messageId: 102, providerUid: "u2", folderPath: "INBOX", fromAddress: "a@b.test", subject: "invoice 2", receivedAt: "2026-09-02T10:00:00Z", isUnread: false, hasAttachments: false },
      { messageId: 103, providerUid: "u3", folderPath: "Archive", fromAddress: "a@b.test", subject: "invoice 3", receivedAt: "2026-09-03T10:00:00Z", isUnread: false, hasAttachments: false },
    ],
    totalMatched: 3,
    complete: true,
    truncated: false,
    lastSyncAt: null,
    limitation: null,
    nextCursor: null,
  };
}

function previewFixture(): SelectionPreviewDto {
  return {
    selectionId: "sel-12345678",
    kind: "trash",
    emailServiceId: 7,
    count: 2,
    payloadHash: "a".repeat(64),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    filtersSummary: null,
  };
}

function mountDialog() {
  return mount(BulkDialog, {
    props: { modelValue: true, emailServiceId: 7 },
    global: {
      plugins: [i18n],
      stubs: {
        VDialog: { template: "<div><slot /></div>", props: ["modelValue"] },
        VCard: { template: "<div><slot /><slot name='title' /><slot name='text' /></div>" },
        VCardTitle: { template: "<div><slot /></div>" },
        VCardText: { template: "<div><slot /></div>" },
        VDivider: { template: "<hr />" },
        VTextField: {
          props: ["modelValue", "label"],
          emits: ["update:modelValue"],
          template: `<input :placeholder="label" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
        },
        VBtn: {
          props: ["loading", "disabled", "color", "icon"],
          emits: ["click"],
          template: `<button :data-icon="icon ? 'icon' : null" :disabled="disabled || loading" @click="$emit('click')"><slot /></button>`,
        },
        VAlert: { template: "<div role='alert'><slot /></div>", props: ["type"] },
        VTable: { template: "<table><slot /></table>" },
        VCheckbox: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template: `<input type='checkbox' :checked="modelValue" @change="$emit('update:modelValue', $event.target.checked)" />`,
        },
        VIcon: { template: "<i />" },
        VSpacer: { template: "<span />" },
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEmailOrganizationCapabilities).mockResolvedValue({
    emailServiceId: 7,
    protocol: "imap",
    canFetchFullSource: true,
    canSendForward: true,
    canMoveToTrash: true,
    canRestore: true,
    trashFolderPath: "Trash",
    reasonCodes: [],
    resolvedAt: new Date().toISOString(),
  });
});

describe("EmailOrganizationBulkDialog (R5-08: search → freeze → execute/cancel)", () => {
  it("search runs against the selected account and renders row selection", async () => {
    vi.mocked(searchEmailsOrganization).mockResolvedValue(searchFixture());
    const wrapper = mountDialog();
    await flushPromises();
    const searchButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Search"));
    await searchButton!.trigger("click");
    await flushPromises();
    expect(searchEmailsOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ emailServiceId: 7, source: "local" })
    );
    expect(wrapper.text()).toContain("invoice 1");
    expect(wrapper.findAll("input[type='checkbox']").length).toBe(3);
  });

  it("freezes the selected subset and previews count + destination + expiry before executing", async () => {
    vi.mocked(searchEmailsOrganization).mockResolvedValue(searchFixture());
    vi.mocked(prepareEmailSelection).mockResolvedValue(previewFixture());
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper.findAll("button").find((button) => button.text().includes("Search"))!.trigger("click");
    await flushPromises();
    // Select the first two rows.
    const checkboxes = wrapper.findAll("input[type='checkbox']");
    await checkboxes[0].setValue(true);
    await checkboxes[1].setValue(true);
    await wrapper.findAll("button").find((button) => button.text().includes("Freeze selection"))!.trigger("click");
    await flushPromises();
    expect(prepareEmailSelection).toHaveBeenCalledWith({
      emailServiceId: 7,
      kind: "trash",
      messageIds: [101, 102],
    });
    const previewText = wrapper.find("[data-testid='email-org-bulk-preview']").text();
    expect(previewText).toContain("Frozen selection");
    expect(previewText).toContain("2 messages will move to Trash");
    expect(previewText).toContain("Expires");
    // The execute button is present and bound to the frozen selection.
    expect(
      wrapper.findAll("button").some((button) => button.text().includes("Move to Trash"))
    ).toBe(true);
  });

  it("executes the frozen selection and shows the running operation id", async () => {
    vi.mocked(searchEmailsOrganization).mockResolvedValue(searchFixture());
    vi.mocked(prepareEmailSelection).mockResolvedValue(previewFixture());
    vi.mocked(startTrashSelection).mockResolvedValue({ operationId: "op-bulk-123456" });
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper.findAll("button").find((button) => button.text().includes("Search"))!.trigger("click");
    await flushPromises();
    const checkboxes = wrapper.findAll("input[type='checkbox']");
    await checkboxes[0].setValue(true);
    await checkboxes[1].setValue(true);
    await wrapper.findAll("button").find((button) => button.text().includes("Freeze selection"))!.trigger("click");
    await flushPromises();
    await wrapper.findAll("button").find((button) => button.text().includes("Move to Trash"))!.trigger("click");
    await flushPromises();
    expect(startTrashSelection).toHaveBeenCalledWith("sel-12345678");
    // The running operation is surfaced through the card (progress UI).
    expect(wrapper.find("[data-testid='operation-card-stub']").text()).toContain("op-bulk-123456");
    // The parent learns the operation id.
    expect(wrapper.emitted("executed")).toEqual([["op-bulk-123456"]]);
  });

  it("cancel requests a durable cancel of the running bulk operation", async () => {
    vi.mocked(searchEmailsOrganization).mockResolvedValue(searchFixture());
    vi.mocked(prepareEmailSelection).mockResolvedValue(previewFixture());
    vi.mocked(startTrashSelection).mockResolvedValue({ operationId: "op-bulk-123456" });
    vi.mocked(cancelEmailOrganizationOperation).mockResolvedValue({ cancelled: true, operation: null });
    vi.mocked(getEmailOrganizationOperation).mockResolvedValue({
      operation: {
        operationId: "op-bulk-123456",
        kind: "trash",
        status: "running",
        emailServiceId: 7,
        itemCounts: { completed: 1, failed: 0, unresolved: 0, pending: 1, cancelled: 0 },
        items: [],
        createdAt: new Date().toISOString(),
        completedAt: null,
        cancelRequestedAt: null,
        errorCode: null,
        retryable: false,
      } satisfies EmailOrganizationOperationDto,
    });
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper.findAll("button").find((button) => button.text().includes("Search"))!.trigger("click");
    await flushPromises();
    await wrapper.findAll("input[type='checkbox']")[0].setValue(true);
    await wrapper.findAll("button").find((button) => button.text().includes("Freeze selection"))!.trigger("click");
    await flushPromises();
    await wrapper.findAll("button").find((button) => button.text().includes("Move to Trash"))!.trigger("click");
    await flushPromises();
    const cancelButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Cancel"));
    expect(cancelButton).toBeDefined();
    await cancelButton!.trigger("click");
    await flushPromises();
    expect(cancelEmailOrganizationOperation).toHaveBeenCalledWith("op-bulk-123456");
  });

  it("an account without a writable Trash cannot open the journey at all", async () => {
    vi.mocked(getEmailOrganizationCapabilities).mockResolvedValue({
      emailServiceId: 7,
      protocol: "imap",
      canFetchFullSource: true,
      canSendForward: true,
      canMoveToTrash: false,
      canRestore: false,
      trashFolderPath: null,
      reasonCodes: ["TRASH_NOT_CONFIGURED"],
      resolvedAt: new Date().toISOString(),
    });
    const wrapper = mountDialog();
    await flushPromises();
    expect(wrapper.find("[data-testid='email-org-bulk-no-capability']").exists()).toBe(true);
    const searchButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Search"));
    expect(searchButton?.attributes("disabled")).toBeDefined();
  });

  it("incomplete search results are disclosed before freezing (never a silent subset)", async () => {
    vi.mocked(searchEmailsOrganization).mockResolvedValue({
      ...searchFixture(),
      complete: false,
      limitation: "bounded scan",
    });
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper.findAll("button").find((button) => button.text().includes("Search"))!.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Results are incomplete");
  });
});
