import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Dialog from "@/views/components/emailOrganization/EmailForwardReviewDialog.vue";
import {
  createForwardDraft,
  updateForwardDraft,
  authorizeForwardRevision,
  sendApprovedForward,
  discardForwardDraft,
  type ForwardDraftPreviewDto,
} from "@/views/api/emailorganization";
import type { SendForwardResultDto } from "@/views/api/emailorganization";

vi.mock("@/views/api/emailorganization", () => ({
  createForwardDraft: vi.fn(),
  updateForwardDraft: vi.fn(),
  authorizeForwardRevision: vi.fn(),
  sendApprovedForward: vi.fn(),
  discardForwardDraft: vi.fn(),
  getForwardDraftDetail: vi.fn(),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      emailOrganization: {
        forward_dialog_title: "Forward email",
        from_identity: "Send as",
        source_account: "source account",
        to_recipients: "To",
        cc_recipients: "Cc (optional)",
        bcc_recipients: "Bcc (optional, private)",
        findings_header: "Content findings:",
        preview_truncated: "(truncated preview)",
        subject_label: "Subject",
        note_label: "Add a note (optional)",
        attachments_header: "Attachments",
        preview_header: "Preview",
        cancel_button: "Cancel",
        save_draft_button: "Save draft",
        send_button: "Send forward",
        draft_expired: "The draft content expired. Cancel and reopen to refresh it.",
      },
    },
  },
  missingWarn: false,
});

function previewFixture(overrides?: Partial<ForwardDraftPreviewDto>): ForwardDraftPreviewDto {
  return {
    draftId: 11,
    revisionId: 21,
    revisionNumber: 1,
    messageId: 33,
    sourceEmailServiceId: 1,
    sendingAccountId: 1,
    fromName: "Ops",
    fromAddress: "ops@example.test",
    to: [],
    cc: [],
    bcc: [],
    subject: "Fwd: Invoice",
    note: null,
    attachmentManifest: [
      {
        partId: "part-1",
        displayName: "invoice.pdf",
        contentType: "application/pdf",
        decodedSize: 2048,
        contentHash: "a".repeat(64),
        disposition: "attachment",
        contentId: null,
        selected: true,
      },
    ],
    selectedAttachmentCount: 1,
    selectedAttachmentBytes: 2048,
    bodyPreviewText: "---------- Forwarded message ----------\nFrom: Sender <s@e.test>",
    validationFindings: [],
    composedHash: "b".repeat(64),
    composedMessageId: "<fwd@local>",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    expired: false,
    ...overrides,
  };
}

function mountDialog(messageId: number | null = 33) {
  return mount(Dialog, {
    props: { messageId, emailServiceId: 1 },
    global: {
      plugins: [i18n],
      stubs: {
        VDialog: { template: "<div><slot /></div>", props: ["modelValue"] },
        VCard: { template: "<div><slot /></div>" },
        VCardTitle: { template: "<div><slot /></div>" },
        VCardText: { template: "<div><slot /></div>" },
        VCardActions: { template: "<div><slot /></div>" },
        VBtn: {
          props: ["loading", "disabled", "color"],
          emits: ["click"],
          template: `<button :disabled="disabled || loading" @click="$emit('click')"><slot /></button>`,
        },
        VTextField: {
          inheritAttrs: false,
          props: ["modelValue", "label", "disabled"],
          emits: ["update:modelValue"],
          template: `<input :value="modelValue" :disabled="disabled" @input="$emit('update:modelValue', $event.target.value)">`,
        },
        VTextarea: {
          inheritAttrs: false,
          props: ["modelValue", "label", "disabled"],
          emits: ["update:modelValue"],
          template: `<textarea :value="modelValue" :disabled="disabled" @input="$emit('update:modelValue', $event.target.value)"></textarea>`,
        },
        VCheckbox: {
          inheritAttrs: false,
          props: ["modelValue", "value", "label", "disabled"],
          emits: ["update:modelValue"],
          template: `<label><input type="checkbox" :checked="(modelValue || []).includes(value)" :disabled="disabled" @change="$emit('update:modelValue', (modelValue || []).includes(value) ? modelValue.filter(v => v !== value) : [...(modelValue || []), value])">{{ label }}</label>`,
        },
        VAlert: { template: "<div role='alert'><slot /></div>", props: ["type"] },
        VProgressLinear: { template: "<div></div>", props: ["indeterminate"] },
        VIcon: { template: "<i></i>", props: ["icon"] },
      },
    },
  });
}

