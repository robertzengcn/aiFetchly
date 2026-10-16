import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import ReplyDraftReviewCard from "@/views/pages/emailreply/widgets/ReplyDraftReviewCard.vue";
import {
  getEmailReplyDraft,
  resolveEmailReplyHumanReview,
} from "@/views/api/emailreply";
import type { ReplyDraftDetail } from "@/views/api/emailreply";

// T02 (G02): the revision-bound review/acknowledgment flow — original
// reasons, current resolution, stale/error/loading states, user-only action.

vi.mock("@/views/api/emailreply", () => ({
  getEmailReplyDraft: vi.fn(),
  resolveEmailReplyHumanReview: vi.fn(),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: {
      emailReply: {
        drafts_title: "Reply Drafts",
        human_review_required: "This draft needs human review before sending.",
        human_review_resolve: "Mark reviewed",
        human_review_resolve_note_placeholder: "What did you check? (optional)",
        human_review_resolved: "Human review resolved for this revision.",
        human_review_stale: "This review was for an older revision — please review again.",
        human_review_resolve_failed: "Could not record your review. Please try again.",
        human_review_reasons: "Why review was requested",
        human_review_questions: "Open questions",
        human_review_note_label: "Review note",
        human_review_no_flag: "No human review requested for this draft.",
        human_review_body: "Reply body",
        human_review_recipient: "To",
      },
    },
  },
});

function draftDetail(overrides: Partial<ReplyDraftDetail> = {}): ReplyDraftDetail {
  return {
    id: 11,
    messageId: 100,
    emailServiceId: 7,
    subject: "Re: Pricing?",
    bodyText: "Hello",
    bodyHtml: null,
    recipientAddress: "customer@example.com",
    status: "draft",
    generationSource: "ai",
    confidence: null,
    requiresHumanReview: true,
    reviewReasonsJson: JSON.stringify(["pricing needs a human check"]),
    unresolvedQuestionsJson: JSON.stringify(["confirm discount?"]),
    humanReviewResolvedAt: null,
    humanReviewResolvedRevisionId: null,
    currentRevisionId: 5,
    knowledgeSourcesJson: null,
    warningsJson: null,
    sentAt: null,
    sendError: null,
    createdAt: "2026-10-16T00:00:00.000Z",
    ...overrides,
  };
}

