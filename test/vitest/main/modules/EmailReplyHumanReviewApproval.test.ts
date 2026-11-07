import { describe, it, expect, vi } from "vitest";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplyApprovalService } from "@/service/emailReply/EmailReplyApprovalService";
import { EmailReplyPolicyOrchestrator } from "@/service/emailReply/EmailReplyPolicyOrchestrator";
import { EmailReplyDraftGenerationService } from "@/service/emailReply/EmailReplyDraftGenerationService";
import { materializeRevision1 } from "@/service/emailReply/EmailReplyRevisionMaterializer";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import type { EmailMessageClassification } from "@/entityTypes/emailReceiveTypes";

// createDraft is AI-gated; pass the gate so reuse-guidance tests reach the
// service instead of short-circuiting on the enable check.
vi.mock("@/service/AiFeatureGate", () => ({
  ensureHostedAiEnabled: vi.fn(async () => true),
  isAiEnabled: vi.fn(() => true),
}));

/**
 * G02: the model's persisted `requiresHumanReview` flag gates approval until
 * an explicit revision-bound human resolution lifts it for the CURRENT
 * revision only.
 *
 * Uses the shared test DB (same pattern as EmailReplyApprovalReopen):
 * unique provider UIDs keep rows hermetic across runs.
 */
const CLEAN_BODY =
  "Thanks for reaching out. Could you share a little more detail about what you need?";

async function seedFlaggedDraft(): Promise<{
  draftId: number;
  revisionId: number;
  messageId: number;
}> {
  const messageModule = new EmailReceivedMessageModule();
  const draftModule = new EmailReplyDraftModule();

  const msg = new EmailReceivedMessageEntity();
  msg.emailServiceId = 7;
  msg.providerUid = `g02-hr-${Math.random()}`;
  msg.messageId = `<g02-hr-${Math.random()}@x>`;
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
  // Deterministic classification skips the model classifier, so reuse
  // guidance is exercised without any model call.
  msg.classification = "interested";
  msg.classificationConfidence = 0.9;
  msg.replyStatus = "not_started";
  msg.processedAt = null;
  const savedMsg = await messageModule.upsertByProviderUid(msg);

  const draft = new EmailReplyDraftEntity();
  draft.messageId = savedMsg.id;
  draft.emailServiceId = 7;
  draft.subject = "Re: Pricing";
  draft.bodyText = CLEAN_BODY;
  draft.bodyHtml = null;
  draft.status = "draft";
  draft.generationSource = "ai";
  // The model's review request + reasons (immutable provenance).
  draft.requiresHumanReview = 1;
  draft.reviewReasonsJson = JSON.stringify(["pricing needs a human check"]);
  draft.unresolvedQuestionsJson = JSON.stringify(["confirm discount?"]);
  const savedDraft = await draftModule.create(draft);

  const rev = await materializeRevision1(draftModule, {
    draftId: savedDraft.id,
    actor: "ai",
    subject: "Re: Pricing",
    bodyText: CLEAN_BODY,
    bodyHtml: null,
    senderAddress: "owner@svc.com",
    recipientAddress: "prospect@example.com",
    emailServiceId: 7,
    originalMessageId: savedMsg.id,
  });
  return {
    draftId: savedDraft.id,
    revisionId: rev.revisionId,
    messageId: savedMsg.id,
  };
}