const mockCreate = vi.mocked(createForwardDraft);
const mockUpdate = vi.mocked(updateForwardDraft);
const mockAuthorize = vi.mocked(authorizeForwardRevision);
const mockSend = vi.mocked(sendApprovedForward);
const mockDiscard = vi.mocked(discardForwardDraft);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EmailForwardReviewDialog", () => {
  it("creates and renders a reviewable draft on open", async () => {
    mockCreate.mockResolvedValue(previewFixture());
    const wrapper = mountDialog();
    await flushPromises();

    expect(mockCreate).toHaveBeenCalledWith({ messageId: 33, attachments: { mode: "all" } });
    const text = wrapper.text();
    // Subject is an editable input value; the manifest and preview are text.
    const inputs = wrapper.findAll("input");
    const subjectInput = inputs[3]; // To, Cc, Bcc, Subject
    expect((subjectInput.element as HTMLInputElement).value).toBe("Fwd: Invoice");
    expect(text).toContain("invoice.pdf");
    expect(text).toContain("Forwarded message");
  });

  it("shows a validation error when draft creation fails", async () => {
    mockCreate.mockRejectedValue(new Error("Message location is not verified"));
    const wrapper = mountDialog();
    await flushPromises();
    const alert = wrapper.find("[role='alert']");
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("not verified");
  });

  it("authorizes the displayed revision and submits once on send", async () => {
    const created = previewFixture();
    mockCreate.mockResolvedValue(created);
    mockUpdate.mockResolvedValue({ ...created, to: ["finance@example.test"] });
    mockAuthorize.mockResolvedValue({ authorizationId: 77, expiresInSeconds: 900 });
    mockSend.mockResolvedValue({
      status: "submitted",
      operationId: "op-1",
      accepted: ["finance@example.test"],
      rejected: [],
      unknown: [],
    } as SendForwardResultDto);

    const wrapper = mountDialog();
    await flushPromises();

    const toInput = wrapper.find("input");
    await toInput.setValue("finance@example.test");
    const buttons = wrapper.findAll("button");
    const sendButton = buttons.find((button) => button.text().includes("Send forward"));
    expect(sendButton).toBeDefined();
    await sendButton!.trigger("click");
    await flushPromises();

    expect(mockAuthorize).toHaveBeenCalledWith({ draftId: 11, revisionId: 21 });
    expect(mockSend).toHaveBeenCalledWith({
      draftId: 11,
      revisionId: 21,
      authorizationId: 77,
    });
    const sentEvents = wrapper.emitted("sent");
    expect(sentEvents).toHaveLength(1);
  });

  it("disables send until a recipient is entered", async () => {
    mockCreate.mockResolvedValue(previewFixture());
    const wrapper = mountDialog();
    await flushPromises();
    const buttons = wrapper.findAll("button");
    const sendButton = buttons.find((button) => button.text().includes("Send forward"));
    expect(sendButton?.attributes("disabled")).toBeDefined();
  });

  it("discards the draft when cancelled", async () => {
    mockCreate.mockResolvedValue(previewFixture());
    mockDiscard.mockResolvedValue({ discarded: true });
    const wrapper = mountDialog();
    await flushPromises();
    const buttons = wrapper.findAll("button");
    const cancelButton = buttons.find((button) => button.text().trim() === "Cancel");
    await cancelButton!.trigger("click");
    await flushPromises();
    expect(mockDiscard).toHaveBeenCalledWith(11);
    expect(wrapper.emitted("closed")).toHaveLength(1);
  });

  it("keeps send disabled when the revision expired", async () => {
    mockCreate.mockResolvedValue(previewFixture({ expired: true }));
    const wrapper = mountDialog();
    await flushPromises();
    const buttons = wrapper.findAll("button");
    const sendButton = buttons.find((button) => button.text().includes("Send forward"));
    expect(sendButton?.attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("expired");
  });
});
