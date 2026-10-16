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
