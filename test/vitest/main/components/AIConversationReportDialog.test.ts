import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent } from "vue";
import AIConversationReportDialog from "@/views/components/aiContentReport/AIConversationReportDialog.vue";
import type { ConversationReportSnapshot } from "@/views/components/aiContentReport/conversationReportSnapshot";
import type { AIContentReportCategory } from "@/entityTypes/aiContentReportTypes";

// Mock the frontend API + request builder so the dialog is tested in isolation.
const createMock = vi.fn();
vi.mock("@/views/api/aiContentReport", () => ({
  createAIContentReport: (...args: unknown[]) => createMock(...args),
}));
const buildMock = vi.fn();
vi.mock("@/views/components/aiContentReport/conversationReportRequest", () => ({
  buildCreateAIConversationReportRequest: (...args: unknown[]) =>
    buildMock(...args),
  AIConversationReportLocalError: class extends Error {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(public code: any, message: string) {
      super(message);
      this.name = "AIConversationReportLocalError";
    }
  },
}));
const wouldTruncateMock = vi.fn();
vi.mock("@/views/components/aiContentReport/conversationReportText", () => ({
  wouldTruncateConversationTexts: (...args: unknown[]) =>
    wouldTruncateMock(...args),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiConversationReport: {
        dialogTitle: "Report conversation",
        continueAndSubmit: "Submit",
        cancel: "Cancel",
        includeRelatedUserContext: "Include my related message",
        userMessageWillBeSent: "Your message will be sent",
        consentDefault: "Only AI outputs",
        consentWithUserContext: "With my related message",
        truncationWarning: "Trimmed",
        conversationChanged: "Conversation changed",
        errors: {
          selectionRequired: "Select one",
          selectionLimit: "Too many",
          imageLimit: "Too many images",
          relatedMessageUnavailable: "No related message",
          unsupportedSchema: "Unsupported",
        },
      },
    },
  },
});

// Vuetify is not registered in the component-test config; stub the components
// the dialog renders. VDialog renders its slot only when open. The item rows
// and the related-user opt-in come from the real child list / native checkbox.
const VDialog = defineComponent({
  props: { modelValue: { type: Boolean, default: true } },
  template: `<div v-if="modelValue"><slot /></div>`,
});
const PassThrough = { template: `<div><slot /></div>` };
const VBtn = defineComponent({
  props: { disabled: { type: Boolean, default: false } },
  template: `<button :disabled="disabled"><slot /></button>`,
});
const VIcon = { template: `<i />` };
const VSelect = defineComponent({
  props: { modelValue: { type: String, default: "" } },
  emits: ["update:modelValue"],
  template: `<div />`,
});
const VTextarea = defineComponent({
  props: { modelValue: { type: String, default: "" } },
  emits: ["update:modelValue"],
  template: `<div />`,
});

function makeSnapshot(): ConversationReportSnapshot {
  return {
    snapshotId: "snap-1",
    conversationId: "conv-1",
    surface: "chat_v2",
    createdAt: "2026-01-01T00:00:00.000Z",
    candidates: [
      {
        itemId: "ai-a1",
        messageId: "a1",
        sourceIndex: 1,
        role: "assistant",
        contentType: "text",
        text: "AI answer",
        images: [],
        evidenceUnavailable: false,
        relatedUser: {
          itemId: "user-u1",
          messageId: "u1",
          sourceIndex: 0,
          role: "user",
          contentType: "text",
          text: "user q",
          omittedAttachmentContent: false,
        },
      },
    ],
  };
}

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(AIConversationReportDialog, {
    props: { modelValue: true, snapshot: makeSnapshot(), ...props },
    global: {
      plugins: [i18n],
      stubs: {
        VDialog,
        VCard: PassThrough,
        VCardTitle: PassThrough,
        VCardText: PassThrough,
        VCardActions: PassThrough,
        VSpacer: { template: `<span />` },
        VBtn,
        VIcon,
        VSelect,
        VTextarea,
      },
    },
  });
}

/** Reach into setup state to set the category (the VSelect stub is a no-op). */
function setCategory(
  w: ReturnType<typeof mountDialog>,
  value: AIContentReportCategory
): void {
  (w.vm as unknown as { category: AIContentReportCategory }).category = value;
}

function buildRequest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    clientReportId: "c",
    surface: "chat_v2",
    reportScope: "selected_ai_outputs",
    category: "other",
    items: [],
    context: {
      conversationId: "c",
      selectedAIItemCount: 1,
      includedUserItemCount: 0,
      appVersion: "1",
      platform: "win32",
      locale: "en",
    },
    ...overrides,
  };
}

