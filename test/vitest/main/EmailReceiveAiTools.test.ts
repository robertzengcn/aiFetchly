import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock heavy dependencies that the registry pulls in transitively, so the test
// can load skillsRegistry without a live DB / Electron / vector store.
vi.mock("@/service/ToolExecutor", () => ({
  ToolExecutor: { execute: vi.fn() },
}));
vi.mock("@/service/MCPToolService", () => ({
  MCPToolService: { getAllTools: () => [], refresh: vi.fn() },
}));

// FR-033 stubs: mutable module-level handles the tool layer picks up. Each
// mocked class is a real function declaration so `new MockedClass()` returns
// the stub object (arrow functions don't work as constructors).
const draftGenStub = { createDraft: vi.fn() };
const deliveryStub = { sendApprovedReply: vi.fn() };
const approvalStub = { approveDraft: vi.fn() };
const draftModuleStub = {
  ensureConnection: vi.fn(),
  read: vi.fn(),
  countActiveSendAttempts: vi.fn(),
  demoteApprovedToDraft: vi.fn(),
};

// FR-032 check_email_replied stubs: the tool layer constructs these via
// `new ModuleName()` before calling checkReply/read. Each is a function
// declaration returning the stub object so `new` works.
const detectionModuleStub = {
  ensureConnection: vi.fn(),
  checkReply: vi.fn(),
};
const messageModuleStub = {
  ensureConnection: vi.fn(),
  read: vi.fn(),
  listByEmailService: vi.fn(),
  markRead: vi.fn(),
};
// Approved-draft re-confirm path retires prior approvals in bulk before the
// CAS demotion (D3/D4 review fixes).
const approvalModuleStub = {
  ensureConnection: vi.fn(),
  findActiveByDraft: vi.fn(),
  invalidate: vi.fn(),
  invalidateAllForDraft: vi.fn(),
};
vi.mock("@/modules/EmailReplyApprovalModule", () => ({
  EmailReplyApprovalModule: function () {
    return approvalModuleStub;
  },
}));

// AI-enable gate (FR-6.1): default true so happy-path tests proceed; the
// disabled-AI test flips this to false.
let aiEnabled = true;

vi.mock("@/service/emailReply/EmailReplyDraftGenerationService", () => ({
  EmailReplyDraftGenerationService: function () {
    return draftGenStub;
  },
  // G01/FR-027: the production EmailReceiveAiTools imports this factory to
  // wire the capability clamp. The mock's EmailReplyDraftGenerationService
  // constructor returns a stub that never invokes it, so a no-op stub keeps
  // the module shape consistent without exercising the real resolver.
  createModelOutputCapResolver: () => async () => undefined,
  // F06/FR-027: same shape-keeping stub for the context-window resolver.
  createModelContextResolver: () => async () => undefined,
}));
vi.mock("@/service/emailReply/EmailReplyDeliveryService", () => ({
  EmailReplyDeliveryService: function () {
    return deliveryStub;
  },
}));
vi.mock("@/service/emailReply/EmailReplyApprovalService", () => ({
  EmailReplyApprovalService: function () {
    return approvalStub;
  },
}));
vi.mock("@/modules/EmailReplyDraftModule", () => ({
  EmailReplyDraftModule: function () {
    return draftModuleStub;
  },
}));
vi.mock("@/modules/EmailReplyDetectionModule", () => ({
  EmailReplyDetectionModule: function () {
    return detectionModuleStub;
  },
}));
vi.mock("@/modules/EmailReceivedMessageModule", () => ({
  EmailReceivedMessageModule: function () {
    return messageModuleStub;
  },
}));
// G02: fetch_unread_emails uses EmailReceiveSyncService.syncUnread then loads
// stored rows via listByEmailService. Mock the sync service so the fetch
// integration test can drive the evidence-projection path without a mailbox.
const syncServiceStub = {
  syncUnread: vi.fn(),
};
vi.mock("@/service/emailReceive/EmailReceiveSyncService", () => ({
  EmailReceiveSyncService: function () {
    return syncServiceStub;
  },
}));
// writeReadAudit / listEmailInboxes / markEmailProcessed construct these.
// writeReadAudit swallows failures, but the constructors touch the DB layer, so
// stub them to keep the integration tests pure.
const auditLogModuleStub = { create: vi.fn() };
vi.mock("@/modules/EmailReplyAuditLogModule", () => ({
  EmailReplyAuditLogModule: function () {
    return auditLogModuleStub;
  },
}));
vi.mock("@/entity/EmailReplyAuditLog.entity", () => ({
  EmailReplyAuditLogEntity: function () {
    return {};
  },
}));
const emailServiceModuleStub = {
  ensureConnection: vi.fn(),
  listReceiveEnabledServices: vi.fn(),
};
vi.mock("@/modules/emailServiceModule", () => ({
  EmailServiceModule: function () {
    return emailServiceModuleStub;
  },
}));
vi.mock("@/service/AiFeatureGate", () => ({
  // The tool's defaultIsAiEnabled() reads this; the disabled-AI test
  // flips the handle to false.
  ensureHostedAiEnabled: () => Promise.resolve(aiEnabled),
}));
vi.mock("@/config/featureFlags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/featureFlags")>();
  return {
    ...actual,
    isEmailReplyKillSwitchOn: () => false,
  };
});

import { SkillRegistry } from "@/config/skillsRegistry";
import {
  createEmailReplyDraft,
  sendEmailReply,
  checkEmailReplied,
  deriveReplyEvidence,
  fetchUnreadEmails,
  getEmailMessage,
} from "@/service/EmailReceiveAiTools";
import { createEmailReplyDraftSchema } from "@/entityTypes/emailReceiveAiTypes";
import { emailReplyDraftCreateInputSchema } from "@/schemas/ipc/emailReply";
import {
  SendPolicyRejection,
  SendBindingError,
} from "@/service/emailReply/EmailReplySendBinding";