describe("G02 human-review gate on approval", () => {
  it("refuses approval while the model review flag is unresolved", async () => {
    const { draftId } = await seedFlaggedDraft();
    await expect(
      new EmailReplyApprovalService().approveDraft({
        draftId,
        approvedByType: "user",
      })
    ).rejects.toThrow(/human review/);
  });

  it("explicit resolution for the current revision unlocks approval; the model reasons stay immutable", async () => {
    const { draftId, revisionId } = await seedFlaggedDraft();
    const draftModule = new EmailReplyDraftModule();

    const resolved = await draftModule.resolveHumanReview({
      draftId,
      revisionId,
      resolvedBy: "user:e2e-op",
      note: "checked pricing against the sheet",
    });
    expect(resolved.resolved).toBe(true);

    const approval = await new EmailReplyApprovalService().approveDraft({
      draftId,
      approvedByType: "user",
    });
    expect(approval.token).toBeTruthy();
    expect(approval.revisionId).toBe(revisionId);

    // The model's original request is preserved as provenance, not cleared.
    const after = await draftModule.readAggregate(draftId);
    expect(after?.requiresHumanReview).toBe(1);
    expect(after?.reviewReasonsJson).toContain("pricing needs a human check");
    expect(after?.humanReviewResolvedRevisionId).toBe(revisionId);
  });

  it("a later edit invalidates the resolution — approval blocks again until re-review", async () => {
    const { draftId, revisionId } = await seedFlaggedDraft();
    const draftModule = new EmailReplyDraftModule();
    await draftModule.resolveHumanReview({
      draftId,
      revisionId,
      resolvedBy: "user:e2e-op",
    });
    // User edits the draft: new revision, resolution stamp cleared.
    await draftModule.appendRevision({
      draftId,
      actor: "user",
      subject: "Re: Pricing (edited)",
      bodyText: `${CLEAN_BODY} Edited.`,
      bodyHtml: null,
      senderAddress: "owner@svc.com",
      recipientAddress: "prospect@example.com",
      contentHash: `edited-${Math.random()}`,
    });
    await expect(
      new EmailReplyApprovalService().approveDraft({
        draftId,
        approvedByType: "user",
      })
    ).rejects.toThrow(/human review/);
  });

  it("a stale resolution (wrong revision) is refused and does not unlock approval", async () => {
    const { draftId, revisionId } = await seedFlaggedDraft();
    const draftModule = new EmailReplyDraftModule();
    const stale = await draftModule.resolveHumanReview({
      draftId,
      revisionId: revisionId + 999999,
      resolvedBy: "user:e2e-op",
    });
    expect(stale.resolved).toBe(false);
    await expect(
      new EmailReplyApprovalService().approveDraft({
        draftId,
        approvedByType: "user",
      })
    ).rejects.toThrow(/human review/);
  });
});

/**
 * Reviewed flag (spec docs/superpowers/specs/2026-10-29-email-reply-reviewed-flag-design.md):
 * confirmed-send proof. `classificationForConfirmedSend` strips a stored
 * `needs_human_review` (a confirmed send IS the human review completing), so
 * approval resolves and the pre-send gate allows. Bounce still refuses both:
 * machine-safety blocks are never overridable by a human gesture.
 */
describe("reviewed flag — confirmed-send accepts needs_human_review", () => {
  async function seedConfirmedSendDraft(
    classification: EmailMessageClassification,
    classificationConfidence: number
  ): Promise<{
    draftId: number;
    revisionId: number;
    messageId: number;
  }> {
    const messageModule = new EmailReceivedMessageModule();
    const draftModule = new EmailReplyDraftModule();

    const msg = new EmailReceivedMessageEntity();
    msg.emailServiceId = 7;
    msg.providerUid = `reviewed-send-${Math.random()}`;
    msg.messageId = `<reviewed-send-${Math.random()}@x>`;
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
    msg.classificationConfidence = classificationConfidence;
    msg.replyStatus = "not_started";
    msg.processedAt = null;
    const savedMsg = await messageModule.upsertByProviderUid(msg);
    await messageModule.updateClassificationProvenance(
      savedMsg.id,
      classification === "needs_human_review" ? "review" : "deterministic",
      classification === "needs_human_review"
        ? "model-constrained-v1"
        : "deterministic-v1"
    );

    const draft = new EmailReplyDraftEntity();
    draft.messageId = savedMsg.id;
    draft.emailServiceId = 7;
    draft.subject = "Re: Pricing";
    draft.bodyText = CLEAN_BODY;
    draft.bodyHtml = null;
    draft.status = "draft";
    draft.generationSource = "ai";
    const savedDraft = await draftModule.create(draft);

    const rev = await materializeRevision1(draftModule, {
      draftId: savedDraft.id,
      actor: "ai",
      subject: "Re: Pricing",
      bodyText: CLEAN_BODY,
      bodyHtml: null,
      senderAddress: "owner@svc.com",
      recipientAddress: "prospect@example.com",
      emailServiceId: 7,
      originalMessageId: savedMsg.id,
    });
    return {
      draftId: savedDraft.id,
      revisionId: rev.revisionId,
      messageId: savedMsg.id,
    };
  }

  it("approval resolves for a needs_human_review-classified message (human gesture)", async () => {
    const { draftId } = await seedConfirmedSendDraft(
      "needs_human_review",
      0.8
    );
    const approval = await new EmailReplyApprovalService().approveDraft({
      draftId,
      approvedByType: "user",
    });
    expect(approval.token).toBeTruthy();
  });

  it("pre-send policy allows the confirmed needs_human_review draft", async () => {
    const { draftId, messageId, revisionId } =
      await seedConfirmedSendDraft("needs_human_review", 0.8);
    await new EmailReplyApprovalService().approveDraft({
      draftId,
      approvedByType: "user",
    });
    const decision = await new EmailReplyPolicyOrchestrator().evaluate({
      stage: "pre_send",
      messageId,
      draftId,
      revisionId,
    });
    expect(decision.allowed).toBe(true);
  });

  it("approval still rejects a bounce-classified message even with the human gesture", async () => {
    const { draftId } = await seedConfirmedSendDraft("bounce", 0.97);
    await expect(
      new EmailReplyApprovalService().approveDraft({
        draftId,
        approvedByType: "user",
      })
    ).rejects.toThrow(/Cannot approve/i);
  });

  it("pre-send policy still refuses a bounce-classified message", async () => {
    const { draftId, messageId, revisionId } =
      await seedConfirmedSendDraft("bounce", 0.97);
    await expect(
      new EmailReplyApprovalService().approveDraft({
        draftId,
        approvedByType: "user",
      })
    ).rejects.toThrow(/Cannot approve/i);
    const decision = await new EmailReplyPolicyOrchestrator().evaluate({
      stage: "pre_send",
      messageId,
      draftId,
      revisionId,
    });
    expect(decision.allowed).toBe(false);
    // The unapproved draft is refused at the approval-bound state machine
    // (draft_not_approved) — the bounce classification hard block only ever
    // fires for an APPROVED draft. Either way the send is refused.
    expect(decision.code).toBe("draft_not_approved");
  });
});

