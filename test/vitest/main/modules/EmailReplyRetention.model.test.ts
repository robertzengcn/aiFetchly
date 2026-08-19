import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailReplyRetentionService } from "@/service/emailReply/EmailReplyRetentionService";
import { EmailReplyDraftModel } from "@/model/EmailReplyDraft.model";
import { EmailReplyDraftRevisionModel } from "@/model/EmailReplyDraftRevision.model";
import { EmailReplyApprovalModel } from "@/model/EmailReplyApproval.model";
import { EmailReplySendAttemptModel } from "@/model/EmailReplySendAttempt.model";
import { EmailReceivedMessageModel } from "@/model/EmailReceivedMessage.model";
import { EmailConversationModel } from "@/model/EmailConversation.model";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";

/**
 * P4.4: mailbox deletion purges ALL reply-reliability data for that mailbox
 * (drafts, revisions, approvals, attempts, messages, conversations, audits)
 * in one transaction, and never touches another mailbox's rows.
 *
 * The retention service reads the Token-resolved dbpath, so seed through the
 * same Token-fallback connection the service uses.
 */
describe("EmailReplyRetentionService (P4.4)", () => {
  let draftModel: EmailReplyDraftModel;
  let revisionModel: EmailReplyDraftRevisionModel;
  let approvalModel: EmailReplyApprovalModel;
  let attemptModel: EmailReplySendAttemptModel;
  let messageModel: EmailReceivedMessageModel;
  let conversationModel: EmailConversationModel;

  beforeAll(async () => {
    // Models share the Token-fallback singleton the service resolves.
    draftModel = new EmailReplyDraftModel("");
    revisionModel = new EmailReplyDraftRevisionModel("");
    approvalModel = new EmailReplyApprovalModel("");
    attemptModel = new EmailReplySendAttemptModel("");
    messageModel = new EmailReceivedMessageModel("");
    conversationModel = new EmailConversationModel("");
  });

  async function seedMailbox(emailServiceId: number): Promise<number> {
    const draft = new EmailReplyDraftEntity();
    draft.messageId = 900 + emailServiceId;
    draft.emailServiceId = emailServiceId;
    draft.subject = "Re: keep";
    draft.bodyText = "body";
    draft.bodyHtml = null;
    draft.status = "draft";
    draft.generationSource = "ai";
    const saved = await draftModel.create(draft);

    const appended = await draftModel.appendRevision({
      draftId: saved.id,
      actor: "ai",
      subject: "Re: keep",
      bodyText: "body",
      bodyHtml: null,
      senderAddress: `owner@svc${emailServiceId}.com`,
      recipientAddress: "p@x.com",
      contentHash: "purge-test",
    });
    await approvalModel.create({
      draftId: saved.id,
      revisionId: appended.revision.id,
      approvedByType: "user",
      approvedById: null,
      approvedHash: "purge-test",
      approvalTokenHash: `tok-${emailServiceId}-${saved.id}`,
      approvedAt: new Date(),
      expiresAt: null,
      invalidatedAt: null,
      invalidationReason: null,
    } as never);
    const attempt = new EmailReplySendAttemptEntity();
    attempt.idempotencyKey = `purge-${emailServiceId}-${saved.id}`;
    attempt.draftId = saved.id;
    attempt.revisionId = appended.revision.id;
    attempt.approvalId = 1;
    attempt.messageId = draft.messageId;
    attempt.conversationId = null;
    attempt.emailServiceId = emailServiceId;
    attempt.senderAddress = `owner@svc${emailServiceId}.com`;
    attempt.recipientAddress = "p@x.com";
    attempt.status = "sent";
    attempt.claimedAt = new Date();
    await attemptModel.create(attempt);

    const msg = new EmailReceivedMessageEntity();
    msg.emailServiceId = emailServiceId;
    msg.providerUid = `purge-${emailServiceId}`;
    msg.messageId = `<purge-${emailServiceId}@x>`;
    msg.threadKey = msg.messageId;
    msg.fromAddress = "p@x.com";
    msg.toAddressesJson = "[]";
    msg.subject = "keep";
    msg.bodyText = "keep";
    msg.receivedAt = new Date();
    msg.isUnread = 1;
    msg.replyStatus = "not_started";
    await messageModel.upsertByProviderUid(msg);

    await conversationModel.resolveOrCreate({
      emailServiceId,
      rootKey: `purge-root-${emailServiceId}@x`,
      matchCandidates: [],
      confidence: "exact",
      ambiguityReason: null,
      displaySubject: "keep",
      lastMessageAt: new Date(),
    });
    return saved.id;
  }

  it("purges every row for the mailbox and leaves other mailboxes intact", async () => {
    const targetDraft = await seedMailbox(71);
    const otherDraft = await seedMailbox(72);

    const counts = await new EmailReplyRetentionService().purgeMailboxData(
      71,
      path.join(os.tmpdir(), "aifetchly-test")
    );

    expect(counts.drafts).toBe(1);
    expect(counts.revisions).toBe(1);
    expect(counts.approvals).toBeGreaterThanOrEqual(1);
    expect(counts.attempts).toBe(1);
    expect(counts.messages).toBeGreaterThanOrEqual(1);
    expect(counts.conversations).toBe(1);

    // Target mailbox's rows are gone.
    expect(await draftModel.readAggregate(targetDraft)).toBeNull();
    expect(await revisionModel.readCurrent(targetDraft)).toBeNull();
    expect(
      await attemptModel.findByIdempotencyKey(`purge-71-${targetDraft}`)
    ).toBeNull();

    // The other mailbox is untouched.
    const survivor = await draftModel.readAggregate(otherDraft);
    expect(survivor?.emailServiceId).toBe(72);
    expect(
      await attemptModel.findByIdempotencyKey(`purge-72-${otherDraft}`)
    ).not.toBeNull();
  });
});
