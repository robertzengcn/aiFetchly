import { describe, it, expect, vi } from "vitest";

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
    draftGenStub.createDraft.mockResolvedValue({
      success: false,
      error:
        "[already_replied] Message already has a sent reply; refusing duplicate",
      code: "already_replied",
      next_action: "no_action",
      requestCorrelationId: "erx-req-abc-1",
    });
    const result = await createEmailReplyDraft({ message_id: 1 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("already_replied");
    // already_replied means the duplicate guard did its job — nothing for the
    // model to do (no second reply), and nothing needs human review.
    expect(result.next_action).toBe("no_action");
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
    // The duplicate guard refused before SMTP — no action, nothing to review.
    expect(result.next_action).toBe("no_action");
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
    expect(result.next_action).toBe("no_action");
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
});
