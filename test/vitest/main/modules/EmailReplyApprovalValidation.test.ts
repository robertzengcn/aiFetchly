import { describe, it, expect } from "vitest";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplyApprovalService } from "@/service/emailReply/EmailReplyApprovalService";
import { materializeRevision1 } from "@/service/emailReply/EmailReplyRevisionMaterializer";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";

/**
 * P0.4: a revision whose content trips a block/review finding must not reach
 * `approved`. The approval service recomputes validation from the trusted
 * revision body and throws before writing an approval or transitioning state.
 */
describe("P0.4 — approval blocked by validation findings", () => {
  const draftModule = new EmailReplyDraftModule();
  const approvalService = new EmailReplyApprovalService();

  async function seedDraftWithBody(bodyText: string): Promise<number> {
    const draft = new EmailReplyDraftEntity();
    draft.messageId = 999999; // never reached: validation throws before message load
    draft.emailServiceId = 7;
    draft.subject = "Re: Pricing";
    draft.bodyText = bodyText;
    draft.bodyHtml = null;
    draft.status = "draft";
    draft.generationSource = "ai";
    const saved = await draftModule.create(draft);
    await materializeRevision1(draftModule, {
      draftId: saved.id,
      actor: "ai",
      subject: "Re: Pricing",
      bodyText,
      bodyHtml: null,
      senderAddress: "owner@svc.com",
      recipientAddress: "prospect@example.com",
      emailServiceId: 7,
      originalMessageId: 999999,
    });
    return saved.id;
  }

  it("refuses approval when the body leaks AI self-disclosure (block)", async () => {
    const draftId = await seedDraftWithBody(
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

  it("refuses approval when the body offers a refund (review)", async () => {
    const draftId = await seedDraftWithBody(
      "We can issue a full refund right away if you'd like."
    );
    await expect(
      approvalService.approveDraft({
        draftId,
        approvedByType: "user",
      })
    ).rejects.toThrow(/validation findings/);
  });

  it("refuses approval when the body introduces a new URL (review)", async () => {
    const draftId = await seedDraftWithBody(
      "Please complete payment at https://pay.example.com/x"
    );
    await expect(
      approvalService.approveDraft({
        draftId,
        approvedByType: "user",
      })
    ).rejects.toThrow(/validation findings/);
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

