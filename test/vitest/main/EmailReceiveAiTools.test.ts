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
const draftModuleStub = { ensureConnection: vi.fn(), read: vi.fn() };

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
};
// AI-enable gate (FR-6.1): default true so happy-path tests proceed; the
// disabled-AI test flips this to false.
let aiEnabled = true;

vi.mock("@/service/emailReply/EmailReplyDraftGenerationService", () => ({
  EmailReplyDraftGenerationService: function () {
    return draftGenStub;
  },
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
} from "@/service/EmailReceiveAiTools";
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