function reuseGuidanceService(): EmailReplyDraftGenerationService {
  return new EmailReplyDraftGenerationService();
}

describe("F09 effective review status in reuse guidance", () => {
  it("flagged → reuse routes to human review but keeps model provenance", async () => {
    const { draftId, messageId } = await seedFlaggedDraft();
    const result = await reuseGuidanceService().createDraft({ messageId });
    expect(result.success).toBe(true);
    if (!result.success) return;
    // The AI-tool and renderer DTO consumers read these same fields.
    expect(result.reused).toBe(true);
    expect(result.draftId).toBe(draftId);
    expect(result.requiresHumanReview).toBe(true);
    expect(result.humanReviewPending).toBe(true);
    expect(result.next_action).toBe("await_human_review");
  });

  it("resolved current revision → reuse approves guidance while provenance stays true", async () => {
    const { draftId, revisionId, messageId } = await seedFlaggedDraft();
    const draftModule = new EmailReplyDraftModule();
    expect(
      (
        await draftModule.resolveHumanReview({
          draftId,
          revisionId,
          resolvedBy: "user:op",
        })
      ).resolved
    ).toBe(true);
    const result = await reuseGuidanceService().createDraft({ messageId });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.reused).toBe(true);
    // Original model provenance is retained...
    expect(result.requiresHumanReview).toBe(true);
    // ...but effective guidance follows the resolution: approval allowed.
    expect(result.humanReviewPending).toBe(false);
    expect(result.next_action).toBe("approve_existing_draft");
  });

  it("edit after resolution → reuse requires review again", async () => {
    const { draftId, revisionId, messageId } = await seedFlaggedDraft();
    const draftModule = new EmailReplyDraftModule();
    await draftModule.resolveHumanReview({
      draftId,
      revisionId,
      resolvedBy: "user:op",
    });
    await draftModule.appendRevision({
      draftId,
      actor: "user",
      subject: "Re: Pricing (edited)",
      bodyText: `${CLEAN_BODY} Edited.`,
      bodyHtml: null,
      senderAddress: "owner@svc.com",
      recipientAddress: "prospect@example.com",
      contentHash: `edited-${Math.random()}`,
    });
    const result = await reuseGuidanceService().createDraft({ messageId });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.requiresHumanReview).toBe(true);
    expect(result.humanReviewPending).toBe(true);
    expect(result.next_action).toBe("await_human_review");
  });
});