const READ_TOOLS = [
  "list_email_inboxes",
  "fetch_unread_emails",
  "get_email_message",
  "mark_email_processed",
] as const;

describe("Email receive AI tools registration", () => {
  for (const name of READ_TOOLS) {
    it(`registers ${name} as a built-in automation tool`, () => {
      const skill = SkillRegistry.getSkill(name);
      expect(skill).not.toBeNull();
      expect(skill!.source).toBe("built-in");
      expect(skill!.tier).toBe("main");
      expect(skill!.permissionCategory).toBe("automation");
      expect(skill!.requiresConfirmation).toBe(false);
      expect(typeof skill!.execute).toBe("function");
    });
  }

  it("advertises all email receive tools to the LLM", async () => {
    const fns = await SkillRegistry.getAllToolFunctions();
    const names = new Set(fns.map((f) => (f as { name: string }).name));
    for (const name of READ_TOOLS) {
      expect(names.has(name)).toBe(true);
    }
  });

  it("fetch_unread_emails requires email_service_id and caps limit", () => {
    const skill = SkillRegistry.getSkill("fetch_unread_emails")!;
    const props = skill.parameters.properties as Record<
      string,
      { type: string; default?: unknown }
    >;
    expect(props.email_service_id).toBeDefined();
    expect(skill.parameters.required).toContain("email_service_id");
    expect(props.limit.default).toBe(10);
  });

  it("get_email_message requires message_id", () => {
    const skill = SkillRegistry.getSkill("get_email_message")!;
    expect(skill.parameters.required).toContain("message_id");
  });

  it("mark_email_processed requires message_id and status", () => {
    const skill = SkillRegistry.getSkill("mark_email_processed")!;
    expect(skill.parameters.required).toContain("message_id");
    expect(skill.parameters.required).toContain("status");
  });
});

describe("Email reply draft/send AI tools", () => {
  it("create_email_reply_draft does NOT require confirmation (draft only)", () => {
    const skill = SkillRegistry.getSkill("create_email_reply_draft");
    expect(skill).not.toBeNull();
    expect(skill!.source).toBe("built-in");
    expect(skill!.permissionCategory).toBe("automation");
    expect(skill!.requiresConfirmation).toBe(false);
    expect(skill!.parameters.required).toContain("message_id");
    expect(skill!.description).toContain("check_email_replied");
    expect(skill!.description).toContain("does not probe");
  });

  it("create_email_reply_draft accepts reviewed=true in its schema and registry", () => {
    const parsed = createEmailReplyDraftSchema.parse({
      message_id: 3,
      reviewed: true,
    });
    expect(parsed.reviewed).toBe(true);
    const skill = SkillRegistry.getSkill("create_email_reply_draft");
    expect(skill).not.toBeNull();
    const props = skill!.parameters.properties as Record<
      string,
      { type: string; description?: string }
    >;
    expect(props.reviewed?.type).toBe("boolean");
    // Usage restriction is stated where the model can read it.
    expect(skill!.description).toMatch(/reviewed/i);
    expect(props.reviewed?.description).toMatch(/ONLY/i);
  });

  it("IPC draft-create schema accepts humanReviewed", () => {
    // lazySchema exports a THUNK (first call caches + returns the schema).
    const parsed = emailReplyDraftCreateInputSchema().parse({
      messageId: 3,
      humanReviewed: true,
    });
    expect(parsed.humanReviewed).toBe(true);
  });

  it("send_email_reply REQUIRES confirmation (it sends email)", () => {
    const skill = SkillRegistry.getSkill("send_email_reply");
    expect(skill).not.toBeNull();
    expect(skill!.source).toBe("built-in");
    expect(skill!.permissionCategory).toBe("automation");
    expect(skill!.requiresConfirmation).toBe(true);
    expect(skill!.parameters.required).toContain("draft_id");
  });
});

// ---------------------------------------------------------------------------
// Stable refusal envelopes (FR-033)
// ---------------------------------------------------------------------------

