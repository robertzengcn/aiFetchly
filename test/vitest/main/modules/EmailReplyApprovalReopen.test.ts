import { describe, it, expect, vi, afterEach } from "vitest";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplyApprovalModule } from "@/modules/EmailReplyApprovalModule";
import { EmailReplySendAttemptModule } from "@/modules/EmailReplySendAttemptModule";
import { EmailReplyAuditLogModule } from "@/modules/EmailReplyAuditLogModule";
import { EmailAutoReplyRuleModule } from "@/modules/EmailAutoReplyRuleModule";
import { EmailReplyApprovalService } from "@/service/emailReply/EmailReplyApprovalService";
import { EmailReplyDeliveryService } from "@/service/emailReply/EmailReplyDeliveryService";
import { materializeRevision1 } from "@/service/emailReply/EmailReplyRevisionMaterializer";
import { EmailReplyDetectionService } from "@/service/emailReceive/EmailReplyDetectionService";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";
import { EmailReplyAuditLogEntity } from "@/entity/EmailReplyAuditLog.entity";
import { EmailAutoReplyRuleEntity } from "@/entity/EmailAutoReplyRule.entity";
import type { EmailSendResult } from "@/entityTypes/emailmarketingType";
import type { ReplyDetectionResult } from "@/service/emailReceive/EmailReplyDetectionTypes";

/**
 * R13: a definite SMTP rejection finalizes the draft as `failed`. The
 * generation reuse path (B08) hands the failed draft back with
 * `existing_draft_id`, telling the operator/AI to re-approve — but nothing
 * could approve/send it: `approveDraft` threw on `status !== "draft"`, the
 * conditional `markApproved` UPDATE required `status='draft'`, and the
 * `sendEmailReply` tool refused non-draft before reaching approval.
 *
 * The fix adds a fenced `failed -> draft` reopen inside the approval path:
 * the reopen refuses on any cluster positive, any unknown/sent/in-flight
 * sibling, and is conditional on `status='failed' + currentRevisionId`. After
 * the reopen the SAME normal approval path runs (fresh token, unchanged
 * revisionId/contentHash, `markApproved` conditional now satisfied). Ambiguous
 * (`delivery_unknown`), sent, and in-flight states stay blocked.
 */
const CLEAN_BODY =
  "Thanks for reaching out. Could you share a little more detail about what you need?";

const FAKE_MAILBOX = {
  id: 7,
  from: "owner@svc.com",
  status: 1,
  password: "pw",
  host: "smtp.example.com",
  port: "587",
  name: "Owner",
  ssl: 1,
};

const NOT_REPLIED_DETECTION: ReplyDetectionResult = {
  state: "not_replied",
  replied: false,
  source: "sent_search",
  matchedMessageId: null,
  reasonCode: "no_reply_observed",
  checkedAt: new Date().toISOString(),
  fromCache: false,
  coverage: "configured_imap",
};

const REPLIED_DETECTION: ReplyDetectionResult = {
  state: "replied",
  replied: true,
  source: "mailbox_flag",
  matchedMessageId: "<existing@reply>",
  reasonCode: "already_replied",
  checkedAt: new Date().toISOString(),
  fromCache: false,
  coverage: "configured_imap",
};

function detectionFactory(
  result: ReplyDetectionResult = NOT_REPLIED_DETECTION
): () => EmailReplyDetectionService {
  return () => {
    const svc = new EmailReplyDetectionService();
    vi.spyOn(svc, "detect").mockImplementation(async (input) => {
      if (result.state === "not_replied") {
        await new EmailReceivedMessageModule().updateReplyEvidence({
          id: input.messageId,
          replyNegativeCheckAt: new Date(),
          replyNegativeContextHash: "test-context-hash",
          isAnswered: 0,
          answeredFlagCheckedAt: new Date(),
        });
      }
      return result;
    });
    return svc;
  };
}

