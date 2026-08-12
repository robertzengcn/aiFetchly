import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailReplyDraftModel } from "@/model/EmailReplyDraft.model";
import { EmailReplyDraftRevisionModel } from "@/model/EmailReplyDraftRevision.model";
import { EmailReplyApprovalModel } from "@/model/EmailReplyApproval.model";
import { EmailReplySendAttemptModel } from "@/model/EmailReplySendAttempt.model";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import {
  hashApprovalEnvelope,
  hashApprovalToken,
  buildSendIdempotencyKey,
  generateApprovalToken,
} from "@/service/emailReply/EmailReplyRevisionHasher";
import type { EmailReplyApprovalEnvelope } from "@/entityTypes/emailReplyReliabilityTypes";

/**
 * End-to-end persistence proof of the send-safety guarantees (FR-015/016/018,
 * NFR-001) against a real SQLite database. These cannot be asserted with mocks
 * because the entire point is the database-level conditional UPDATE + unique
 * idempotency index.
 */
describe("EmailReply send-safety (Milestone 1) — DB integration", () => {
  let dbpath: string;
  let draftModel: EmailReplyDraftModel;
  let revisionModel: EmailReplyDraftRevisionModel;
  let approvalModel: EmailReplyApprovalModel;
  let attemptModel: EmailReplySendAttemptModel;

  beforeAll(async () => {
    dbpath = path.join(
      os.tmpdir(),
      `aifetchly-reply-reliability-${Date.now()}`
    );
    fs.mkdirSync(dbpath, { recursive: true });
    // Force the singleton onto our temp path and let synchronize create tables.
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    draftModel = new EmailReplyDraftModel(dbpath);
    revisionModel = new EmailReplyDraftRevisionModel(dbpath);
    approvalModel = new EmailReplyApprovalModel(dbpath);
    attemptModel = new EmailReplySendAttemptModel(dbpath);
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    try {
      fs.rmSync(dbpath, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  /** Seed an approved draft + matching revision + active approval. */
  async function seedApprovedDraft(over: { emailServiceId?: number } = {}) {
    const emailServiceId = over.emailServiceId ?? 7;
    const draft = new EmailReplyDraftEntity();
    draft.messageId = 100;
    draft.emailServiceId = emailServiceId;
    draft.subject = "Re: Pricing";
    draft.bodyText = "Here is our pricing.";
    draft.bodyHtml = null;
    draft.status = "draft";
    draft.generationSource = "ai";
    const savedDraft = await draftModel.create(draft);

    const envelope: EmailReplyApprovalEnvelope = {
      draftId: savedDraft.id,
      revisionId: 0, // placeholder; set after revision insert
      emailServiceId,
      originalMessageId: 100,
      senderAddress: `owner@service${emailServiceId}.com`,
      recipientAddress: "prospect@example.com",
      subject: "Re: Pricing",
      bodyText: "Here is our pricing.",
      bodyHtml: null,
      policyVersion: "policy-1",
      validationVersion: "validator-1",
    };

    // Append revision 1 (compute real envelope hash with the revision id).
    const appended = await draftModel.appendRevision({
      draftId: savedDraft.id,
      actor: "ai",
      subject: envelope.subject,
      bodyText: envelope.bodyText,
      bodyHtml: null,
      senderAddress: envelope.senderAddress,
      recipientAddress: envelope.recipientAddress,
      // contentHash is recomputed by the service in production; for the seed we
      // set it explicitly below to match the approval envelope.
      contentHash: "placeholder",
    });

    const realEnvelope = { ...envelope, revisionId: appended.revision.id };
    const contentHash = hashApprovalEnvelope(realEnvelope);
    // Persist the real hash onto the revision + projection.
    await draftModel.applyContentHash(
      savedDraft.id,
      appended.revision.id,
      contentHash
    );

    // Approve: flip draft -> approved for this revision + hash.
    const ok = await draftModel.markApproved(
      savedDraft.id,
      appended.revision.id,
      contentHash,
      "policy-1",
      new Date()
    );
    expect(ok).toBe(true);

    const token = generateApprovalToken();
    const approvalRow = await approvalModel.create({
      draftId: savedDraft.id,
      revisionId: appended.revision.id,
      approvedByType: "user",
      approvedById: "test-user",
      approvedHash: contentHash,
      approvalTokenHash: hashApprovalToken(token),
      approvedAt: new Date(),
      expiresAt: null,
      invalidatedAt: null,
      invalidationReason: null,
    } as never);

    return {
      draftId: savedDraft.id,
      revisionId: appended.revision.id,
      revisionNumber: appended.revision.revisionNumber,
      approvalId: approvalRow.id,
      contentHash,
      token,
      emailServiceId,
      idempotencyKey: buildSendIdempotencyKey(
        savedDraft.id,
        appended.revision.id,
        contentHash
      ),
    };
  }

  it("a single claim transitions draft -> sending and inserts a claimed attempt", async () => {
    const seed = await seedApprovedDraft();
    const result = await draftModel.claimApprovedRevisionForSend({
      draftId: seed.draftId,
      revisionId: seed.revisionId,
      approvedHash: seed.contentHash,
      idempotencyKey: seed.idempotencyKey,
      approvalId: seed.approvalId,
      messageId: 100,
      conversationId: null,
      emailServiceId: seed.emailServiceId,
      senderAddress: `owner@service${seed.emailServiceId}.com`,
      recipientAddress: "prospect@example.com",
      policyVersion: "policy-1",
    });

    expect(result.status).toBe("claimed");
    if (result.status === "claimed") {
      const attempt = await attemptModel.read(result.attemptId);
      expect(attempt?.status).toBe("claimed");
      const draft = await draftModel.readAggregate(seed.draftId);
      expect(draft?.status).toBe("sending");
    }
  });

  it("two concurrent claims for the same approved revision yield exactly one SMTP submission", async () => {
    const seed = await seedApprovedDraft();
    const claimInput = {
      draftId: seed.draftId,
      revisionId: seed.revisionId,
      approvedHash: seed.contentHash,
      idempotencyKey: seed.idempotencyKey,
      approvalId: seed.approvalId,
      messageId: 100,
      conversationId: null,
      emailServiceId: seed.emailServiceId,
      senderAddress: `owner@service${seed.emailServiceId}.com`,
      recipientAddress: "prospect@example.com",
      policyVersion: "policy-1",
    };

    const [a, b] = await Promise.all([
      draftModel.claimApprovedRevisionForSend(claimInput),
      draftModel.claimApprovedRevisionForSend(claimInput),
    ]);

    const claimed = [a, b].filter((r) => r.status === "claimed");
    const already = [a, b].filter((r) => r.status === "already_processed");
    expect(claimed).toHaveLength(1);
    expect(already).toHaveLength(1);

    // Exactly one attempt row exists for this draft.
    const attempts = await attemptModel.listByDraft(seed.draftId);
    expect(attempts).toHaveLength(1);
  });

  it("a hash mismatch blocks the claim without inserting an attempt", async () => {
    const seed = await seedApprovedDraft();
    const result = await draftModel.claimApprovedRevisionForSend({
      draftId: seed.draftId,
      revisionId: seed.revisionId,
      approvedHash: "0".repeat(64), // wrong hash
      idempotencyKey: seed.idempotencyKey,
      approvalId: seed.approvalId,
      messageId: 100,
      conversationId: null,
      emailServiceId: seed.emailServiceId,
      senderAddress: `owner@service${seed.emailServiceId}.com`,
      recipientAddress: "prospect@example.com",
      policyVersion: "policy-1",
    });

    expect(result.status).toBe("precondition_failed");
    const attempts = await attemptModel.listByDraft(seed.draftId);
    expect(attempts).toHaveLength(0);
    const draft = await draftModel.readAggregate(seed.draftId);
    // Draft stays approved — not silently moved to sending.
    expect(draft?.status).toBe("approved");
  });

  it("finalizeSendOutcome(sent) advances attempt+draft and consumes the approval", async () => {
    const seed = await seedApprovedDraft();
    const claim = await draftModel.claimApprovedRevisionForSend({
      draftId: seed.draftId,
      revisionId: seed.revisionId,
      approvedHash: seed.contentHash,
      idempotencyKey: seed.idempotencyKey,
      approvalId: seed.approvalId,
      messageId: 100,
      conversationId: null,
      emailServiceId: seed.emailServiceId,
      senderAddress: `owner@service${seed.emailServiceId}.com`,
      recipientAddress: "prospect@example.com",
      policyVersion: "policy-1",
    });
    if (claim.status !== "claimed") throw new Error("claim failed");

    await draftModel.finalizeSendOutcome({
      attemptId: claim.attemptId,
      draftId: seed.draftId,
      approvalId: seed.approvalId,
      emailServiceId: seed.emailServiceId,
      messageId: 100,
      outcome: "sent",
      providerMessageId: "<prov-123@x>",
    });

    const draft = await draftModel.readAggregate(seed.draftId);
    expect(draft?.status).toBe("sent");
    expect(draft?.sentAt).toBeTruthy();
    const attempt = await attemptModel.read(claim.attemptId);
    expect(attempt?.status).toBe("sent");
    expect(attempt?.providerMessageId).toBe("<prov-123@x>");
    const approval = await approvalModel.read(seed.approvalId);
    expect(approval?.invalidatedAt).toBeTruthy();
  });

  it("finalizeSendOutcome(delivery_unknown) is terminal and consumes approval", async () => {
    const seed = await seedApprovedDraft();
    const claim = await draftModel.claimApprovedRevisionForSend({
      draftId: seed.draftId,
      revisionId: seed.revisionId,
      approvedHash: seed.contentHash,
      idempotencyKey: seed.idempotencyKey,
      approvalId: seed.approvalId,
      messageId: 100,
      conversationId: null,
      emailServiceId: seed.emailServiceId,
      senderAddress: `owner@service${seed.emailServiceId}.com`,
      recipientAddress: "prospect@example.com",
      policyVersion: "policy-1",
    });
    if (claim.status !== "claimed") throw new Error("claim failed");

    await draftModel.finalizeSendOutcome({
      attemptId: claim.attemptId,
      draftId: seed.draftId,
      approvalId: seed.approvalId,
      emailServiceId: seed.emailServiceId,
      messageId: 100,
      outcome: "delivery_unknown",
      sanitizedError: "SMTP disconnect after possible acceptance",
    });

    const draft = await draftModel.readAggregate(seed.draftId);
    expect(draft?.status).toBe("delivery_unknown");
    const approval = await approvalModel.read(seed.approvalId);
    expect(approval?.invalidatedAt).toBeTruthy();
  });

  it("appending a revision (edit) invalidates the active approval and resets to draft", async () => {
    const seed = await seedApprovedDraft();
    const before = await approvalModel.read(seed.approvalId);
    expect(before?.invalidatedAt).toBeNull();

    const appended = await draftModel.appendRevision({
      draftId: seed.draftId,
      actor: "user",
      subject: "Re: Pricing — updated",
      bodyText: "Different body",
      bodyHtml: null,
      senderAddress: `owner@service${seed.emailServiceId}.com`,
      recipientAddress: "prospect@example.com",
      contentHash: hashApprovalEnvelope({
        draftId: seed.draftId,
        revisionId: seed.revisionId + 1,
        emailServiceId: seed.emailServiceId,
        originalMessageId: 100,
        senderAddress: `owner@service${seed.emailServiceId}.com`,
        recipientAddress: "prospect@example.com",
        subject: "Re: Pricing — updated",
        bodyText: "Different body",
        bodyHtml: null,
        policyVersion: "policy-1",
        validationVersion: "validator-1",
      }),
    });

    expect(appended.revision.revisionNumber).toBeGreaterThan(
      seed.revisionNumber
    );
    const draft = await draftModel.readAggregate(seed.draftId);
    expect(draft?.status).toBe("draft"); // approval invalidated
    const approval = await approvalModel.read(seed.approvalId);
    expect(approval?.invalidatedAt).toBeTruthy();

    // The now-invalid approval cannot claim a send.
    const blocked = await draftModel.claimApprovedRevisionForSend({
      draftId: seed.draftId,
      revisionId: seed.revisionId, // stale revision
      approvedHash: seed.contentHash,
      idempotencyKey: buildSendIdempotencyKey(
        seed.draftId,
        seed.revisionId,
        seed.contentHash
      ),
      approvalId: seed.approvalId,
      messageId: 100,
      conversationId: null,
      emailServiceId: seed.emailServiceId,
      senderAddress: `owner@service${seed.emailServiceId}.com`,
      recipientAddress: "prospect@example.com",
      policyVersion: "policy-1",
    });
    expect(blocked.status).toBe("precondition_failed");
  });
});
