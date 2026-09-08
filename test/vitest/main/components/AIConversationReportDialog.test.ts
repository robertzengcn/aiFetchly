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
// §19.1 / TODO-13: spy on the renderer analytics emitter so tests can assert
// the dialog fires allowlisted open/scope events — and ONLY allowlisted ones.
const analyticsMock = vi.fn();
vi.mock(
  "@/views/components/aiContentReport/conversationReportAnalytics",
  () => ({
    bucketEligibleCount: (n: number) =>
      n <= 0
        ? "0"
        : n === 1
        ? "1"
        : n <= 3
        ? "2-3"
        : n <= 6
        ? "4-6"
        : n <= 10
        ? "7-10"
        : "10+",
    emitConversationReportAnalytics: (...args: unknown[]) =>
      analyticsMock(...args),
  })
);

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
        selectionInstruction: "Select",
        selectionCount: "{n} selected",
        selectionCountOfMax: "{n} of {max} selected",
        selectAll: "Select all",
        imageLabel: "Include image in report",
        relatedUserLabel: "Your message — will be sent",
        attachmentOmitted: "An attachment in your message was omitted",
        itemTypes: {
          text: "Text",
          image: "Image",
          mixed: "Mixed",
          plan: "Plan",
          artifact: "Artifact",
        },
        errors: {
          selectionRequired: "Select one",
          selectionLimit: "Too many",
          imageLimit: "Too many images",
          relatedMessageUnavailable: "No related message",
          unsupportedSchema: "Unsupported",
        },
      },
      aiContentReport: {
        success: "Report submitted. Reference: {reportId}",
        copyReference: "Copy reference",
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

function makeSnapshot(
  candidates?: Partial<ConversationReportSnapshot["candidates"][number]>[]
): ConversationReportSnapshot {
  const baseCandidates = [
    {
      itemId: "ai-a1",
      messageId: "a1",
      sourceIndex: 1,
      role: "assistant" as const,
      contentType: "text" as const,
      text: "AI answer",
      images: [],
      evidenceUnavailable: false,
      relatedUser: {
        itemId: "user-u1",
        messageId: "u1",
        sourceIndex: 0,
        role: "user" as const,
        contentType: "text" as const,
        text: "user q",
        omittedAttachmentContent: false,
      },
    },
  ];
  const list = candidates
    ? candidates.map((c, i) => ({
        itemId: `ai-${c.messageId ?? "m" + i}`,
        messageId: c.messageId ?? "m" + i,
        sourceIndex: i,
        role: "assistant" as const,
        contentType: c.contentType ?? "text",
        text: c.text,
        images: c.images ?? [],
        evidenceUnavailable: false,
      }))
    : baseCandidates;
  return {
    snapshotId: "snap-1",
    conversationId: "conv-1",
    surface: "chat_v2",
    createdAt: "2026-01-01T00:00:00.000Z",
    candidates: list,
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
    analyticsMock.mockReset();
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

  it("passes a non-empty clientReportId when mounted already-open (v-if mount-on-demand)", async () => {
    // Regression: the open-watcher is non-immediate, so mounting with
    // modelValue:true (the v-if pattern in AiChatV2.vue:686 / AiChatBox.vue:820)
    // never generates the id. Submit must still send a non-empty clientReportId
    // or the IPC schema's `z.string().min(1)` rejects with "String must contain
    // at least 1 character(s)".
    buildMock.mockResolvedValueOnce(buildRequest());
    createMock.mockResolvedValueOnce({
      reportId: "air_v2_id",
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
    const arg = buildMock.mock.calls[0][0];
    expect(typeof arg.clientReportId).toBe("string");
    expect(arg.clientReportId.length).toBeGreaterThan(0);
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

  describe("select-all control (PRD §10.2)", () => {
    it("shows select-all when eligible list has 10 or fewer items", () => {
      const w = mountDialog();
      // Default snapshot has 1 candidate, so select-all should appear.
      expect(
        w.find('[data-testid="conversation-report-select-all"]').exists()
      ).toBe(true);
    });

    it("hides select-all when eligible list has more than 10 items", () => {
      const manyCandidates = Array.from({ length: 11 }, (_, i) => ({
        messageId: `m${i}`,
        text: `item ${i}`,
        contentType: "text" as const,
      }));
      const w = mountDialog({
        snapshot: makeSnapshot(manyCandidates),
      });
      expect(
        w.find('[data-testid="conversation-report-select-all"]').exists()
      ).toBe(false);
    });

    it("toggles between all-selected and none-selected", async () => {
      const w = mountDialog({
        snapshot: makeSnapshot([
          { messageId: "a1", text: "one" },
          { messageId: "a2", text: "two" },
        ]),
      });
      // Click select-all → selects all.
      await w
        .find('[data-testid="conversation-report-select-all"] input')
        .trigger("change");
      expect(
        (
          w.find('[data-testid="report-item-ai-a1"] input')
            .element as HTMLInputElement
        ).checked
      ).toBe(true);
      expect(
        (
          w.find('[data-testid="report-item-ai-a2"] input')
            .element as HTMLInputElement
        ).checked
      ).toBe(true);
      // Click select-all again → deselects all.
      await w
        .find('[data-testid="conversation-report-select-all"] input')
        .trigger("change");
      expect(
        (
          w.find('[data-testid="report-item-ai-a1"] input')
            .element as HTMLInputElement
        ).checked
      ).toBe(false);
      expect(
        (
          w.find('[data-testid="report-item-ai-a2"] input')
            .element as HTMLInputElement
        ).checked
      ).toBe(false);
    });
  });

  describe("report reference + copy (FR-5.5, Journey 11.1 step 8)", () => {
    it("shows the report reference and a Copy-reference button after submit, and stays open", async () => {
      buildMock.mockResolvedValueOnce(buildRequest());
      createMock.mockResolvedValueOnce({
        reportId: "air_abc123",
        status: "submitted",
        receivedAt: "t",
        duplicate: false,
      });
      const w = mountDialog();
      setCategory(w, "other");
      await w.find('[data-testid="report-item-ai-a1"] input').trigger("change");
      await w
        .find('[data-testid="conversation-report-submit"]')
        .trigger("click");
      await flushPromises();
      // Reference is visible in the success region.
      expect(w.text()).toContain("air_abc123");
      // Copy-reference control is present.
      const copyBtn = w.find(
        '[data-testid="conversation-report-copy-reference"]'
      );
      expect(copyBtn.exists()).toBe(true);
      // Dialog stays open — parent must NOT see a close request on success.
      expect(w.emitted("update:modelValue")).toBeFalsy();
      // But the submitted payload did fire.
      expect(w.emitted("submitted")).toBeTruthy();
    });

    it("copies the report reference to the clipboard when clicked", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      buildMock.mockResolvedValueOnce(buildRequest());
      createMock.mockResolvedValueOnce({
        reportId: "air_xyz789",
        status: "submitted",
        receivedAt: "t",
        duplicate: false,
      });
      const w = mountDialog();
      setCategory(w, "other");
      await w.find('[data-testid="report-item-ai-a1"] input').trigger("change");
      await w
        .find('[data-testid="conversation-report-submit"]')
        .trigger("click");
      await flushPromises();
      await w
        .find('[data-testid="conversation-report-copy-reference"]')
        .trigger("click");
      expect(writeText).toHaveBeenCalledWith("air_xyz789");
    });

    it("does not show the copy button before a successful submission", () => {
      const w = mountDialog();
      expect(
        w.find('[data-testid="conversation-report-copy-reference"]').exists()
      ).toBe(false);
    });
  });

  // §19.1 / TODO-13: the dialog fires allowlisted renderer analytics events.
  // Open fires ai_conversation_report_opened; toggling the related-user opt-in
  // fires ai_conversation_report_scope_changed. Each payload must contain ONLY
  // surface, eligible-count bucket, and user-context boolean — no content,
  // ids, or report output. This is the no-leak property (design §19.1).
  describe("renderer analytics (§19.1, TODO-13)", () => {
    // The open watcher fires on the closed→open transition (not initial
    // mount with modelValue:true, since Vue watchers are not immediate). So
    // we mount closed, then drive the open transition via setProps.
    function mountClosed() {
      return mountDialog({ modelValue: false });
    }
    async function openDialog(
      w: ReturnType<typeof mountDialog>
    ): Promise<void> {
      await w.setProps({ modelValue: true });
      await flushPromises();
    }

    it("fires ai_conversation_report_opened when the dialog opens with allowlisted properties", async () => {
      const w = mountClosed();
      await openDialog(w);
      expect(analyticsMock).toHaveBeenCalledTimes(1);
      const [eventName, payload] = analyticsMock.mock.calls[0];
      expect(eventName).toBe("ai_conversation_report_opened");
      // Only the three allowlisted keys are present.
      expect(Object.keys(payload).sort()).toEqual(
        ["eligibleCountBucket", "surface", "userContextEnabled"].sort()
      );
      expect(payload.surface).toBe("chat_v2");
      // One candidate → "1" bucket.
      expect(payload.eligibleCountBucket).toBe("1");
      // Fresh opt-in is off on open.
      expect(payload.userContextEnabled).toBe(false);
    });

    it("fires ai_conversation_report_scope_changed when the related-user opt-in toggles", async () => {
      const w = mountClosed();
      await openDialog(w);
      // One open event so far.
      expect(analyticsMock).toHaveBeenCalledTimes(1);
      await w
        .find('[data-testid="include-related-user-context"] input')
        .trigger("change");
      expect(analyticsMock).toHaveBeenCalledTimes(2);
      const [eventName, payload] = analyticsMock.mock.calls[1];
      expect(eventName).toBe("ai_conversation_report_scope_changed");
      expect(Object.keys(payload).sort()).toEqual(
        ["eligibleCountBucket", "surface", "userContextEnabled"].sort()
      );
      // The scope event reflects the NEW opt-in state (now on).
      expect(payload.userContextEnabled).toBe(true);
    });

    it("never leaks report text, message ids, or conversation id into any payload", async () => {
      const w = mountClosed();
      await openDialog(w);
      // Toggle scope once to exercise both event types.
      await w
        .find('[data-testid="include-related-user-context"] input')
        .trigger("change");
      for (const call of analyticsMock.mock.calls) {
        const payload = call[1] as Record<string, unknown>;
        const serialized = JSON.stringify(payload);
        // Content and identifiers that must never appear in analytics.
        expect(serialized).not.toContain("AI answer"); // report text
        expect(serialized).not.toContain("user q"); // related-user text
        expect(serialized).not.toContain("a1"); // message id
        expect(serialized).not.toContain("u1"); // related-user message id
        expect(serialized).not.toContain("conv-1"); // conversation id
        expect(serialized).not.toContain("snap-1"); // snapshot id
      }
    });
  });
});