async function seedApprovedDraft(): Promise<{
  draftId: number;
  token: string;
  approvalId: number;
  messageId: number;
  revisionId: number;
}> {
  const messageModule = new EmailReceivedMessageModule();
  const draftModule = new EmailReplyDraftModule();

  const msg = new EmailReceivedMessageEntity();
  msg.emailServiceId = FAKE_MAILBOX.id;
  msg.providerUid = `pu-${Math.random()}`;
  msg.messageId = `<m-${Math.random()}@x>`;
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
  msg.classification = null;
  msg.classificationConfidence = null;
  msg.replyStatus = "not_started";
  msg.processedAt = null;
  const savedMsg = await messageModule.upsertByProviderUid(msg);

  const draft = new EmailReplyDraftEntity();
  draft.messageId = savedMsg.id;
  draft.emailServiceId = FAKE_MAILBOX.id;
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
    emailServiceId: FAKE_MAILBOX.id,
    originalMessageId: savedMsg.id,
  });

  const approval = await new EmailReplyApprovalService().approveDraft({
    draftId: savedDraft.id,
    approvedByType: "user",
  });
  return {
    draftId: savedDraft.id,
    token: approval.token,
    approvalId: approval.approvalId,
    messageId: savedMsg.id,
    revisionId: rev.revisionId,
  };
}

function buildDelivery(behavior: "accept" | "reject"): EmailReplyDeliveryService {
  let calls = 0;
  const senderFactory = () => ({
    sendReplyEmail: async (): Promise<EmailSendResult> => {
      calls += 1;
      if (behavior === "accept") {
        return {
          receiver: "prospect@example.com",
          status: true,
          title: "Re: Pricing",
          content: CLEAN_BODY,
          info: `<prov-${calls}@x>`,
        };
      }
      return {
        receiver: "prospect@example.com",
        status: false,
        title: "Re: Pricing",
        content: CLEAN_BODY,
        info: "Recipient address rejected: User unknown",
      };
    },
  });
  return new EmailReplyDeliveryService({
    senderFactory: senderFactory as never,
    serviceLoader: async () => FAKE_MAILBOX,
    detectionServiceFactory: detectionFactory(),
  });
}

/**
 * Seed an enabled rule for the per-thread-limit test. Rule rows persist in
 * the shared test DB (no delete API; the V01 isolation fix is a separate
 * task), so this must be hermetic against accumulated rows from other runs:
 * `dailySendLimit` is set very high so prior sent attempts for service 7
 * never trip the daily check — this test targets ONLY the per-thread proxy
 * (`countAttemptsForMessage`), which counts by messageId.
 */
async function seedEnabledRule(
  emailServiceId: number,
  perThreadReplyLimit = 1
): Promise<number> {
  const ruleModule = new EmailAutoReplyRuleModule();
  const rule = new EmailAutoReplyRuleEntity();
  rule.emailServiceId = emailServiceId;
  rule.name = "R13 test rule";
  rule.enabled = 1;
  rule.allowedClassificationsJson = "[]";
  rule.blockedSenderPatternsJson = null;
  rule.blockedDomainPatternsJson = null;
  rule.dailySendLimit = 1_000_000;
  rule.perThreadReplyLimit = perThreadReplyLimit;
  rule.confidenceThreshold = 0;
  rule.quietHoursJson = null;
  rule.requireApprovalBelowThreshold = 0;
  const saved = await ruleModule.create(rule);
  return saved.id;
}

async function forceFailed(
  draftId: number,
  token: string
): Promise<void> {
  const outcome = await buildDelivery("reject").sendApprovedReply({
    draftId,
    approvalToken: token,
  });
  if (outcome.status !== "failed") {
    throw new Error(`expected failed, got ${outcome.status}`);
  }
  const draft = await new EmailReplyDraftModule().readAggregate(draftId);
  if (draft?.status !== "failed") {
    throw new Error(`expected draft failed, got ${draft?.status}`);
  }
}

