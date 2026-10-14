import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AuditDetail from "@/views/pages/emailreply/auditdetail.vue";
import { getAutoReplyAuditLog, checkEmailReplied } from "@/views/api/emailreply";
import type { AutoReplyAuditDto } from "@/entityTypes/emailReceiveTypes";
import type { CheckEmailRepliedResult } from "@/service/emailReceive/EmailReplyDetectionTypes";

// T10 (FR-032/FR-033/FR-034): the audit detail page surfaces the typed
// reply-evidence chip + next-action chip from the structured metadataCode, and
// runs the diagnostic reply recheck through the AI-gated IPC channel.

vi.mock("@/views/api/emailreply", () => ({
  getAutoReplyAuditLog: vi.fn(),
  checkEmailReplied: vi.fn(),
}));

const routerPush = vi.fn();
vi.mock("vue-router", () => ({
  useRoute: () => ({ params: { id: "1" } }),
  useRouter: () => ({ push: routerPush, go: vi.fn() }),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: {
      common: { return: "Return", search: "Search", actions: "Actions" },
      emailAutoReplyAudit: {
        detail_title: "AI Auto-Reply Audit",
        decision_status: "Decision",
        classification: "Classification",
        confidence: "Confidence",
        reason: "Reason",
        reply_evidence: "Reply Evidence",
        stage: "Stage",
        recheck_failed: "Reply check failed. Please try again.",
        knowledge_query: "Knowledge Query",
        knowledge_source_count: "Knowledge Sources",
        created_at: "Date",
        generated_subject: "Generated Subject",
        generated_body_preview: "Generated Body Preview",
        sent_subject: "Sent Subject",
        sent_body_preview: "Sent Body Preview",
        requires_approval: "Approval",
        status: { skipped: "Skipped" },
      },
      emailReply: {
        nextAction: {
          approve_existing_draft: "Approve existing draft",
          discard_and_retry: "Discard and retry",
          await_human_review: "Await human review",
          no_action: "No action needed",
        },
        policyCode: {
          already_replied: "Already replied",
          ambiguous_match: "Ambiguous match",
          probe_timeout: "Probe timeout",
        },
        replyDetection: {
          state_replied: "Replied",
          state_not_replied: "Not replied",
          state_unknown: "Unknown",
          checked_at: "Checked at",
          check_button: "Check reply status",
          coverage_local_only: "Local only",
          coverage_configured_imap: "Configured IMAP",
          coverage_partial: "Partial",
        },
      },
    },
  },
});

function auditFixture(
  overrides: Partial<AutoReplyAuditDto> = {}
): AutoReplyAuditDto {
  return {
    id: 1,
    emailServiceId: 7,
    messageId: 100,
    draftId: null,
    ruleId: null,
    action: "reply_skipped",
    decisionStatus: "skipped",
    classification: null,
    confidence: null,
    reason: "[ambiguous_match] Reply detection was inconclusive",
    knowledgeQuery: null,
    knowledgeSourceCount: 0,
    generatedSubject: null,
    generatedBodyPreview: null,
    sentSubject: null,
    sentBodyPreview: null,
    requiresUserApproval: true,
    approvedByUser: false,
    errorMessage: null,
    metadataStage: null,
    metadataCode: null,
    createdAt: "2026-10-08T00:00:00.000Z",
    ...overrides,
  };
}

function detectionResult(
  overrides: Partial<CheckEmailRepliedResult> = {}
): CheckEmailRepliedResult {
  return {
    success: true,
    message_id: 100,
    state: "not_replied",
    replied: false,
    source: "sent_search",
    reason_code: "no_reply_observed",
    matched_message_id: null,
    checked_at: "2026-10-08T00:01:00.000Z",
    from_cache: false,
    coverage: "configured_imap",
    ...overrides,
  };
}

function mountDetail() {
  return mount(AuditDetail, {
    global: {
      plugins: [i18n],
      stubs: {
        VSheet: { template: "<div><slot /></div>" },
        VCard: { template: "<div><slot /></div>" },
        VRow: { template: "<div><slot /></div>" },
        VCol: { template: "<div><slot /></div>" },
        VBtn: {
          inheritAttrs: false,
          emits: ["click"],
          template: `<button v-bind="$attrs" @click="$emit('click')"><slot /></button>`,
        },
        VChip: { template: "<span><slot /></span>" },
        VIcon: true,
        VAlert: { template: "<div><slot /></div>" },
        VProgressLinear: true,
        AIContentReportButton: true,
        AIContentReportDialog: true,
      },
    },
  });
}

