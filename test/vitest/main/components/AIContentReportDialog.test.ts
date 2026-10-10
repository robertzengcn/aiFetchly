import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent } from "vue";
import AIContentReportDialog from "@/views/components/aiContentReport/AIContentReportDialog.vue";
import type { ReportableOutputDescriptor } from "@/views/components/aiContentReport/reportableOutput";
import type { AIContentReportCategory } from "@/entityTypes/aiContentReportTypes";

/**
 * Reproduces the bug where `clientReportId` reaches the IPC schema as "" (empty
 * string), failing `z.string().min(1)` with "String must contain at least 1
 * character(s)".
 *
 * Root cause: the dialog generates `clientReportId` inside a NON-immediate
 * `watch(() => props.modelValue)`. That watcher does not fire when the dialog
 * is mounted already-open — which is exactly the mount-on-demand pattern the
 * main chat surface uses:
 *
 *   <AIContentReportDialog
 *     v-if="singleReportDialogOpen && activeSingleDescriptor"   // AiChatV2.vue:679
 *     v-model="singleReportDialogOpen"
 *     :descriptor="activeSingleDescriptor"
 *   />
 *
 * `singleReportDialogOpen` flips false→true, Vue CREATES the component with
 * `modelValue === true`, the watcher sees no transition (true is the initial
 * value, not a change), so `generateClientReportId()` is never called and the
 * ref stays "".
 */
const createMock = vi.fn();
vi.mock("@/views/api/aiContentReport", () => ({
  createAIContentReport: (...args: unknown[]) => createMock(...args),
}));
// The image encoder touches the DOM Canvas API; stub it to null so no preview
// is attached and the dialog submits text-only evidence.
vi.mock(
  "@/views/components/aiContentReport/AIContentReportImageEncoder",
  () => ({
    encodeReportImagePreview: vi.fn().mockResolvedValue(null),
  })
);

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiContentReport: {
        dialogTitle: "Report AI output",
        outputPreview: "AI output",
        imagesLabel: "Images",
        imageAlt: "Generated image {n}",
        categoryLabel: "What is wrong?",
        commentLabel: "Details",
        consent: "consent text",
        submit: "Submit",
        cancel: "Cancel",
        tryAgain: "Try again",
        copyReference: "Copy reference",
        success: "Report submitted. Reference: {reportId}",
        imageUnavailable: "image unavailable",
        categories: {
          other: "Other",
        },
        errors: {
          categoryRequired: "Choose a category",
          imageRequired: "Select an image",
          noEvidence: "Add a description",
        },
      },
    },
  },
});

// Vuetify is not registered in the component-test config; stub the components
// the dialog renders. VDialog renders its slot only when open.
const VDialog = defineComponent({
  props: { modelValue: { type: Boolean, default: true } },
  template: `<div v-if="modelValue"><slot /></div>`,
});
const PassThrough = { template: `<div><slot /></div>` };
const VBtn = defineComponent({
  props: {
    disabled: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
  },
  template: `<button :disabled="disabled"><slot /></button>`,
});
const VIcon = { template: `<i />` };
const VSelect = defineComponent({
  props: {
    modelValue: { type: String, default: "" },
    errorMessages: { type: Array, default: () => [] },
  },
  emits: ["update:modelValue"],
  template: `<div />`,
});
const VTextarea = defineComponent({
  props: { modelValue: { type: String, default: "" } },
  emits: ["update:modelValue"],
  template: `<div />`,
});

function makeDescriptor(
  overrides: Partial<ReportableOutputDescriptor> = {}
): ReportableOutputDescriptor {
  return {
    surface: "chat_v2",
    contentType: "text",
    text: "Some AI-generated output",
    context: {
      conversationId: "conv-1",
      messageId: "msg-1",
      model: "claude-sonnet-5",
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(AIContentReportDialog, {
    props: { modelValue: true, descriptor: makeDescriptor(), ...props },
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

describe("AIContentReportDialog — clientReportId", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("submits a non-empty clientReportId when mounted already-open (v-if mount-on-demand)", async () => {
    // Simulate the AiChatV2.vue:678 pattern: the component is CREATED with
    // modelValue:true (no false→true transition), so the non-immediate open
    // watcher never fires. The dialog must still emit a valid clientReportId.
    createMock.mockResolvedValueOnce({
      reportId: "air_test1",
      status: "submitted",
      receivedAt: "t",
      duplicate: false,
    });
    const w = mountDialog();
    setCategory(w, "other");
    await w.find('[data-testid="ai-content-report-submit"]').trigger("click");
    await flushPromises();
    expect(createMock).toHaveBeenCalledTimes(1);
    const request = createMock.mock.calls[0][0];
    expect(typeof request.clientReportId).toBe("string");
    expect(request.clientReportId.length).toBeGreaterThan(0);
  });

  it("reuses the same clientReportId across a retry when mounted already-open", async () => {
    // PRD §13.2 / FR-4.8: retry must reuse the SAME id so the backend can
    // deduplicate. The dialog generates once per open.
    createMock
      .mockResolvedValueOnce({
        reportId: "air_fail_retry",
        status: "submitted",
        receivedAt: "t",
        duplicate: false,
      })
      .mockResolvedValueOnce({
        reportId: "air_ok",
        status: "submitted",
        receivedAt: "t",
        duplicate: false,
      });
    const w = mountDialog();
    setCategory(w, "other");
    await w.find('[data-testid="ai-content-report-submit"]').trigger("click");
    await flushPromises();
    // Second submit (retry): simulate the "Try again" button click.
    await w.find('[data-testid="ai-content-report-submit"]').trigger("click");
    await flushPromises();
    expect(createMock).toHaveBeenCalledTimes(2);
    const id1 = createMock.mock.calls[0][0].clientReportId;
    const id2 = createMock.mock.calls[1][0].clientReportId;
    expect(id1.length).toBeGreaterThan(0);
    expect(id1).toBe(id2);
  });
});
