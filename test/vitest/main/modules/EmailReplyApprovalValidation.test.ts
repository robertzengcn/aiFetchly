import { describe, it, expect } from "vitest";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplyDraftRevisionModule } from "@/modules/EmailReplyDraftRevisionModule";
import { EmailReplyApprovalService } from "@/service/emailReply/EmailReplyApprovalService";
import { EmailReplyPolicyOrchestrator } from "@/service/emailReply/EmailReplyPolicyOrchestrator";
import { materializeRevision1 } from "@/service/emailReply/EmailReplyRevisionMaterializer";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";

/**
 * P0.4: a revision whose content trips a `block` finding must not reach
 * `approved`. The approval service recomputes validation from the trusted
 * revision body and throws before writing an approval or transitioning state.
 *
 * 2026-10-18 policy change: advisory findings (commitments, payment
 * instructions, recipients, attachment claims) are non-blocking warnings —
 * they persist for audit and approval succeeds. The send tool's
 * `requiresConfirmation` gesture is the human gate for advisory content, and
 * the persisted model review flag (R21) still gates separately.
 */
describe("P0.4 — approval blocked by validation findings", () => {
  const draftModule = new EmailReplyDraftModule();
  const approvalService = new EmailReplyApprovalService();

  async function seedDraftWithBody(
    bodyText: string,
    classification: "interested" | "unknown" = "interested",
    emailServiceId = 7
  ): Promise<{
    draftId: number;
    messageId: number;
    revisionId: number;
  }> {
    // Approval proceeds past validation to message load + policy gates, so a
    // real inbound message row is required (kept innocuous — the auto-reply
    // policy scans the INBOUND message, not the draft).
    const messageModule = new EmailReceivedMessageModule();
    const msg = new EmailReceivedMessageEntity();
    msg.emailServiceId = emailServiceId;
    msg.providerUid = `p04-${Math.random()}`;
    msg.messageId = `<p04-${Math.random()}@x>`;
    msg.threadKey = msg.messageId;
    msg.fromAddress = "prospect@example.com";
    msg.fromName = "Prospect";
    msg.replyToAddress = null;
    msg.toAddressesJson = JSON.stringify(["owner@svc.com"]);
    msg.ccAddressesJson = null;
    msg.subject = "Pricing";
    msg.bodyText = "Hi";
    msg.bodyHtmlSanitized = null;
    msg.snippet = null;
    msg.receivedAt = new Date();
    msg.isUnread = 1;
    msg.classification = classification;
    msg.classificationConfidence = 0.9;
    msg.replyStatus = "not_started";
    msg.processedAt = null;
    const savedMsg = await messageModule.upsertByProviderUid(msg);

    const draft = new EmailReplyDraftEntity();
    draft.messageId = savedMsg.id;
    draft.emailServiceId = emailServiceId;
    draft.subject = "Re: Pricing";
    draft.bodyText = bodyText;
    draft.bodyHtml = null;
    draft.status = "draft";
    draft.generationSource = "ai";
    const saved = await draftModule.create(draft);
    const rev = await materializeRevision1(draftModule, {
      draftId: saved.id,
      actor: "ai",
      subject: "Re: Pricing",
      bodyText,
      bodyHtml: null,
      senderAddress: "owner@svc.com",
      recipientAddress: "prospect@example.com",
      emailServiceId,
      originalMessageId: savedMsg.id,
    });
    return {
      draftId: saved.id,
      messageId: savedMsg.id,
      revisionId: rev.revisionId,
    };
  }

  it("refuses approval when the body leaks AI self-disclosure (block)", async () => {
    const { draftId } = await seedDraftWithBody(
      "As an AI language model, here is the answer."
    );
    await expect(
      approvalService.approveDraft({
        draftId,
        approvedByType: "user",
      })
    ).rejects.toThrow(/validation findings/);
    // The draft must remain unapproved.
    const draft = await draftModule.readAggregate(draftId);
    expect(draft?.status).toBe("draft");
  });

  it("refuses a block finding even via the AI tool's tool_confirmation path", async () => {
    const { draftId } = await seedDraftWithBody(
      "As an AI language model, here is the answer."
    );
    await expect(
      approvalService.approveDraft({
        draftId,
        approvedByType: "tool_confirmation",
        approvedById: "ai_tool",
      })
    ).rejects.toThrow(/validation findings/);
  });

  it("approves a refund body and persists the finding as an audit warning", async () => {
    const { draftId, revisionId } = await seedDraftWithBody(
      "We can issue a full refund right away if you'd like."
    );
    await approvalService.approveDraft({
      draftId,
      approvedByType: "user",
    });
    const draft = await draftModule.readAggregate(draftId);
    expect(draft?.status).toBe("approved");
    const revision = await new EmailReplyDraftRevisionModule().read(revisionId);
    const persisted = JSON.parse(
      (revision?.validationFindingsJson ?? "{}") as string
    ) as {
      findings: { code: string; severity: string }[];
      sendableAfterApproval: boolean;
    };
    expect(
      persisted.findings.some(
        (f) =>
          f.code === "commitment_refund" && f.severity === "warning"
      )
    ).toBe(true);
    expect(persisted.sendableAfterApproval).toBe(true);
  });

  it("approves a body introducing a new URL (user's reported repro shape)", async () => {
    const { draftId, revisionId } = await seedDraftWithBody(
      "Please complete payment at https://pay.example.com/x"
    );
    await approvalService.approveDraft({
      draftId,
      approvedByType: "tool_confirmation",
      approvedById: "ai_tool",
    });
    const draft = await draftModule.readAggregate(draftId);
    expect(draft?.status).toBe("approved");
    const revision = await new EmailReplyDraftRevisionModule().read(revisionId);
    const persisted = JSON.parse(
      (revision?.validationFindingsJson ?? "{}") as string
    ) as { findings: { code: string }[] };
    expect(persisted.findings.some((f) => f.code === "new_url")).toBe(false);
  });

  it("approves and allows pre-send when classification is unknown and the body has a URL", async () => {
    const { draftId, messageId } = await seedDraftWithBody(
      "Proxy setup is documented at https://docs.aifetchly.com/docs/lead-generation/proxy-setup",
      "unknown",
      88019
    );
    await approvalService.approveDraft({
      draftId,
      approvedByType: "tool_confirmation",
      approvedById: "ai_tool",
    });
    const draft = await draftModule.readAggregate(draftId);
    expect(draft?.status).toBe("approved");
    const decision = await new EmailReplyPolicyOrchestrator().evaluate({
      stage: "pre_send",
      messageId,
      draftId,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.code).not.toBe("classification_unknown");
  });
});

/**
 * R21 + the 2026-10-18 demotion: advisory findings no longer block, but the
 * model's OPTIONAL `requiresHumanReview` signal still gates approval exactly
 * as before — a flagged draft cannot be approved as clean even when its only
 * findings are non-blocking warnings. The flag can only make review STRICTER.
 */
describe("R21 — approval blocked by the persisted model review flag", () => {
  const draftModule = new EmailReplyDraftModule();
  const approvalService = new EmailReplyApprovalService();

  async function seedFlaggedDraft(): Promise<number> {
    const messageModule = new EmailReceivedMessageModule();
    const msg = new EmailReceivedMessageEntity();
    msg.emailServiceId = 7;
    msg.providerUid = `p04-hr-${Math.random()}`;
    msg.messageId = `<p04-hr-${Math.random()}@x>`;
    msg.threadKey = msg.messageId;
    msg.fromAddress = "prospect@example.com";
    msg.fromName = "Prospect";
    msg.replyToAddress = null;
    msg.toAddressesJson = JSON.stringify(["owner@svc.com"]);
    msg.ccAddressesJson = null;
    msg.subject = "Pricing";
    msg.bodyText = "Hi";
    msg.bodyHtmlSanitized = null;
    msg.snippet = null;
    msg.receivedAt = new Date();
    msg.isUnread = 1;
    msg.classification = "interested";
    msg.classificationConfidence = 0.9;
    msg.replyStatus = "not_started";
    msg.processedAt = null;
    const savedMsg = await messageModule.upsertByProviderUid(msg);

    const draft = new EmailReplyDraftEntity();
    draft.messageId = savedMsg.id;
    draft.emailServiceId = 7;
    draft.subject = "Re: Pricing";
    // Advisory content only — proves the R21 gate fires on its own.
    draft.bodyText =
      "We can issue a full refund right away if you'd like. See https://example.com/pricing.";
    draft.bodyHtml = null;
    draft.status = "draft";
    draft.generationSource = "ai";
    // The generation service persists the model's review request (1) with
    // its bounded reason/question JSON.
    draft.requiresHumanReview = 1;
    draft.reviewReasonsJson = JSON.stringify([
      "Customer asked for an exception the owner should decide on",
    ]);
    draft.unresolvedQuestionsJson = JSON.stringify([
      "Which plan does the customer currently hold?",
    ]);
    const saved = await draftModule.create(draft);
    await materializeRevision1(draftModule, {
      draftId: saved.id,
      actor: "ai",
      subject: "Re: Pricing",
      bodyText: draft.bodyText,
      bodyHtml: null,
      senderAddress: "owner@svc.com",
      recipientAddress: "prospect@example.com",
      emailServiceId: 7,
      originalMessageId: savedMsg.id,
    });
    return saved.id;
  }

  it("refuses approval for a body the model flagged as requiring human review", async () => {
    const draftId = await seedFlaggedDraft();
    await expect(
      approvalService.approveDraft({
        draftId,
        approvedByType: "user",
      })
    ).rejects.toThrow(/requiring human review/);
    // The draft must remain unapproved.
    const draft = await draftModule.readAggregate(draftId);
    expect(draft?.status).toBe("draft");
  });
});

/**
 * R21: the model's OPTIONAL `requiresHumanReview` signal is persisted on the
 * draft at generation time. The approval service must treat a flagged draft
 * exactly like a deterministic review finding — approval refuses, no approval
 * row is written, and the draft stays in `draft`. The flag can only make
 * review STRICTER (an unflagged body with a clean revision still approves
 * normally).
 */
describe("R21 — approval blocked by the persisted model review flag", () => {
  const draftModule = new EmailReplyDraftModule();
  const approvalService = new EmailReplyApprovalService();

  async function seedFlaggedDraft(): Promise<number> {
    const draft = new EmailReplyDraftEntity();
    draft.messageId = 999999; // never reached: the flag gate throws before message load
    draft.emailServiceId = 7;
    draft.subject = "Re: Pricing";
    draft.bodyText = "A perfectly clean, sendable body with no findings.";
    draft.bodyHtml = null;
    draft.status = "draft";
    draft.generationSource = "ai";
    // The generation service persists the model's review request (1) with
    // its bounded reason/question JSON.
    draft.requiresHumanReview = 1;
    draft.reviewReasonsJson = JSON.stringify([
      "Customer asked for an exception the owner should decide on",
    ]);
    draft.unresolvedQuestionsJson = JSON.stringify([
      "Which plan does the customer currently hold?",
    ]);
    const saved = await draftModule.create(draft);
    await materializeRevision1(draftModule, {
      draftId: saved.id,
      actor: "ai",
      subject: "Re: Pricing",
      bodyText: draft.bodyText,
      bodyHtml: null,
      senderAddress: "owner@svc.com",
      recipientAddress: "prospect@example.com",
      emailServiceId: 7,
      originalMessageId: 999999,
    });
    return saved.id;
  }

  it("refuses approval for a body the model flagged as requiring human review", async () => {
    const draftId = await seedFlaggedDraft();
    await expect(
      approvalService.approveDraft({
        draftId,
        approvedByType: "user",
      })
    ).rejects.toThrow(/requiring human review/);
    // The draft must remain unapproved.
    const draft = await draftModule.readAggregate(draftId);
    expect(draft?.status).toBe("draft");
  });
});