describe("AuditDetail — typed evidence + diagnostic recheck (T10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAutoReplyAuditLog).mockResolvedValue(auditFixture());
  });

  it("renders the reply-evidence chip and stage caption from the typed metadata", async () => {
    vi.mocked(getAutoReplyAuditLog).mockResolvedValue(
      auditFixture({
        metadataCode: "ambiguous_match",
        metadataStage: "pre_draft",
      })
    );
    const wrapper = mountDetail();
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain("Reply Evidence");
    expect(text).toContain("Ambiguous match");
    expect(text).toContain("Stage: pre_draft");
    // Review-routed unknown code → next-action chip visible.
    expect(text).toContain("Await human review");
  });

  it("shows await-human-review (not approve) for already_replied with a draft (R22)", async () => {
    // R22: an audit record is a refusal record. Its draftId is context
    // (which stale draft the refusal touched), never evidence the draft is
    // eligible to approve/send. The previously-unsafe mapping showed
    // "Approve existing draft" here, pointing the operator at a duplicate
    // send for a message that is confirmed replied.
    vi.mocked(getAutoReplyAuditLog).mockResolvedValue(
      auditFixture({
        metadataCode: "already_replied",
        draftId: 42,
      })
    );
    const wrapper = mountDetail();
    await flushPromises();
    expect(wrapper.text()).toContain("Already replied");
    expect(wrapper.text()).toContain("Await human review");
    expect(wrapper.text()).not.toContain("Approve existing draft");
  });

  // Review R-5: the inline nextAction copy had drifted from the canonical
  // nextActionForCode in two ways. After delegating to the service function,
  // the chip must match the service + AI tool exactly. These two cases pin the
  // previously-broken mappings so the duplication cannot silently return.

  it("routes already_replied (no draft) to await_human_review, not no_action (review R-5)", async () => {
    // The inline copy returned no_action here, hiding a confirmed-replied
    // message with no reusable draft. The service routes to await_human_review
    // so the operator can locate the existing reply (review R-3 / Fix 2).
    vi.mocked(getAutoReplyAuditLog).mockResolvedValue(
      auditFixture({
        metadataCode: "already_replied",
        draftId: null,
      })
    );
    const wrapper = mountDetail();
    await flushPromises();
    expect(wrapper.text()).toContain("Already replied");
    expect(wrapper.text()).toContain("Await human review");
    expect(wrapper.text()).not.toContain("No action needed");
  });

  it("routes provider_error to discard_and_retry, not no_action (review R-5)", async () => {
    // The inline copy omitted provider_error from the discard list, so the
    // chip showed no_action where the service + AI tool say discard_and_retry.
    vi.mocked(getAutoReplyAuditLog).mockResolvedValue(
      auditFixture({
        metadataCode: "provider_error",
      })
    );
    const wrapper = mountDetail();
    await flushPromises();
    expect(wrapper.text()).toContain("Discard and retry");
  });

  it("hides the evidence block when the row carries no typed code", async () => {
    const wrapper = mountDetail();
    await flushPromises();
    expect(wrapper.text()).not.toContain("Reply Evidence");
  });

  it("recheck click calls checkEmailReplied with the audit messageId and surfaces the result", async () => {
    vi.mocked(checkEmailReplied).mockResolvedValue(detectionResult());
    const wrapper = mountDetail();
    await flushPromises();

    const button = wrapper.find('[data-testid="audit-detail-recheck"]');
    expect(button.exists()).toBe(true);
    await button.trigger("click");
    await flushPromises();

    expect(checkEmailReplied).toHaveBeenCalledWith(100);
    expect(vi.mocked(checkEmailReplied).mock.calls[0][0]).toBe(100);
    const result = wrapper.find('[data-testid="audit-detail-recheck-result"]');
    expect(result.exists()).toBe(true);
    expect(result.text()).toContain("Not replied");
    // checked_at + coverage caption renders below the chip.
    expect(wrapper.text()).toContain("Configured IMAP");
  });

  it("surfaces a bounded error message when the recheck fails", async () => {
    vi.mocked(checkEmailReplied).mockRejectedValue(
      new Error("AI feature is not enabled")
    );
    const wrapper = mountDetail();
    await flushPromises();

    await wrapper.find('[data-testid="audit-detail-recheck"]').trigger("click");
    await flushPromises();

    const error = wrapper.find('[data-testid="audit-detail-recheck-error"]');
    expect(error.exists()).toBe(true);
    expect(error.text()).toContain("AI feature is not enabled");
    // No result chip on failure.
    expect(
      wrapper.find('[data-testid="audit-detail-recheck-result"]').exists()
    ).toBe(false);
  });

  it("falls back to the generic recheck_failed message for non-Error rejections", async () => {
    vi.mocked(checkEmailReplied).mockRejectedValue("nope" as never);
    const wrapper = mountDetail();
    await flushPromises();

    await wrapper.find('[data-testid="audit-detail-recheck"]').trigger("click");
    await flushPromises();

    const error = wrapper.find('[data-testid="audit-detail-recheck-error"]');
    expect(error.text()).toContain("Reply check failed. Please try again.");
  });

  it("clears a previous error when a subsequent recheck succeeds", async () => {
    vi.mocked(checkEmailReplied)
      .mockRejectedValueOnce(new Error("AI feature is not enabled"))
      .mockResolvedValueOnce(detectionResult());
    const wrapper = mountDetail();
    await flushPromises();

    await wrapper.find('[data-testid="audit-detail-recheck"]').trigger("click");
    await flushPromises();
    expect(
      wrapper.find('[data-testid="audit-detail-recheck-error"]').exists()
    ).toBe(true);

    await wrapper.find('[data-testid="audit-detail-recheck"]').trigger("click");
    await flushPromises();
    expect(
      wrapper.find('[data-testid="audit-detail-recheck-error"]').exists()
    ).toBe(false);
    expect(
      wrapper.find('[data-testid="audit-detail-recheck-result"]').exists()
    ).toBe(true);
  });
});