describe("AIConversationReportDialog", () => {
  beforeEach(() => {
    createMock.mockReset();
    buildMock.mockReset();
    wouldTruncateMock.mockReset();
    // Default: no truncation (most tests use short text).
    wouldTruncateMock.mockReturnValue(false);
  });

  it("renders the item list and the related-user opt-in toggle", () => {
    const w = mountDialog();
    expect(w.find('[data-testid="report-item-ai-a1"]').exists()).toBe(true);
    expect(
      w.find('[data-testid="include-related-user-context"]').exists()
    ).toBe(true);
  });

  it("requires a selection before submit (local validation)", async () => {
    const w = mountDialog();
    await w.find('[data-testid="conversation-report-submit"]').trigger("click");
    await flushPromises();
    expect(buildMock).not.toHaveBeenCalled();
    expect(w.text()).toContain("Select one");
  });

  it("submits after selecting an item", async () => {
    buildMock.mockResolvedValueOnce(buildRequest());
    createMock.mockResolvedValueOnce({
      reportId: "r1",
      status: "submitted",
      receivedAt: "t",
      duplicate: false,
    });
    const w = mountDialog();
    setCategory(w, "other");
    await w.find('[data-testid="report-item-ai-a1"] input').trigger("change");
    await w.find('[data-testid="conversation-report-submit"]').trigger("click");
    await flushPromises();
    expect(buildMock).toHaveBeenCalled();
    expect(createMock).toHaveBeenCalled();
    expect(w.emitted("submitted")).toBeTruthy();
  });

  it("switches reportScope when the related-user toggle is enabled", async () => {
    buildMock.mockResolvedValueOnce(
      buildRequest({
        reportScope: "selected_ai_outputs_with_related_user_context",
      })
    );
    createMock.mockResolvedValueOnce({
      reportId: "r2",
      status: "submitted",
      receivedAt: "t",
      duplicate: false,
    });
    const w = mountDialog();
    setCategory(w, "other");
    await w.find('[data-testid="report-item-ai-a1"] input').trigger("change");
    await w
      .find('[data-testid="include-related-user-context"] input')
      .trigger("change");
    await w.find('[data-testid="conversation-report-submit"]').trigger("click");
    await flushPromises();
    expect(buildMock).toHaveBeenCalled();
    const arg = buildMock.mock.calls[0][0];
    expect(arg.includeRelatedUserContext).toBe(true);
  });

  it("closes on cancel without submitting", async () => {
    const w = mountDialog();
    await w.find('[data-testid="conversation-report-cancel"]').trigger("click");
    expect(w.emitted("update:modelValue")).toBeTruthy();
    expect(w.emitted("update:modelValue")![0]).toEqual([false]);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("shows the default consent copy when the context toggle is off", () => {
    const w = mountDialog();
    // The .report-notice span carries the consent transmission notice.
    expect(w.find(".report-notice").text()).toContain("Only AI outputs");
  });

  it("swaps consent copy to the with-user-context line when the toggle is on", async () => {
    const w = mountDialog();
    expect(w.find(".report-notice").text()).toContain("Only AI outputs");
    await w
      .find('[data-testid="include-related-user-context"] input')
      .trigger("change");
    expect(w.find(".report-notice").text()).toContain(
      "With my related message"
    );
    // Toggling back restores the default copy (FR-3.5).
    await w
      .find('[data-testid="include-related-user-context"] input')
      .trigger("change");
    expect(w.find(".report-notice").text()).toContain("Only AI outputs");
  });

  describe("truncation warning gate (FR-4.4, §10.4)", () => {
    it("submits in one step when no truncation would occur", async () => {
      buildMock.mockResolvedValueOnce(buildRequest());
      createMock.mockResolvedValueOnce({
        reportId: "r1",
        status: "submitted",
        receivedAt: "t",
        duplicate: false,
      });
      wouldTruncateMock.mockReturnValue(false);
      const w = mountDialog();
      setCategory(w, "other");
      await w.find('[data-testid="report-item-ai-a1"] input').trigger("change");
      await w
        .find('[data-testid="conversation-report-submit"]')
        .trigger("click");
      await flushPromises();
      // Submitted immediately — no warning step.
      expect(buildMock).toHaveBeenCalled();
      expect(createMock).toHaveBeenCalled();
    });

    it("shows truncation warning and requires a second click when truncation detected", async () => {
      buildMock.mockResolvedValueOnce(buildRequest());
      createMock.mockResolvedValueOnce({
        reportId: "r2",
        status: "submitted",
        receivedAt: "t",
        duplicate: false,
      });
      wouldTruncateMock.mockReturnValue(true);
      const w = mountDialog();
      setCategory(w, "other");
      await w.find('[data-testid="report-item-ai-a1"] input').trigger("change");
      // First click: shows the warning, does NOT submit.
      await w
        .find('[data-testid="conversation-report-submit"]')
        .trigger("click");
      await flushPromises();
      expect(buildMock).not.toHaveBeenCalled();
      expect(w.find('[data-testid="truncation-warning"]').exists()).toBe(true);
      expect(w.find('[data-testid="truncation-warning"]').text()).toContain(
        "Trimmed"
      );
      // Second click: confirms and submits.
      await w
        .find('[data-testid="conversation-report-submit"]')
        .trigger("click");
      await flushPromises();
      expect(buildMock).toHaveBeenCalled();
      expect(createMock).toHaveBeenCalled();
    });

    it("resets the warning gate when the user changes selection", async () => {
      wouldTruncateMock.mockReturnValue(true);
      const w = mountDialog();
      setCategory(w, "other");
      await w.find('[data-testid="report-item-ai-a1"] input').trigger("change");
      // First click shows warning.
      await w
        .find('[data-testid="conversation-report-submit"]')
        .trigger("click");
      await flushPromises();
      expect(w.find('[data-testid="truncation-warning"]').exists()).toBe(true);
      // Toggling the checkbox resets the gate.
      await w.find('[data-testid="report-item-ai-a1"] input').trigger("change");
      await flushPromises();
      expect(w.find('[data-testid="truncation-warning"]').exists()).toBe(false);
    });
  });
});