function mountCard(draftId = 11) {
  return mount(ReplyDraftReviewCard, {
    props: { draftId },
    global: {
      plugins: [i18n],
      stubs: {
        VCard: { template: "<div><slot /></div>" },
        VChip: { template: "<span><slot /></span>" },
        VBtn: {
          inheritAttrs: false,
          props: ["loading", "disabled"],
          emits: ["click"],
          template: `<button v-bind="$attrs" @click="$emit('click')"><slot /></button>`,
        },
        VTextarea: {
          props: ["modelValue", "label", "placeholder", "disabled"],
          emits: ["update:modelValue"],
          template: `<textarea :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
        },
        VProgressLinear: { template: "<div />" },
      },
    },
  });
}

describe("ReplyDraftReviewCard — revision-bound review flow (T02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the pending flag with reasons/questions and resolves on click", async () => {
    vi.mocked(getEmailReplyDraft).mockResolvedValue(draftDetail());
    vi.mocked(resolveEmailReplyHumanReview).mockImplementation(async () => {
      vi.mocked(getEmailReplyDraft).mockResolvedValue(
        draftDetail({
          humanReviewResolvedAt: new Date().toISOString(),
          humanReviewResolvedRevisionId: 5,
        })
      );
      return { resolved: true };
    });
    const wrapper = mountCard();
    await flushPromises();
    expect(wrapper.text()).toContain("needs human review");
    expect(wrapper.text()).toContain("pricing needs a human check");
    expect(wrapper.text()).toContain("confirm discount?");
    const button = wrapper.find('[data-testid="draft-review-resolve-btn"]');
    expect(button.exists()).toBe(true);

    await wrapper.find("textarea").setValue("checked pricing");
    await button.trigger("click");
    await flushPromises();

    // Bound to the CURRENT revision with the operator note.
    expect(resolveEmailReplyHumanReview).toHaveBeenCalledWith({
      draftId: 11,
      revisionId: 5,
      note: "checked pricing",
    });
    // Reloaded detail shows the resolved state, no resolve control.
    expect(wrapper.text()).toContain("resolved for this revision");
    expect(wrapper.find('[data-testid="draft-review-resolve-btn"]').exists()).toBe(false);
  });

  it("shows the resolved state with no resolve control when already resolved", async () => {
    vi.mocked(getEmailReplyDraft).mockResolvedValue(
      draftDetail({
        humanReviewResolvedAt: new Date().toISOString(),
        humanReviewResolvedRevisionId: 5,
      })
    );
    const wrapper = mountCard();
    await flushPromises();
    expect(wrapper.text()).toContain("resolved for this revision");
    expect(wrapper.find('[data-testid="draft-review-resolve-btn"]').exists()).toBe(false);
    expect(resolveEmailReplyHumanReview).not.toHaveBeenCalled();
  });

  it("shows stale guidance with a working resolve control after an edit", async () => {
    vi.mocked(getEmailReplyDraft).mockResolvedValue(
      draftDetail({
        currentRevisionId: 6,
        humanReviewResolvedAt: new Date().toISOString(),
        humanReviewResolvedRevisionId: 5,
      })
    );
    vi.mocked(resolveEmailReplyHumanReview).mockResolvedValue({ resolved: true });
    const wrapper = mountCard();
    await flushPromises();
    expect(wrapper.text()).toContain("older revision");
    const button = wrapper.find('[data-testid="draft-review-resolve-btn"]');
    expect(button.exists()).toBe(true);
    await button.trigger("click");
    await flushPromises();
    // Re-review binds to the NEW current revision, not the stale one.
    expect(resolveEmailReplyHumanReview).toHaveBeenCalledWith({
      draftId: 11,
      revisionId: 6,
      note: undefined,
    });
  });

  it("shows an error state when resolution fails", async () => {
    vi.mocked(getEmailReplyDraft).mockResolvedValue(draftDetail());
    vi.mocked(resolveEmailReplyHumanReview).mockRejectedValue(
      new Error("db gone")
    );
    const wrapper = mountCard();
    await flushPromises();
    await wrapper.find('[data-testid="draft-review-resolve-btn"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Could not record your review");
  });

  it("shows a stale refusal without unlocking when the backend refuses", async () => {
    vi.mocked(getEmailReplyDraft).mockResolvedValue(draftDetail());
    vi.mocked(resolveEmailReplyHumanReview).mockResolvedValue({
      resolved: false,
      reason: "stale",
    });
    const wrapper = mountCard();
    await flushPromises();
    await wrapper.find('[data-testid="draft-review-resolve-btn"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Could not record your review");
    expect(wrapper.find('[data-testid="draft-review-resolve-btn"]').exists()).toBe(true);
  });

  it("shows the exact revision body and recipient envelope before acknowledgment (R07)", async () => {
    // R07: the operator must inspect the complete reply on the screen
    // that records the review. bodyText renders as text (markup-safe);
    // the recipient envelope rides along from the detail DTO.
    vi.mocked(getEmailReplyDraft).mockResolvedValue(
      draftDetail({
        bodyText: "Hello, confirming your Tuesday slot.",
        recipientAddress: "customer@example.com",
      })
    );
    const wrapper = mountCard();
    await flushPromises();
    const body = wrapper.find('[data-testid="draft-review-body"]');
    expect(body.exists()).toBe(true);
    expect(body.text()).toContain("Hello, confirming your Tuesday slot.");
    expect(body.html()).not.toContain("<div>");
    const recipient = wrapper.find(
      '[data-testid="draft-review-recipient"]'
    );
    expect(recipient.exists()).toBe(true);
    expect(recipient.text()).toContain("customer@example.com");
  });

  it("omits the recipient line when the envelope is unknown (R07)", async () => {
    vi.mocked(getEmailReplyDraft).mockResolvedValue(
      draftDetail({ recipientAddress: null })
    );
    const wrapper = mountCard();
    await flushPromises();
    expect(
      wrapper.find('[data-testid="draft-review-recipient"]').exists()
    ).toBe(false);
    // The body still renders — no envelope never hides content.
    expect(wrapper.find('[data-testid="draft-review-body"]').exists()).toBe(
      true
    );
  });

  it("ignores a superseded load that resolves last (R08)", async () => {
    // Load A pending; navigate to B (load B starts); B resolves, then
    // stale A resolves last. A must never overwrite B on screen.
    let resolveA!: (v: ReplyDraftDetail) => void;
    let resolveB!: (v: ReplyDraftDetail) => void;
    const gateA = new Promise<ReplyDraftDetail>((r) => (resolveA = r));
    const gateB = new Promise<ReplyDraftDetail>((r) => (resolveB = r));
    vi.mocked(getEmailReplyDraft)
      .mockReturnValueOnce(gateA)
      .mockReturnValueOnce(gateB);
    const wrapper = mountCard(11);
    await wrapper.setProps({ draftId: 12 });
    expect(vi.mocked(getEmailReplyDraft).mock.calls).toEqual([[11], [12]]);
    resolveB(draftDetail({ id: 12, bodyText: "Body B" }));
    await flushPromises();
    resolveA(draftDetail({ id: 11, bodyText: "Body A" }));
    await flushPromises();
    expect(
      wrapper.find('[data-testid="draft-review-body"]').text()
    ).toContain("Body B");
  });

  it("a stale failure never clears a newer successful result (R08)", async () => {
    let rejectA!: (e: unknown) => void;
    let resolveB!: (v: ReplyDraftDetail) => void;
    const gateA = new Promise<ReplyDraftDetail>((_, rej) => (rejectA = rej));
    const gateB = new Promise<ReplyDraftDetail>((r) => (resolveB = r));
    vi.mocked(getEmailReplyDraft)
      .mockReturnValueOnce(gateA)
      .mockReturnValueOnce(gateB);
    const wrapper = mountCard(11);
    await wrapper.setProps({ draftId: 12 });
    resolveB(draftDetail({ id: 12, bodyText: "Body B" }));
    await flushPromises();
    rejectA(new Error("stale load failed"));
    await flushPromises();
    // B's content survives; no loading spinner stuck on.
    expect(
      wrapper.find('[data-testid="draft-review-body"]').text()
    ).toContain("Body B");
    expect(
      wrapper.find('[data-testid="draft-review-loading"]').exists()
    ).toBe(false);
  });

  it("clears previous content on navigation while the next draft loads (R08)", async () => {
    vi.mocked(getEmailReplyDraft).mockResolvedValue(
      draftDetail({ id: 11, bodyText: "Body A" })
    );
    const wrapper = mountCard(11);
    await flushPromises();
    expect(
      wrapper.find('[data-testid="draft-review-body"]').text()
    ).toContain("Body A");
    // The next load hangs; A's settled content must vanish immediately.
    vi.mocked(getEmailReplyDraft).mockReturnValue(
      new Promise<ReplyDraftDetail>(() => {})
    );
    await wrapper.setProps({ draftId: 12 });
    await flushPromises();
    expect(
      wrapper.find('[data-testid="draft-review-body"]').exists()
    ).toBe(false);
  });

  it("never submits a revision loaded for a different draft (R08)", async () => {
    // A lying backend answers 12's load with 11's row: the resolve submit
    // must not send draft 12 with revision of draft 11.
    vi.mocked(getEmailReplyDraft).mockResolvedValue(draftDetail({ id: 11 }));
    const wrapper = mountCard(12);
    await flushPromises();
    await wrapper.find('[data-testid="draft-review-resolve-btn"]').trigger("click");
    await flushPromises();
    expect(resolveEmailReplyHumanReview).not.toHaveBeenCalled();
  });

  it("renders the no-flag state for a clean draft", async () => {
    vi.mocked(getEmailReplyDraft).mockResolvedValue(
      draftDetail({ requiresHumanReview: false })
    );
    const wrapper = mountCard();
    await flushPromises();
    expect(wrapper.text()).toContain("No human review requested");
    expect(wrapper.find('[data-testid="draft-review-resolve-btn"]').exists()).toBe(false);
  });
});