describe("R13 — fenced failed-draft reopen for explicit retry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reject definitely, reuse same ID, explicitly approve + retry succeeds without a sibling", async () => {
    const { draftId, token, approvalId, messageId, revisionId } =
      await seedApprovedDraft();
    await forceFailed(draftId, token);

    // The draft is now `failed`. The reuse path would hand this ID back to
    // the operator/AI. Re-approving must reopen it and mint a fresh token,
    // keeping the SAME revisionId + contentHash (unchanged content).
    const reapproval = await new EmailReplyApprovalService().approveDraft({
      draftId,
      approvedByType: "user",
    });
    expect(reapproval.revisionId).toBe(revisionId);
    // A fresh approval row (new id) yields a fresh idempotency key, so the
    // retry attempt INSERT cannot collide with the failed attempt. The
    // failed-finalize path consumes the original approval (invalidates it),
    // so `findActiveByDraft` resolves to the fresh approval, not the seed.
    const approvalModule = new EmailReplyApprovalModule();
    const active = await approvalModule.findActiveByDraft(draftId, revisionId);
    expect(active).not.toBeNull();
    expect(active?.id).toBe(reapproval.approvalId);
    expect(active?.id).not.toBe(approvalId);

    // Retry with an accepting transport → sent. No sibling draft is created:
    // still exactly one draft row.
    const outcome = await buildDelivery("accept").sendApprovedReply({
      draftId,
      approvalToken: reapproval.token,
    });
    expect(outcome.status).toBe("sent");

    const draftModule = new EmailReplyDraftModule();
    const draft = await draftModule.readAggregate(draftId);
    expect(draft?.status).toBe("sent");
    const draftsForMessage = await draftModule.listByMessage(messageId);
    expect(draftsForMessage.length).toBe(1);
  });

  it("delivery_unknown draft is NOT reopened (ambiguous stays blocked)", async () => {
    const { draftId, token } = await seedApprovedDraft();
    // Park the draft in `delivery_unknown` (terminal ambiguous) directly via
    // the model's finalize path is heavier; use the disconnect delivery.
    const outcome = await buildDelivery("reject").sendApprovedReply({
      draftId,
      approvalToken: token,
    });
    // (reject → failed here; we flip the draft to delivery_unknown by hand to
    //  exercise the ambiguous-state refusal without a real disconnect harness.)
    void outcome;
    const draftModule = new EmailReplyDraftModule();
    await draftModule.updateStatus(draftId, "delivery_unknown");

    await expect(
      new EmailReplyApprovalService().approveDraft({
        draftId,
        approvedByType: "user",
      })
    ).rejects.toThrow(/draft/i);
    const after = await draftModule.readAggregate(draftId);
    expect(after?.status).toBe("delivery_unknown");
  });

  it("cluster positive refuses the reopen (draft stays failed)", async () => {
    const { draftId, token, messageId } = await seedApprovedDraft();
    await forceFailed(draftId, token);

    // Mark the message as replied (cluster positive) — simulating a sibling
    // row or a sticky mailbox positive discovered after the failure.
    await new EmailReceivedMessageModule().updateReplyEvidence({
      id: messageId,
      replyDetectedAt: new Date(),
      replyDetectionSource: "mailbox_flag",
      replyMatchedMessageId: "<sibling@reply>",
    });

    await expect(
      new EmailReplyApprovalService().approveDraft({
        draftId,
        approvedByType: "user",
      })
    ).rejects.toThrow(/reply|cluster|sent/i);
    const after = await new EmailReplyDraftModule().readAggregate(draftId);
    expect(after?.status).toBe("failed");
  });

  it("sent sibling draft refuses the reopen", async () => {
    const { draftId, token, messageId } = await seedApprovedDraft();
    await forceFailed(draftId, token);

    // Seed a sibling sent draft on the same message.
    const draftModule = new EmailReplyDraftModule();
    const sibling = new EmailReplyDraftEntity();
    sibling.messageId = messageId;
    sibling.emailServiceId = FAKE_MAILBOX.id;
    sibling.subject = "Re: Pricing";
    sibling.bodyText = CLEAN_BODY;
    sibling.bodyHtml = null;
    sibling.status = "sent";
    sibling.generationSource = "ai";
    await draftModule.create(sibling);

    await expect(
      new EmailReplyApprovalService().approveDraft({
        draftId,
        approvedByType: "user",
      })
    ).rejects.toThrow(/reply|cluster|sent/i);
    const after = await draftModule.readAggregate(draftId);
    expect(after?.status).toBe("failed");
  });

  it("in-flight sibling attempt refuses the reopen", async () => {
    const { draftId, token, messageId, revisionId } = await seedApprovedDraft();
    await forceFailed(draftId, token);

    // Seed an in-flight (claimed) sibling attempt on a different draft.
    const draftModule = new EmailReplyDraftModule();
    const sibling = new EmailReplyDraftEntity();
    sibling.messageId = messageId;
    sibling.emailServiceId = FAKE_MAILBOX.id;
    sibling.subject = "Re: Pricing";
    sibling.bodyText = CLEAN_BODY;
    sibling.bodyHtml = null;
    sibling.status = "approved";
    sibling.generationSource = "ai";
    const savedSibling = await draftModule.create(sibling);

    const attemptModule = new EmailReplySendAttemptModule();
    const attempt = new EmailReplySendAttemptEntity();
    attempt.idempotencyKey = `sibling-${Math.random()}`;
    attempt.draftId = savedSibling.id;
    attempt.revisionId = revisionId;
    attempt.approvalId = 0;
    attempt.messageId = messageId;
    attempt.conversationId = null;
    attempt.emailServiceId = FAKE_MAILBOX.id;
    attempt.senderAddress = "owner@svc.com";
    attempt.recipientAddress = "prospect@example.com";
    attempt.status = "claimed";
    attempt.claimedAt = new Date();
    attempt.submittedAt = null;
    attempt.completedAt = null;
    attempt.providerMessageId = null;
    attempt.failureCode = null;
    attempt.sanitizedError = null;
    await attemptModule.create(attempt);

    await expect(
      new EmailReplyApprovalService().approveDraft({
        draftId,
        approvedByType: "user",
      })
    ).rejects.toThrow(/in flight|reply_in_progress|different send/i);
    const after = await draftModule.readAggregate(draftId);
    expect(after?.status).toBe("failed");
  });

  it("per-thread limit does not consume the retry (sent-only proxy)", async () => {
    const { draftId, token, messageId } = await seedApprovedDraft();
    // Seed an enabled rule with perThreadReplyLimit = 1. Before the fix,
    // countAttemptsForMessage counted the failed attempt, so the retry was
    // refused at orchestrator step 5 ("Per-thread reply limit reached").
    await seedEnabledRule(FAKE_MAILBOX.id, 1);
    await forceFailed(draftId, token);

    const reapproval = await new EmailReplyApprovalService().approveDraft({
      draftId,
      approvedByType: "user",
    });

    const outcome = await buildDelivery("accept").sendApprovedReply({
      draftId,
      approvalToken: reapproval.token,
    });
    expect(outcome.status).toBe("sent");
    const draft = await new EmailReplyDraftModule().readAggregate(draftId);
    expect(draft?.status).toBe("sent");

    // The sent-only proxy counts the now-sent attempt as 1, but the retry
    // already proceeded (the failed attempt no longer counts). Confirm the
    // attempt ledger has exactly one sent + one failed for this message.
    const attemptModule = new EmailReplySendAttemptModule();
    const attempts = await attemptModule.listByMessage(messageId);
    const sent = attempts.filter((a) => a.status === "sent");
    const failed = attempts.filter((a) => a.status === "failed");
    expect(sent.length).toBe(1);
    expect(failed.length).toBe(1);
  });

  it("writes a draft_reopened audit row on the fenced transition", async () => {
    const { draftId, token } = await seedApprovedDraft();
    await forceFailed(draftId, token);

    const auditModule = new EmailReplyAuditLogModule();
    const auditFor = async (): Promise<EmailReplyAuditLogEntity[]> => {
      // The audit list model passes `page` straight to `.skip()` — a raw
      // offset, not a page number — so `page: 0` is "from the newest row".
      const { records } = await auditModule.list({
        emailServiceId: FAKE_MAILBOX.id,
        page: 0,
        size: 500,
      });
      return records.filter((r) => r.draftId === draftId);
    };
    const before = await auditFor();

    await new EmailReplyApprovalService().approveDraft({
      draftId,
      approvedByType: "user",
    });

    const after = await auditFor();
    const reopened = after.filter((r) => r.action === "draft_reopened");
    expect(reopened.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(before.length);
  });

  it("REPLIED detection at pre-send refuses the retry (no double send)", async () => {
    const { draftId, token } = await seedApprovedDraft();
    await forceFailed(draftId, token);
    const reapproval = await new EmailReplyApprovalService().approveDraft({
      draftId,
      approvedByType: "user",
    });

    // A positive detection at forced-send time must refuse the retry even
    // though the reopen succeeded (the reopened draft was `draft` at commit;
    // a positive discovered between approval and SMTP blocks the claim).
    const delivery = new EmailReplyDeliveryService({
      senderFactory: (() => ({
        sendReplyEmail: async (): Promise<EmailSendResult> => ({
          receiver: "prospect@example.com",
          status: true,
          title: "Re: Pricing",
          content: CLEAN_BODY,
          info: "<should-not-send@x>",
        }),
      })) as never,
      serviceLoader: async () => FAKE_MAILBOX,
      detectionServiceFactory: detectionFactory(REPLIED_DETECTION),
    });
    await expect(
      delivery.sendApprovedReply({
        draftId,
        approvalToken: reapproval.token,
      })
    ).rejects.toThrow();
    const after = await new EmailReplyDraftModule().readAggregate(draftId);
    // Reopen happened (draft left failed), but the send was refused → not sent.
    expect(after?.status).not.toBe("sent");
  });
});
