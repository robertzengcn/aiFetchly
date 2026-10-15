import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AutoReplyAuditTable from "@/views/pages/emailreply/widgets/AutoReplyAuditTable.vue";
import { listAutoReplyAuditLogs } from "@/views/api/emailreply";
import type { AutoReplyAuditDto } from "@/entityTypes/emailReceiveTypes";

// T10 (FR-033/FR-034): the audit table surfaces a reply-evidence chip driven
// by the typed metadataCode (extracted from the row's structured metadataJson
// at the IPC boundary — never parsed from the English reason text).

vi.mock("@/views/api/emailreply", () => ({
  listAutoReplyAuditLogs: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: {
      common: { search: "Search", actions: "Actions" },
      emailAutoReplyAudit: {
        title: "AI Auto Replies",
        decision_status: "Decision",
        classification: "Classification",
        search: "Search subject, sender, reason, error",
        created_at: "Date",
        subject: "Subject",
        confidence: "Confidence",
        requires_approval: "Approval",
        reply_evidence: "Reply Evidence",
        status: {
          needs_human_review: "Needs Human Review",
          failed: "Failed",
        },
      },
      emailReply: {
        policyCode: {
          already_replied: "Already replied",
          ambiguous_match: "Ambiguous match",
          probe_timeout: "Probe timeout",
        },
      },
    },
  },
});

function auditRow(overrides: Partial<AutoReplyAuditDto> = {}): AutoReplyAuditDto {
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

function mountTable() {
  return mount(AutoReplyAuditTable, {
    global: {
      plugins: [i18n],
      stubs: {
        VSelect: {
          props: ["modelValue", "items", "label", "clearable"],
          template: "<select></select>",
        },
        VTextField: {
          props: ["modelValue", "label"],
          template: "<input />",
        },
        VBtn: {
          inheritAttrs: false,
          emits: ["click"],
          template: `<button v-bind="$attrs" @click="$emit('click')"><slot /></button>`,
        },
        VDataTableServer: {
          props: ["headers", "items", "itemsLength", "loading"],
          emits: ["update:options"],
          template: `<div>
            <div class="test-headers">{{ headers.map((h) => h.title).join("|") }}</div>
            <div v-for="item in items" :key="item.id" class="test-row">
              <slot name="item.decisionStatus" :item="item" />
              <slot name="item.replyEvidence" :item="item" />
              <slot name="item.actions" :item="item" />
            </div>
          </div>`,
          mounted() {
            // The real VDataTableServer fires the initial load this way.
            this.$emit("update:options", { page: 1, itemsPerPage: 20, sortBy: [] });
          },
        },
        VChip: {
          template: "<span><slot /></span>",
        },
        VIcon: true,
      },
    },
  });
}

describe("AutoReplyAuditTable — reply evidence column (T10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listAutoReplyAuditLogs).mockResolvedValue({
      data: [],
      total: 0,
    });
  });

  it("renders the Reply Evidence header", async () => {
    const wrapper = mountTable();
    await flushPromises();
    expect(wrapper.text()).toContain("Reply Evidence");
  });

  it("shows a chip with the i18n label for a typed metadataCode", async () => {
    vi.mocked(listAutoReplyAuditLogs).mockResolvedValue({
      data: [auditRow({ metadataCode: "ambiguous_match", metadataStage: "pre_draft" })],
      total: 1,
    });
    const wrapper = mountTable();
    await flushPromises();
    const row = wrapper.find(".test-row");
    expect(row.text()).toContain("Ambiguous match");
  });

  it("shows an em dash when the row carries no typed code (legacy/non-refusal)", async () => {
    vi.mocked(listAutoReplyAuditLogs).mockResolvedValue({
      data: [auditRow({ metadataCode: null, metadataStage: null })],
      total: 1,
    });
    const wrapper = mountTable();
    await flushPromises();
    expect(wrapper.find(".test-row").text()).toContain("—");
  });

  it("falls back to the raw code when the i18n key is missing", async () => {
    vi.mocked(listAutoReplyAuditLogs).mockResolvedValue({
      data: [auditRow({ metadataCode: "some_future_code" })],
      total: 1,
    });
    const wrapper = mountTable();
    await flushPromises();
    expect(wrapper.find(".test-row").text()).toContain("some_future_code");
  });

  // N09: a leave_unresolved reconciliation mirrors as auto_reply_skipped /
  // needs_human_review — the table must present it as awaiting review,
  // never as a confirmed failure.
  it("presents an unresolved reconciliation as Needs Human Review, not Failed", async () => {
    vi.mocked(listAutoReplyAuditLogs).mockResolvedValue({
      data: [
        auditRow({
          action: "auto_reply_skipped",
          decisionStatus: "needs_human_review",
          reason:
            "Manual reconciliation: leave_unresolved — delivery remains unknown, human review required",
        }),
      ],
      total: 1,
    });
    const wrapper = mountTable();
    await flushPromises();
    const text = wrapper.find(".test-row").text();
    expect(text).toContain("Needs Human Review");
    expect(text).not.toContain("Failed");
  });

  it("still presents a definite send failure as Failed", async () => {
    vi.mocked(listAutoReplyAuditLogs).mockResolvedValue({
      data: [
        auditRow({
          action: "auto_reply_failed",
          decisionStatus: "failed",
          reason: "Manual reconciliation: confirm_not_sent",
        }),
      ],
      total: 1,
    });
    const wrapper = mountTable();
    await flushPromises();
    expect(wrapper.find(".test-row").text()).toContain("Failed");
  });
});