describe("createEmailReplyDraft — stable refusal envelope (FR-033)", () => {
  it("surfaces code=already_replied and next_action from an already-replied refusal", async () => {
    // B12: the generation service now returns a typed failure union carrying
    // code/next_action additively alongside the legacy error string. The AI
    // tool reads the typed fields directly -- no English parsing.
    // R-5: already_replied WITHOUT an existing_draft_id routes to
    // await_human_review (not no_action) — the duplicate guard did its job,
    // but the operator should locate the existing reply rather than the model
    // silently doing nothing. nextActionForCode is the canonical mapping.
    draftGenStub.createDraft.mockResolvedValue({
      success: false,
      error:
        "[already_replied] Message already has a sent reply; refusing duplicate",
      code: "already_replied",
      next_action: "await_human_review",
      requestCorrelationId: "erx-req-abc-1",
    });
    const result = await createEmailReplyDraft({ message_id: 1 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("already_replied");
    expect(result.next_action).toBe("await_human_review");
    expect(result.error).toContain("already has a sent reply");
    // R19: the request correlation id survives the tool boundary so the refusal
    // can be joined to lifecycle audits.
    expect(result.requestCorrelationId).toBe("erx-req-abc-1");
  });

  it("R19: preserves requestCorrelationId on a typed generation refusal (todo reproduction)", async () => {
    // Verbatim from the re-audit todo: execute the mapper with
    // {success:false, error:'refused', code:'already_replied',
    //  requestCorrelationId:'request-unique-123'} — the returned object MUST
    // carry requestCorrelationId (previously dropped: success/error/code/
    // next_action only).
    draftGenStub.createDraft.mockResolvedValue({
      success: false,
      error: "refused",
      code: "already_replied",
      requestCorrelationId: "request-unique-123",
    });
    const result = await createEmailReplyDraft({ message_id: 1 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("refused");
    expect(result.code).toBe("already_replied");
    expect(result.next_action).toBe("await_human_review");
    expect(result.requestCorrelationId).toBe("request-unique-123");
  });

  it("surfaces code=needs_human_review with await_human_review", async () => {
    draftGenStub.createDraft.mockResolvedValue({
      success: false,
      error:
        "[needs_human_review] Generation failed validation twice (2 codes); no draft persisted",
      code: "needs_human_review",
      next_action: "await_human_review",
      requestCorrelationId: "erx-req-abc-2",
    });
    const result = await createEmailReplyDraft({ message_id: 1 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("needs_human_review");
    expect(result.next_action).toBe("await_human_review");
  });

  it("maps provider_error to discard_and_retry with no typed code slot", async () => {
    // B12: provider_error is NOT a policy code, so the typed `code` slot stays
    // undefined. The generation service derives next_action directly (it knows
    // this is a transport failure) rather than from a policy code.
    draftGenStub.createDraft.mockResolvedValue({
      success: false,
      error: "[provider_error] network timeout",
      next_action: "discard_and_retry",
      requestCorrelationId: "erx-req-abc-3",
    });
    const result = await createEmailReplyDraft({ message_id: 1 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBeUndefined();
    expect(result.next_action).toBe("discard_and_retry");
  });

  it("returns the success DTO unchanged on a fresh generation", async () => {
    draftGenStub.createDraft.mockResolvedValue({
      success: true,
      draftId: 42,
      messageId: 1,
      subject: "Re: Hi",
      bodyText: "Hello",
      bodyHtml: null,
      classification: "interested",
      knowledgeSources: [],
      confidence: 0.8,
      warnings: [],
      reused: false,
    });
    const result = await createEmailReplyDraft({ message_id: 1 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.draftId).toBe(42);
    expect(result.reused).toBe(false);
  });

  it("returns a validation failure (no code) on bad input", async () => {
    const result = await createEmailReplyDraft({ message_id: "not-a-number" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBeUndefined();
    expect(result.validation_errors).toBeDefined();
  });

  it("B12: does NOT recover a code by parsing English when the typed code is absent", async () => {
    // The legacy error string still carries a [needs_human_review] bracket, but
    // the widened failure union omits the typed `code` field (e.g. an
    // audit-persistence failure whose error text happens to contain a bracket).
    // The AI tool must NOT regex-parse the bracket -- code stays undefined and
    // next_action falls back to no_action (no policy code to derive from).
    draftGenStub.createDraft.mockResolvedValue({
      success: false,
      error:
        "Reuse audit persistence failed: [needs_human_review] unrelated text",
      requestCorrelationId: "erx-req-abc-4",
    });
    const result = await createEmailReplyDraft({ message_id: 1 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBeUndefined();
    expect(result.next_action).toBe("no_action");
  });
});

describe("sendEmailReply — stable refusal envelope (FR-033)", () => {
  // The send tool loads the draft first, then approves + delivers. Stub the
  // draft read to return a sendable draft so the delivery stub is reached.
  function stubDraft(draftId: number): void {
    draftModuleStub.read.mockResolvedValue({
      id: draftId,
      messageId: 1,
      emailServiceId: 1,
      subject: "Re: Hi",
      bodyText: "Hello",
      bodyHtml: null,
      status: "draft",
    });
    approvalStub.approveDraft.mockResolvedValue({ token: "tok" });
  }

  it("surfaces the SendPolicyRejection code on a pre-send refusal", async () => {
    stubDraft(10);
    deliveryStub.sendApprovedReply.mockRejectedValue(
      new SendPolicyRejection(
        "Send rejected by policy: Message already has a sent reply; refusing duplicate",
        "already_replied"
      )
    );
    const result = await sendEmailReply({ draft_id: 10, email_service_id: 1 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("already_replied");
    // R-5: a pre-send already_replied refusal routes to await_human_review
    // (canonical nextActionForCode(code, undefined)) — the duplicate guard
    // refused before SMTP, but the operator should locate the existing reply
    // rather than the model silently doing nothing.
    expect(result.next_action).toBe("await_human_review");
    expect(result.error).toContain("already has a sent reply");
  });

  it("surfaces a SendBindingError code (mapped) on a binding failure", async () => {
    stubDraft(11);
    deliveryStub.sendApprovedReply.mockRejectedValue(
      new SendBindingError(
        "Send rejected: approval is not bound to the draft's current revision",
        "approval_stale"
      )
    );
    const result = await sendEmailReply({ draft_id: 11, email_service_id: 1 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("approval_stale");
    expect(result.next_action).toBe("discard_and_retry");
  });

  it("surfaces code=delivery_unknown on an ambiguous outcome", async () => {
    stubDraft(12);
    deliveryStub.sendApprovedReply.mockResolvedValue({
      status: "delivery_unknown",
      attemptId: 99,
      error: "Connection dropped after DATA",
    });
    const result = await sendEmailReply({ draft_id: 12, email_service_id: 1 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("delivery_unknown");
    expect(result.next_action).toBe("await_human_review");
  });

  it("surfaces code=already_replied on an already-processed submission", async () => {
    stubDraft(13);
    deliveryStub.sendApprovedReply.mockResolvedValue({
      status: "already_processed",
      attemptId: 5,
    });
    const result = await sendEmailReply({ draft_id: 13, email_service_id: 1 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("already_replied");
    // R-5: already_replied without a reusable draft id routes to
    // await_human_review (canonical nextActionForCode), consistent with the
    // SendPolicyRejection path — the operator locates the existing reply.
    expect(result.next_action).toBe("await_human_review");
  });

  it("returns the sent envelope on success", async () => {
    stubDraft(14);
    deliveryStub.sendApprovedReply.mockResolvedValue({
      status: "sent",
      attemptId: 7,
      sentAt: "2026-10-05T00:00:00.000Z",
    });
    const result = await sendEmailReply({ draft_id: 14, email_service_id: 1 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.draft_id).toBe(14);
    expect(result.sent_at).toBe("2026-10-05T00:00:00.000Z");
  });

  it("R13: a 'failed' draft reaches the fenced approval instead of the status gate", async () => {
    // A definite SMTP rejection finalizes the draft as `failed`; the reuse
    // path hands the same ID back. The tool must let the failed draft reach
    // `approveDraft` (which performs the fenced failed->draft reopen) rather
    // than refusing at the status gate.
    draftModuleStub.read.mockResolvedValue({
      id: 15,
      messageId: 1,
      emailServiceId: 1,
      subject: "Re: Hi",
      bodyText: "Hello",
      bodyHtml: null,
      status: "failed",
    });
    approvalStub.approveDraft.mockResolvedValue({ token: "fresh-tok" });
    deliveryStub.sendApprovedReply.mockResolvedValue({
      status: "sent",
      attemptId: 21,
      sentAt: "2026-10-12T00:00:00.000Z",
    });
    const result = await sendEmailReply({ draft_id: 15, email_service_id: 1 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    // The approval service was actually invoked (the gate did not short-circuit).
    expect(approvalStub.approveDraft).toHaveBeenCalledWith({
      draftId: 15,
      approvedByType: "tool_confirmation",
      approvedById: "ai_tool",
    });
    expect(result.sent_at).toBe("2026-10-12T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// check_email_replied (FR-032) — diagnostic reply-check tool
// ---------------------------------------------------------------------------

describe("check_email_replied — registration (FR-032)", () => {
  it("registers as a built-in read tool with NO confirmation", () => {
    const skill = SkillRegistry.getSkill("check_email_replied");
    expect(skill).not.toBeNull();
    expect(skill!.source).toBe("built-in");
    expect(skill!.tier).toBe("main");
    expect(skill!.permissionCategory).toBe("network");
    expect(skill!.requiresConfirmation).toBe(false);
    expect(skill!.parameters.required).toContain("message_id");
    expect(typeof skill!.execute).toBe("function");
    expect(skill!.description).toContain("create_email_reply_draft");
    expect(skill!.description).toContain("before");
  });

  it("advertises check_email_replied to the LLM", async () => {
    const fns = await SkillRegistry.getAllToolFunctions();
    const names = new Set(fns.map((f) => (f as { name: string }).name));
    expect(names.has("check_email_replied")).toBe(true);
  });
});

describe("checkEmailReplied — three-state happy path (FR-032)", () => {
  // Seed-message row the tool's existence check returns. Only the fields the
  // tool reads (id) matter; detection is fully mocked.
  function stubMessageExists(messageId: number): void {
    messageModuleStub.ensureConnection.mockResolvedValue(undefined);
    messageModuleStub.read.mockResolvedValue({ id: messageId, emailServiceId: 1 });
    detectionModuleStub.ensureConnection.mockResolvedValue(undefined);
  }

  it("surfaces state=replied (positive, sticky) with matched_message_id", async () => {
    stubMessageExists(101);
    detectionModuleStub.checkReply.mockResolvedValue({
      success: true,
      result: {
        success: true,
        message_id: 101,
        state: "replied",
        replied: true,
        source: "sent_search",
        reason_code: "already_replied",
        matched_message_id: "<outgoing-123@svc.com>",
        checked_at: "2026-10-05T00:00:00.000Z",
        from_cache: true,
        coverage: "configured_imap",
      },
    });
    const result = await checkEmailReplied({ message_id: 101 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.message_id).toBe(101);
    expect(result.state).toBe("replied");
    expect(result.replied).toBe(true);
    expect(result.reason_code).toBe("already_replied");
    expect(result.matched_message_id).toBe("<outgoing-123@svc.com>");
    expect(result.from_cache).toBe(true);
    expect(result.coverage).toBe("configured_imap");
  });

  it("surfaces state=not_replied (complete negative) with no_reply_observed", async () => {
    stubMessageExists(102);
    detectionModuleStub.checkReply.mockResolvedValue({
      success: true,
      result: {
        success: true,
        message_id: 102,
        state: "not_replied",
        replied: false,
        source: "sent_search",
        reason_code: "no_reply_observed",
        matched_message_id: null,
        checked_at: "2026-10-05T00:00:00.000Z",
        from_cache: false,
        coverage: "configured_imap",
      },
    });
    const result = await checkEmailReplied({ message_id: 102 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.state).toBe("not_replied");
    expect(result.replied).toBe(false);
    expect(result.reason_code).toBe("no_reply_observed");
    expect(result.matched_message_id).toBeNull();
  });

  it("surfaces state=unknown (inconclusive) with replied=null and a typed code", async () => {
    stubMessageExists(103);
    detectionModuleStub.checkReply.mockResolvedValue({
      success: true,
      result: {
        success: true,
        message_id: 103,
        state: "unknown",
        replied: null,
        source: "unavailable",
        reason_code: "sent_folder_unavailable",
        matched_message_id: null,
        checked_at: "2026-10-05T00:00:00.000Z",
        from_cache: false,
        coverage: "partial",
      },
    });
    const result = await checkEmailReplied({ message_id: 103 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.state).toBe("unknown");
    expect(result.replied).toBeNull();
    expect(result.reason_code).toBe("sent_folder_unavailable");
    expect(result.coverage).toBe("partial");
  });
});

describe("checkEmailReplied — boundary failures (FR-032)", () => {
  beforeEach(() => {
    aiEnabled = true;
    // Mock call counts leak across describe blocks (the happy-path suite
    // above calls checkReply/read). Reset before each boundary test so the
    // `not.toHaveBeenCalled()` assertions are authoritative.
    vi.clearAllMocks();
  });

  it("returns {success:false} when AI is disabled BEFORE any Module is constructed", async () => {
    // FR-6.1: the AI-enable gate runs before parsing and before any Module.
    // No detection work should happen — assert checkReply is never reached.
    aiEnabled = false;
    detectionModuleStub.checkReply.mockResolvedValue({ success: true });
    messageModuleStub.read.mockResolvedValue({ id: 1 });
    const result = await checkEmailReplied({ message_id: 1 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("AI feature is not enabled");
    expect(detectionModuleStub.checkReply).not.toHaveBeenCalled();
    expect(messageModuleStub.read).not.toHaveBeenCalled();
  });

  it("returns {success:false} when the seed message is missing (no detection probe)", async () => {
    messageModuleStub.ensureConnection.mockResolvedValue(undefined);
    messageModuleStub.read.mockResolvedValue(null);
    const result = await checkEmailReplied({ message_id: 999 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("Message not found");
    expect(detectionModuleStub.checkReply).not.toHaveBeenCalled();
  });

  it("returns {success:false} on a detection persistence failure (no raw errors leaked)", async () => {
    messageModuleStub.ensureConnection.mockResolvedValue(undefined);
    messageModuleStub.read.mockResolvedValue({ id: 5, emailServiceId: 1 });
    detectionModuleStub.ensureConnection.mockResolvedValue(undefined);
    // The service already sanitizes to a bounded error string.
    detectionModuleStub.checkReply.mockResolvedValue({
      success: false,
      error: "Reply detection failed",
    });
    const result = await checkEmailReplied({ message_id: 5 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("Reply detection failed");
    // No code/matched_message_id leakage on a failure envelope.
    expect(result.code).toBeUndefined();
  });

  it("returns a validation failure on bad input (no detection work)", async () => {
    const result = await checkEmailReplied({ message_id: "not-a-number" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.validation_errors).toBeDefined();
    expect(detectionModuleStub.checkReply).not.toHaveBeenCalled();
  });
});

describe("checkEmailReplied — no-leak invariant (FR-039)", () => {
  // The DTO must never carry credentials, raw provider errors, bodies, or
  // internal exception details — only low-cardinality codes, booleans,
  // timestamps, and the matched message id. Assert the safe field set on a
  // successful result and confirm no secret-shaped keys appear.
  it("carries only safe low-cardinality fields on a replied result", async () => {
    messageModuleStub.ensureConnection.mockResolvedValue(undefined);
    messageModuleStub.read.mockResolvedValue({ id: 7, emailServiceId: 1 });
    detectionModuleStub.ensureConnection.mockResolvedValue(undefined);
    detectionModuleStub.checkReply.mockResolvedValue({
      success: true,
      result: {
        success: true,
        message_id: 7,
        state: "replied",
        replied: true,
        source: "mailbox_flag",
        reason_code: "already_replied",
        matched_message_id: "<outgoing-7@svc.com>",
        checked_at: "2026-10-05T00:00:00.000Z",
        from_cache: true,
        coverage: "local_only",
      },
    });
    const result = await checkEmailReplied({ message_id: 7 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const keys = Object.keys(result);
    // Allowlisted safe fields only — no password/secret/body/raw-error keys.
    expect(keys).toEqual(
      expect.arrayContaining([
        "success",
        "message_id",
        "state",
        "replied",
        "source",
        "reason_code",
        "matched_message_id",
        "checked_at",
        "from_cache",
        "coverage",
      ])
    );
    const forbidden = keys.filter((k) =>
      /password|secret|token|credential|body|raw|stack|exception/i.test(k)
    );
    expect(forbidden).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// G02 — safe reply evidence in ordinary message summaries (FR-033/FR-030)
// ---------------------------------------------------------------------------

describe("deriveReplyEvidence — three-state pure helper (G02)", () => {
  // Sticky positive: replyDetectedAt set → replied:true, source preserved.
  it("returns replied:true for a sticky positive (mailbox_flag)", () => {
    const ev = deriveReplyEvidence({
      replyDetectedAt: new Date("2026-10-01T00:00:00Z"),
      replyDetectionSource: "mailbox_flag",
      replyNegativeCheckAt: null,
      isAnswered: 1,
      answeredFlagCheckedAt: new Date("2026-10-01T00:00:00Z"),
      replyStatus: "not_started",
    });
    expect(ev.replied).toBe(true);
    expect(ev.replyDetectedAt).toBe("2026-10-01T00:00:00.000Z");
    expect(ev.replyDetectionSource).toBe("mailbox_flag");
    // A stored negative is absent; but a stale negative MUST NOT weaken it.
    expect(ev.replyNegativeCheckAt).toBeNull();
    expect(ev.answeredFlagObserved).toBe(true);
    expect(ev.answeredFlagCheckedAt).toBe("2026-10-01T00:00:00.000Z");
  });

  // Adversarial: a later negative observation does NOT clear a sticky positive.
  it("stale negative does not weaken a sticky positive", () => {
    const ev = deriveReplyEvidence({
      replyDetectedAt: new Date("2026-10-01T00:00:00Z"),
      replyDetectionSource: "sent_search",
      replyNegativeCheckAt: new Date("2026-10-10T00:00:00Z"),
      isAnswered: 0,
      answeredFlagCheckedAt: new Date("2026-10-10T00:00:00Z"),
      replyStatus: "not_started",
    });
    expect(ev.replied).toBe(true);
    expect(ev.replyDetectedAt).toBe("2026-10-01T00:00:00.000Z");
    expect(ev.replyDetectionSource).toBe("sent_search");
  });

  // Complete negative (no positive): replied:false.
  it("returns replied:false for a stored complete negative", () => {
    const ev = deriveReplyEvidence({
      replyDetectedAt: null,
      replyDetectionSource: null,
      replyNegativeCheckAt: new Date("2026-10-05T00:00:00Z"),
      isAnswered: 0,
      answeredFlagCheckedAt: new Date("2026-10-05T00:00:00Z"),
      replyStatus: "not_started",
    });
    expect(ev.replied).toBe(false);
    expect(ev.replyDetectedAt).toBeNull();
    expect(ev.replyNegativeCheckAt).toBe("2026-10-05T00:00:00.000Z");
  });

  // Legacy / never-checked / freshly-synced: replied:null (unknown is NEVER
  // a false negative).
  it("returns replied:null for a legacy/never-checked row", () => {
    const ev = deriveReplyEvidence({
      replyDetectedAt: null,
      replyDetectionSource: null,
      replyNegativeCheckAt: null,
      isAnswered: 0,
      answeredFlagCheckedAt: null,
      replyStatus: "not_started",
    });
    expect(ev.replied).toBeNull();
    expect(ev.replyDetectedAt).toBeNull();
    expect(ev.replyNegativeCheckAt).toBeNull();
    expect(ev.answeredFlagObserved).toBe(false);
    expect(ev.answeredFlagCheckedAt).toBeNull();
  });

  // App-delivery proof strengthens an evidence-less row to replied:true.
  it("replyStatus=sent strengthens an evidence-less row to replied:true", () => {
    const ev = deriveReplyEvidence({
      replyDetectedAt: null,
      replyDetectionSource: null,
      replyNegativeCheckAt: null,
      isAnswered: 0,
      answeredFlagCheckedAt: null,
      replyStatus: "sent",
    });
    expect(ev.replied).toBe(true);
    // No detector evidence columns, but the app lifecycle is the proof.
    expect(ev.replyDetectedAt).toBeNull();
    expect(ev.replyDetectionSource).toBeNull();
  });

  // Adversarial: app-sent does NOT downgrade a stored complete negative to
  // true — but `sent` IS app-delivery proof, so it strengthens over null. A
  // stored negative WITH replyStatus sent is contradictory; the positive
  // (replyDetectedAt) path still wins. Here we assert sent does not weaken a
  // stored negative to null.
  it("replyStatus=sent does not weaken a stored negative to null", () => {
    const ev = deriveReplyEvidence({
      replyDetectedAt: null,
      replyDetectionSource: null,
      replyNegativeCheckAt: new Date("2026-10-05T00:00:00Z"),
      isAnswered: 0,
      answeredFlagCheckedAt: new Date("2026-10-05T00:00:00Z"),
      replyStatus: "sent",
    });
    // app-sent is positive proof → replied:true (strengthens over the negative).
    expect(ev.replied).toBe(true);
  });

  // Flag observed but no sticky positive recorded yet → null + flag surfaced.
  it("answered flag observed without sticky positive surfaces flag + replied:null", () => {
    const ev = deriveReplyEvidence({
      replyDetectedAt: null,
      replyDetectionSource: null,
      replyNegativeCheckAt: null,
      isAnswered: 1,
      answeredFlagCheckedAt: new Date("2026-10-05T00:00:00Z"),
      replyStatus: "not_started",
    });
    // No stored positive/negative → unknown; but the raw flag is surfaced so
    // the AI can distinguish "flag seen, not yet sticky" from "never checked".
    expect(ev.replied).toBeNull();
    expect(ev.answeredFlagObserved).toBe(true);
    expect(ev.answeredFlagCheckedAt).toBe("2026-10-05T00:00:00.000Z");
  });

  // FR-039 no-leak: the evidence object never carries secrets/bodies/raw
  // mailbox exceptions.
  it("exposes only low-cardinality safe fields (FR-039)", () => {
    const ev = deriveReplyEvidence({
      replyDetectedAt: new Date("2026-10-01T00:00:00Z"),
      replyDetectionSource: "sent_search",
      replyNegativeCheckAt: null,
      isAnswered: 1,
      answeredFlagCheckedAt: new Date("2026-10-01T00:00:00Z"),
      replyStatus: "sent",
    });
    const keys = Object.keys(ev);
    expect(keys).toEqual(
      expect.arrayContaining([
        "replied",
        "replyDetectedAt",
        "replyDetectionSource",
        "replyNegativeCheckAt",
        "answeredFlagObserved",
        "answeredFlagCheckedAt",
      ])
    );
    const forbidden = keys.filter((k) =>
      /password|secret|token|credential|body|raw|stack|exception|contextHash/i.test(k)
    );
    expect(forbidden).toEqual([]);
  });
});

// A minimal stored-message row shape the mapper accepts. Only the fields
// toMessageSummary reads; the evidence columns are optional for legacy rows.
function storedRow(
  overrides: Partial<{
    id: number;
    emailServiceId: number;
    providerUid: string;
    replyStatus: string;
    fromAddress: string;
    replyToAddress: string | null;
    replyDetectedAt: Date | null;
    replyDetectionSource: string | null;
    replyNegativeCheckAt: Date | null;
    isAnswered: number;
    answeredFlagCheckedAt: Date | null;
  }>
): Record<string, unknown> {
  return {
    id: 1,
    emailServiceId: 10,
    providerUid: "INBOX:42",
    messageId: "<msg-1@x.com>",
    threadKey: "<msg-1@x.com>",
    fromAddress: overrides.fromAddress ?? "sender@example.com",
    fromName: "Sender",
    replyToAddress: overrides.replyToAddress ?? null,
    subject: "Hello",
    receivedAt: new Date("2026-10-01T00:00:00Z"),
    isUnread: 1,
    classification: "interested",
    replyStatus: "not_started",
    replyDetectedAt: null,
    replyDetectionSource: null,
    replyNegativeCheckAt: null,
    isAnswered: 0,
    answeredFlagCheckedAt: null,
    ...overrides,
  };
}

describe("getEmailMessage — evidence flows to the detail DTO (G02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    messageModuleStub.ensureConnection.mockResolvedValue(undefined);
    auditLogModuleStub.create.mockResolvedValue(undefined);
    aiEnabled = true;
  });

  it("exposes sticky-positive evidence on a not_started (R11) row", async () => {
    // R11: a freshly observed \Answered flag is sticky positive evidence; the
    // replyStatus stays not_started. The summary must still surface replied:true.
    messageModuleStub.read.mockResolvedValue(
      storedRow({
        id: 101,
        replyStatus: "not_started",
        replyDetectedAt: new Date("2026-10-02T00:00:00Z"),
        replyDetectionSource: "mailbox_flag",
        isAnswered: 1,
        answeredFlagCheckedAt: new Date("2026-10-02T00:00:00Z"),
      })
    );
    const result = await getEmailMessage({ message_id: 101 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.message.replyStatus).toBe("not_started");
    expect(result.message.replyEvidence.replied).toBe(true);
    expect(result.message.replyEvidence.replyDetectedAt).toBe(
      "2026-10-02T00:00:00.000Z"
    );
    expect(result.message.replyEvidence.replyDetectionSource).toBe(
      "mailbox_flag"
    );
    expect(result.message.replyEvidence.answeredFlagObserved).toBe(true);
  });

  it("exposes replied:null for a legacy row with no evidence columns", async () => {
    messageModuleStub.read.mockResolvedValue(
      storedRow({ id: 102, replyStatus: "not_started" })
    );
    const result = await getEmailMessage({ message_id: 102 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.message.replyEvidence.replied).toBeNull();
    expect(result.message.replyEvidence.replyDetectedAt).toBeNull();
    expect(result.message.replyEvidence.replyNegativeCheckAt).toBeNull();
    expect(result.message.replyEvidence.answeredFlagObserved).toBe(false);
  });

  it("exposes replied:false for a stale-negative row", async () => {
    messageModuleStub.read.mockResolvedValue(
      storedRow({
        id: 103,
        replyStatus: "not_started",
        replyNegativeCheckAt: new Date("2026-10-03T00:00:00Z"),
        answeredFlagCheckedAt: new Date("2026-10-03T00:00:00Z"),
      })
    );
    const result = await getEmailMessage({ message_id: 103 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.message.replyEvidence.replied).toBe(false);
    expect(result.message.replyEvidence.replyNegativeCheckAt).toBe(
      "2026-10-03T00:00:00.000Z"
    );
  });

  it("does not mark a human Reply-To as automated when From is no-reply", async () => {
    messageModuleStub.read.mockResolvedValue(
      storedRow({
        id: 105,
        fromAddress: "no-reply@forms.example.com",
        replyToAddress: "estewaycom@gmail.com",
      })
    );
    const result = await getEmailMessage({ message_id: 105 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.message.isAutomatedSender).toBe(false);
  });

  it("exposes replied:true for an app-sent row with no detector evidence", async () => {
    messageModuleStub.read.mockResolvedValue(
      storedRow({ id: 104, replyStatus: "sent" })
    );
    const result = await getEmailMessage({ message_id: 104 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.message.replyStatus).toBe("sent");
    expect(result.message.replyEvidence.replied).toBe(true);
    expect(result.message.replyEvidence.replyDetectedAt).toBeNull();
  });
});

describe("fetchUnreadEmails — summaries carry reply evidence (G02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    messageModuleStub.ensureConnection.mockResolvedValue(undefined);
    auditLogModuleStub.create.mockResolvedValue(undefined);
    syncServiceStub.syncUnread.mockResolvedValue({
      fetched: 2,
      stored: 2,
      messageIds: [201, 202],
    });
    messageModuleStub.listByEmailService.mockResolvedValue({
      records: [
        storedRow({
          id: 201,
          replyStatus: "not_started",
          replyDetectedAt: new Date("2026-10-04T00:00:00Z"),
          replyDetectionSource: "sent_search",
          isAnswered: 1,
          answeredFlagCheckedAt: new Date("2026-10-04T00:00:00Z"),
        }),
        storedRow({ id: 202, replyStatus: "not_started" }),
      ],
    });
  });

  it("returns one evidence object per message, projection-correct", async () => {
    const result = await fetchUnreadEmails({
      email_service_id: 10,
      limit: 10,
      unread_only: true,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.messages).toHaveLength(2);
    const [pos, legacy] = result.messages;
    expect(pos.replyEvidence.replied).toBe(true);
    expect(pos.replyEvidence.replyDetectionSource).toBe("sent_search");
    expect(legacy.replyEvidence.replied).toBeNull();
    expect(legacy.replyEvidence.answeredFlagObserved).toBe(false);
  });
});

describe("checkEmailReplied diagnostic DTO compatibility (G02)", () => {
  // G02 must not change the check_email_replied DTO shape. The evidence in
  // summaries is a separate, cheaper projection; the diagnostic tool still
  // returns the full three-state detection result.
  beforeEach(() => {
    vi.clearAllMocks();
    messageModuleStub.ensureConnection.mockResolvedValue(undefined);
    detectionModuleStub.ensureConnection.mockResolvedValue(undefined);
    aiEnabled = true;
  });

  it("unchanged DTO shape with state/reason_code/source/coverage", async () => {
    messageModuleStub.read.mockResolvedValue({ id: 301, emailServiceId: 1 });
    detectionModuleStub.checkReply.mockResolvedValue({
      success: true,
      result: {
        success: true,
        message_id: 301,
        state: "unknown",
        replied: null,
        source: "unavailable",
        reason_code: "receive_unavailable",
        matched_message_id: null,
        checked_at: "2026-10-05T00:00:00.000Z",
        from_cache: false,
        coverage: "partial",
      },
    });
    const result = await checkEmailReplied({ message_id: 301 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.state).toBe("unknown");
    expect(result.replied).toBeNull();
    expect(result.reason_code).toBe("receive_unavailable");
    expect(result.coverage).toBe("partial");
    // No replyEvidence field leaked into the diagnostic DTO.
    expect(result).not.toHaveProperty("replyEvidence");
  });
});

describe("sendEmailReply — approved-draft re-confirmation (CAS-fenced)", () => {
  function stubApprovedDraft(draftId: number): void {
    draftModuleStub.read.mockResolvedValue({
      id: draftId,
      messageId: 1,
      emailServiceId: 1,
      subject: "Re: Hi",
      bodyText: "Hello",
      bodyHtml: null,
      status: "approved",
      currentRevisionId: 7,
    });
  }

  beforeEach(() => {
    // No file-global clearAllMocks: reset every stub this suite touches so
    // call-history assertions see only the current test's calls.
    draftModuleStub.read.mockReset();
    approvalModuleStub.invalidateAllForDraft.mockReset();
    approvalModuleStub.invalidateAllForDraft.mockResolvedValue(1);
    draftModuleStub.demoteApprovedToDraft.mockReset();
    draftModuleStub.countActiveSendAttempts.mockReset();
    draftModuleStub.countActiveSendAttempts.mockResolvedValue(0);
    approvalStub.approveDraft.mockReset();
    approvalStub.approveDraft.mockResolvedValue({ token: "tok2" });
    deliveryStub.sendApprovedReply.mockReset();
    deliveryStub.sendApprovedReply.mockResolvedValue({
      status: "sent",
      attemptId: 8,
      sentAt: "2026-10-20T00:00:00.000Z",
    });
  });

  it("retires approvals in bulk, CAS-demotes approved->draft, re-approves, delivers", async () => {
    stubApprovedDraft(20);
    draftModuleStub.demoteApprovedToDraft.mockResolvedValue(true);
    const result = await sendEmailReply({ draft_id: 20, email_service_id: 1 });
    expect(result.success).toBe(true);
    expect(approvalModuleStub.invalidateAllForDraft).toHaveBeenCalledWith(
      20,
      expect.stringContaining("Re-confirmed send"),
      expect.any(Date)
    );
    expect(draftModuleStub.demoteApprovedToDraft).toHaveBeenCalledWith(20);
    expect(approvalStub.approveDraft).toHaveBeenCalledWith({
      draftId: 20,
      approvedByType: "tool_confirmation",
      approvedById: "ai_tool",
    });
  });

  it("refuses when a send is already in flight, leaving the row untouched", async () => {
    stubApprovedDraft(21);
    draftModuleStub.countActiveSendAttempts.mockResolvedValue(1);
    const result = await sendEmailReply({ draft_id: 21, email_service_id: 1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("already in flight");
    }
    expect(approvalModuleStub.invalidateAllForDraft).not.toHaveBeenCalled();
    expect(draftModuleStub.demoteApprovedToDraft).not.toHaveBeenCalled();
    expect(approvalStub.approveDraft).not.toHaveBeenCalled();
    expect(deliveryStub.sendApprovedReply).not.toHaveBeenCalled();
  });

  it("refuses when the CAS demotion loses the race (row moved concurrently)", async () => {
    stubApprovedDraft(22);
    draftModuleStub.demoteApprovedToDraft.mockResolvedValue(false);
    const result = await sendEmailReply({ draft_id: 22, email_service_id: 1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("state changed while re-confirming");
    }
    // The losing writer must NOT re-approve or deliver.
    expect(approvalStub.approveDraft).not.toHaveBeenCalled();
    expect(deliveryStub.sendApprovedReply).not.toHaveBeenCalled();
  });

  it.each(["sending", "sent", "discarded"] as const)(
    "refuses confirm_send for a '%s' draft without touching the row",
    async (status) => {
      draftModuleStub.read.mockResolvedValue({
        id: 30,
        messageId: 1,
        emailServiceId: 1,
        subject: "Re: Hi",
        bodyText: "Hello",
        bodyHtml: null,
        status,
      });
      const result = await sendEmailReply({ draft_id: 30, email_service_id: 1 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain(`Cannot send a draft in state '${status}'`);
      }
      expect(draftModuleStub.countActiveSendAttempts).not.toHaveBeenCalled();
      expect(draftModuleStub.demoteApprovedToDraft).not.toHaveBeenCalled();
      expect(approvalStub.approveDraft).not.toHaveBeenCalled();
      expect(deliveryStub.sendApprovedReply).not.toHaveBeenCalled();
    }
  );
});
