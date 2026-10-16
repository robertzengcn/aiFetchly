import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailReplyDraftModel } from "@/model/EmailReplyDraft.model";
import { EmailReplyApprovalModel } from "@/model/EmailReplyApproval.model";
import { EmailReplySendAttemptModel } from "@/model/EmailReplySendAttempt.model";
import { EmailReplyGuardModel } from "@/model/EmailReplyGuard.model";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { EmailReplyGuardEntity } from "@/entity/EmailReplyGuard.entity";
import { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplyAuditLogEntity } from "@/entity/EmailReplyAuditLog.entity";
import {
  hashApprovalEnvelope,
  hashApprovalToken,
  buildSendIdempotencyKey,
  generateApprovalToken,
} from "@/service/emailReply/EmailReplyRevisionHasher";
import type { EmailReplyApprovalEnvelope } from "@/entityTypes/emailReplyReliabilityTypes";

/**
 * Seed an approved draft + matching revision + active approval. Module scope
 * so the T08 sibling-check describe below reuses it with its own model set.
 */
async function seedApprovedDraft(
  models: {
    draftModel: EmailReplyDraftModel;
    approvalModel: EmailReplyApprovalModel;
  },
  over: {
    emailServiceId?: number;
    messageId?: number;
  } = {}
) {
  const { draftModel, approvalModel } = models;
  const emailServiceId = over.emailServiceId ?? 7;
  const messageId = over.messageId ?? 100;
  const draft = new EmailReplyDraftEntity();
  draft.messageId = messageId;
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
    originalMessageId: messageId,
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
    "policy-1"
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
      contentHash,
      approvalRow.id
    ),
  };
}

/**
 * End-to-end persistence proof of the send-safety guarantees (FR-015/016/018,
 * NFR-001) against a real SQLite database. These cannot be asserted with mocks
 * because the entire point is the database-level conditional UPDATE + unique
 * idempotency index.
 */
describe("EmailReply send-safety (Milestone 1) — DB integration", () => {
  let dbpath: string;
  let draftModel: EmailReplyDraftModel;
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

  const SERVICE_ID = 7;

  /**
   * Seed a real received-message row. Required by the D1a freshness fence
   * (claimApprovedRevisionForSend reads the seed row's replyNegativeCheckAt/
   * replyDetectedAt before any write; a missing row yields freshness_stale).
   * Tests in this block previously used a literal messageId=100 with no row;
   * the fail-closed fence now refuses that, so each test seeds a real row and
   * writes a fresh observation to reach the claim/sibling/finalize paths.
   */
  async function seedMessage(): Promise<EmailReceivedMessageEntity> {
    const message = new EmailReceivedMessageEntity();
    message.emailServiceId = SERVICE_ID;
    message.providerUid = `uid-${Math.random()}`;
    message.fromAddress = "prospect@example.com";
    message.toAddressesJson = '["me@x.com"]';
    message.subject = "Pricing?";
    message.receivedAt = new Date();
    message.normalizedMessageId = null;
    return await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .save(message);
  }

  /** Write a fresh replyNegativeCheckAt so the fence passes (≤5s old). */
  async function writeObservation(messageId: number): Promise<void> {
    await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .update({ id: messageId }, { replyNegativeCheckAt: new Date() });
  }

  it("a single claim transitions draft -> sending and inserts a claimed attempt", async () => {
    const msg = await seedMessage();
    const seed = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg.id }
    );
    await writeObservation(msg.id);
    const result = await draftModel.claimApprovedRevisionForSend({
      draftId: seed.draftId,
      revisionId: seed.revisionId,
      approvedHash: seed.contentHash,
      idempotencyKey: seed.idempotencyKey,
      approvalId: seed.approvalId,
      messageId: msg.id,
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
    const msg = await seedMessage();
    const seed = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg.id }
    );
    await writeObservation(msg.id);
    const claimInput = {
      draftId: seed.draftId,
      revisionId: seed.revisionId,
      approvedHash: seed.contentHash,
      idempotencyKey: seed.idempotencyKey,
      approvalId: seed.approvalId,
      messageId: msg.id,
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
    const msg = await seedMessage();
    const seed = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg.id }
    );
    await writeObservation(msg.id);
    const result = await draftModel.claimApprovedRevisionForSend({
      draftId: seed.draftId,
      revisionId: seed.revisionId,
      approvedHash: "0".repeat(64), // wrong hash
      idempotencyKey: seed.idempotencyKey,
      approvalId: seed.approvalId,
      messageId: msg.id,
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
    const msg = await seedMessage();
    const seed = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg.id }
    );
    await writeObservation(msg.id);
    const claim = await draftModel.claimApprovedRevisionForSend({
      draftId: seed.draftId,
      revisionId: seed.revisionId,
      approvedHash: seed.contentHash,
      idempotencyKey: seed.idempotencyKey,
      approvalId: seed.approvalId,
      messageId: msg.id,
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
      messageId: msg.id,
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
    const msg = await seedMessage();
    const seed = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg.id }
    );
    await writeObservation(msg.id);
    const claim = await draftModel.claimApprovedRevisionForSend({
      draftId: seed.draftId,
      revisionId: seed.revisionId,
      approvedHash: seed.contentHash,
      idempotencyKey: seed.idempotencyKey,
      approvalId: seed.approvalId,
      messageId: msg.id,
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
      messageId: msg.id,
      outcome: "delivery_unknown",
      sanitizedError: "SMTP disconnect after possible acceptance",
    });

    const draft = await draftModel.readAggregate(seed.draftId);
    expect(draft?.status).toBe("delivery_unknown");
    const approval = await approvalModel.read(seed.approvalId);
    expect(approval?.invalidatedAt).toBeTruthy();
  });

  it("appending a revision (edit) invalidates the active approval and resets to draft", async () => {
    const msg = await seedMessage();
    const seed = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg.id }
    );
    await writeObservation(msg.id);
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
        seed.contentHash,
        seed.approvalId
      ),
      approvalId: seed.approvalId,
      messageId: msg.id,
      conversationId: null,
      emailServiceId: seed.emailServiceId,
      senderAddress: `owner@service${seed.emailServiceId}.com`,
      recipientAddress: "prospect@example.com",
      policyVersion: "policy-1",
    });
    expect(blocked.status).toBe("precondition_failed");
  });
});

/**
 * T08/FR-036 — message-level claim with canonical-cluster sibling check +
 * guard `phase="sending"` binding (technical design §8.2). The claim
 * transaction reads the cluster, refuses when a sibling is sent/unknown/
 * in-flight, and binds the guard atomically with the attempt INSERT.
 */
describe("EmailReply send claim — message-level sibling check + guard binding (T08)", () => {
  let dbpath: string;
  let draftModel: EmailReplyDraftModel;
  let approvalModel: EmailReplyApprovalModel;
  let attemptModel: EmailReplySendAttemptModel;
  let guardModel: EmailReplyGuardModel;

  beforeAll(async () => {
    dbpath = path.join(
      os.tmpdir(),
      `aifetchly-reply-claim-t08-${Date.now()}`
    );
    fs.mkdirSync(dbpath, { recursive: true });
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    draftModel = new EmailReplyDraftModel(dbpath);
    approvalModel = new EmailReplyApprovalModel(dbpath);
    attemptModel = new EmailReplySendAttemptModel(dbpath);
    guardModel = new EmailReplyGuardModel(dbpath);
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    try {
      fs.rmSync(dbpath, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  const SERVICE_ID = 7;

  /**
   * Seed a real received-message row — REQUIRED for the sibling check (the
   * cluster is resolved from the seed message row; a missing row yields empty
   * evidence, which is why the existing messageId-100 tests above are
   * unaffected).
   */
  async function seedMessage(
    normalizedMessageId: string | null
  ): Promise<EmailReceivedMessageEntity> {
    const message = new EmailReceivedMessageEntity();
    message.emailServiceId = SERVICE_ID;
    message.providerUid = `uid-${Math.random()}`;
    message.fromAddress = "prospect@example.com";
    message.toAddressesJson = '["me@x.com"]';
    message.subject = "Pricing?";
    message.receivedAt = new Date();
    message.normalizedMessageId = normalizedMessageId;
    return await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .save(message);
  }

  /**
   * Write a fresh replyNegativeCheckAt so the D1a freshness fence passes
   * (≤5s old). The fence runs inside claimApprovedRevisionForSend BEFORE the
   * sibling check; without a fresh observation the claim returns
   * freshness_stale and never reaches the guard-binding code under test.
   */
  async function writeObservation(messageId: number): Promise<void> {
    await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .update({ id: messageId }, { replyNegativeCheckAt: new Date() });
  }

  /** Seed an idle guard row for a message's replyKey. */
  async function seedIdleGuard(
    message: EmailReceivedMessageEntity
  ): Promise<EmailReplyGuardEntity> {
    const guard = new EmailReplyGuardEntity();
    guard.emailServiceId = SERVICE_ID;
    guard.replyKey = `row:${message.id}`;
    guard.messageId = message.id;
    guard.phase = "idle";
    guard.ownerToken = null;
    guard.leaseExpiresAt = null;
    guard.activeDraftId = null;
    guard.activeAttemptId = null;
    return await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReplyGuardEntity)
      .save(guard);
  }

  /** Direct guard-row update (the guard model exposes read + findByReplyKey only). */
  async function updateGuard(
    id: number,
    patch: Partial<EmailReplyGuardEntity>
  ): Promise<void> {
    await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReplyGuardEntity)
      .update({ id }, patch);
  }

  function claimInputFor(
    seed: Awaited<ReturnType<typeof seedApprovedDraft>>,
    messageId: number,
    guardId: number | null
  ) {
    return {
      draftId: seed.draftId,
      revisionId: seed.revisionId,
      approvedHash: seed.contentHash,
      idempotencyKey: seed.idempotencyKey,
      approvalId: seed.approvalId,
      messageId,
      conversationId: null,
      emailServiceId: seed.emailServiceId,
      senderAddress: `owner@service${seed.emailServiceId}.com`,
      recipientAddress: "prospect@example.com",
      policyVersion: "policy-1",
      guardId,
    };
  }

  it("binds an idle guard to phase=sending + activeAttemptId on claim", async () => {
    const msg = await seedMessage(null); // row: replyKey — singleton cluster
    const guard = await seedIdleGuard(msg);
    const seed = await seedApprovedDraft({ draftModel, approvalModel }, { messageId: msg.id });
    await writeObservation(msg.id);

    const result = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed, msg.id, guard.id)
    );

    expect(result.status).toBe("claimed");
    if (result.status === "claimed") {
      const row = await guardModel.read(guard.id);
      expect(row?.phase).toBe("sending");
      expect(row?.activeAttemptId).toBe(result.attemptId);
    }
  });

  it("second sibling claim on the same cluster is refused before any write", async () => {
    const msg = await seedMessage(null);
    const guard = await seedIdleGuard(msg);
    // Two approved sibling drafts on the same cluster row.
    const first = await seedApprovedDraft({ draftModel, approvalModel }, { messageId: msg.id });
    const second = await seedApprovedDraft({ draftModel, approvalModel }, { messageId: msg.id });
    await writeObservation(msg.id);

    const firstClaim = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(first, msg.id, guard.id)
    );
    expect(firstClaim.status).toBe("claimed");

    // Guard is now `sending` (bound to the first attempt).
    const bound = await guardModel.read(guard.id);
    expect(bound?.phase).toBe("sending");

    const secondClaim = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(second, msg.id, guard.id)
    );

    expect(secondClaim.status).toBe("precondition_failed");
    if (secondClaim.status === "precondition_failed") {
      expect(secondClaim.reason).toContain("FR-029");
    }
    // No attempt was inserted for the second sibling.
    const attempts = await attemptModel.listByDraft(second.draftId);
    expect(attempts).toHaveLength(0);
    // The second sibling's draft was never flipped to sending.
    const secondDraft = await draftModel.readAggregate(second.draftId);
    expect(secondDraft?.status).toBe("approved");
    // Guard stays bound to the first attempt.
    const after = await guardModel.read(guard.id);
    expect(after?.phase).toBe("sending");
    expect(after?.activeAttemptId).toBe(
      firstClaim.status === "claimed" ? firstClaim.attemptId : null
    );
  });

  it("stale projection: guard idle but a sent attempt exists on the cluster -> claim refused, guard -> sent", async () => {
    const msg = await seedMessage(null);
    const guard = await seedIdleGuard(msg);
    const seed = await seedApprovedDraft({ draftModel, approvalModel }, { messageId: msg.id });
    // A sent attempt on a SIBLING draft in the same cluster (a different
    // draft already replied). The claiming draft is excluded by id, so a
    // sent attempt on the claiming draft itself would NOT block (that's
    // the B04 replay path); a sibling's sent attempt must.
    const sibling = await seedApprovedDraft({ draftModel, approvalModel }, { messageId: msg.id });
    const attempt = new EmailReplySendAttemptEntity();
    attempt.idempotencyKey = `t08-sent-${Math.random()}`;
    attempt.draftId = sibling.draftId;
    attempt.revisionId = sibling.revisionId;
    attempt.approvalId = sibling.approvalId;
    attempt.messageId = msg.id;
    attempt.conversationId = null;
    attempt.emailServiceId = SERVICE_ID;
    attempt.senderAddress = "me@x.com";
    attempt.recipientAddress = "prospect@example.com";
    attempt.status = "sent";
    attempt.claimedAt = new Date();
    await attemptModel.create(attempt);
    await writeObservation(msg.id);

    const result = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed, msg.id, guard.id)
    );

    expect(result.status).toBe("precondition_failed");
    // §5.2: the blocked path reconciles the guard to the evidence phase
    // (`sent`), not `idle` — never trust `idle` while related records exist.
    const row = await guardModel.read(guard.id);
    expect(row?.phase).toBe("sent");
  });

  it("orphan attempt: guard sending with no attempt row -> claim refused", async () => {
    const msg = await seedMessage(null);
    const guard = await seedIdleGuard(msg);
    const seed = await seedApprovedDraft({ draftModel, approvalModel }, { messageId: msg.id });
    // Simulate a crash mid-claim: guard bound to a phantom attempt.
    await updateGuard(guard.id, {
      phase: "sending",
      activeAttemptId: 999999,
    });
    await writeObservation(msg.id);

    const result = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed, msg.id, guard.id)
    );

    expect(result.status).toBe("precondition_failed");
    // Guard untouched — recovery (reclaimExpiredReservation) owns the fix.
    const row = await guardModel.read(guard.id);
    expect(row?.phase).toBe("sending");
  });

  it("claim while a generation reservation holds the guard (generating) is refused before any write", async () => {
    const msg = await seedMessage(null);
    const guard = await seedIdleGuard(msg);
    const seed = await seedApprovedDraft({ draftModel, approvalModel }, { messageId: msg.id });
    // Generation holds the reservation: guard at `generating` with a live
    // lease (T07). The claim must not run while the reservation owns the
    // message — the guard-phase precondition refuses before ANY write.
    await updateGuard(guard.id, {
      phase: "generating",
      ownerToken: "owner-generation",
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    await writeObservation(msg.id);

    const result = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed, msg.id, guard.id)
    );

    expect(result.status).toBe("precondition_failed");
    // No attempt inserted for the blocked claim.
    const attempts = await attemptModel.listByDraft(seed.draftId);
    expect(attempts).toHaveLength(0);
    // The claiming draft was never flipped to sending.
    const draft = await draftModel.readAggregate(seed.draftId);
    expect(draft?.status).toBe("approved");
    // Guard untouched — still held by the generation owner; recovery (the
    // reservation sweep) owns the reclaim when the lease expires.
    const row = await guardModel.read(guard.id);
    expect(row?.phase).toBe("generating");
    expect(row?.ownerToken).toBe("owner-generation");
  });

  it("bind failure rolls back the attempt insert (guard already sent)", async () => {
    const msg = await seedMessage(null);
    const guard = await seedIdleGuard(msg);
    const seed = await seedApprovedDraft({ draftModel, approvalModel }, { messageId: msg.id });
    // Guard is terminal (`sent`) — the sibling check cannot see it (guard
    // rows are not cluster evidence), but the bind fence must.
    await updateGuard(guard.id, { phase: "sent" });
    await writeObservation(msg.id);

    const result = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed, msg.id, guard.id)
    );

    // The bind's 0-rows throws -> the whole transaction (attempt INSERT)
    // rolls back. SQLite in-transaction rollback surfaces as a thrown error.
    expect(result.status).toBe("precondition_failed");
    const attempts = await attemptModel.listByDraft(seed.draftId);
    expect(attempts).toHaveLength(0);
  });

  it("finalizeSendOutcome(sent) transitions the bound guard to sent", async () => {
    const msg = await seedMessage(null);
    const guard = await seedIdleGuard(msg);
    const seed = await seedApprovedDraft({ draftModel, approvalModel }, { messageId: msg.id });
    await writeObservation(msg.id);

    const claim = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed, msg.id, guard.id)
    );
    expect(claim.status).toBe("claimed");

    await draftModel.finalizeSendOutcome({
      attemptId: claim.status === "claimed" ? claim.attemptId : 0,
      draftId: seed.draftId,
      approvalId: seed.approvalId,
      emailServiceId: seed.emailServiceId,
      messageId: msg.id,
      outcome: "sent",
      providerMessageId: "<prov-guard-1@x>",
      guardId: guard.id,
    });

    const row = await guardModel.read(guard.id);
    expect(row?.phase).toBe("sent");
    expect(row?.activeAttemptId).toBeNull();
  });

  it("finalizeSendOutcome(failed) reopens the guard to draft_ready", async () => {
    const msg = await seedMessage(null);
    const guard = await seedIdleGuard(msg);
    const seed = await seedApprovedDraft({ draftModel, approvalModel }, { messageId: msg.id });
    await writeObservation(msg.id);

    const claim = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed, msg.id, guard.id)
    );
    expect(claim.status).toBe("claimed");

    await draftModel.finalizeSendOutcome({
      attemptId: claim.status === "claimed" ? claim.attemptId : 0,
      draftId: seed.draftId,
      approvalId: seed.approvalId,
      emailServiceId: seed.emailServiceId,
      messageId: msg.id,
      outcome: "failed",
      failureCode: "definitely_rejected",
      sanitizedError: "SMTP rejected",
      guardId: guard.id,
    });

    const row = await guardModel.read(guard.id);
    expect(row?.phase).toBe("draft_ready");
    expect(row?.activeAttemptId).toBeNull();
  });

  it("finalizeSendOutcome(delivery_unknown) keeps the guard at delivery_unknown (not idle)", async () => {
    const msg = await seedMessage(null);
    const guard = await seedIdleGuard(msg);
    const seed = await seedApprovedDraft({ draftModel, approvalModel }, { messageId: msg.id });
    await writeObservation(msg.id);

    const claim = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed, msg.id, guard.id)
    );
    expect(claim.status).toBe("claimed");

    await draftModel.finalizeSendOutcome({
      attemptId: claim.status === "claimed" ? claim.attemptId : 0,
      draftId: seed.draftId,
      approvalId: seed.approvalId,
      emailServiceId: seed.emailServiceId,
      messageId: msg.id,
      outcome: "delivery_unknown",
      sanitizedError: "SMTP disconnect after possible acceptance",
      guardId: guard.id,
    });

    // A timeout alone never releases the message (§5.2): the guard stays
    // `delivery_unknown` so a new send claim is refused until reconciliation.
    const row = await guardModel.read(guard.id);
    expect(row?.phase).toBe("delivery_unknown");
    expect(row?.activeAttemptId).toBeNull();
  });

  it("invalidateUnsentDraftsForMailbox releases a draft_ready guard but not a sending guard", async () => {
    const msgA = await seedMessage(null);
    const guardA = await seedIdleGuard(msgA);
    const seedA = await seedApprovedDraft({ draftModel, approvalModel }, { messageId: msgA.id });
    // Guard A bound to draft A in `draft_ready` (commit left it there).
    await updateGuard(guardA.id, { phase: "draft_ready", activeDraftId: seedA.draftId });

    const msgB = await seedMessage(null);
    const guardB = await seedIdleGuard(msgB);
    const seedB = await seedApprovedDraft({ draftModel, approvalModel }, { messageId: msgB.id });
    // Guard B bound to draft B in `sending` (an in-flight send on this draft).
    await updateGuard(guardB.id, { phase: "sending", activeDraftId: seedB.draftId, activeAttemptId: 424242 });

    const invalidated = await draftModel.invalidateUnsentDraftsForMailbox(
      seedA.emailServiceId,
      "knowledge scope changed"
    );
    expect(invalidated).toBeGreaterThanOrEqual(2);

    // Draft A's guard is released (the draft is no longer sendable).
    const rowA = await guardModel.read(guardA.id);
    expect(rowA?.phase).toBe("idle");
    expect(rowA?.activeDraftId).toBeNull();

    // Draft B's guard is NOT released: the in-flight send can still complete
    // and must not lose its message-level exclusion (§9).
    const rowB = await guardModel.read(guardB.id);
    expect(rowB?.phase).toBe("sending");
    expect(rowB?.activeAttemptId).toBe(424242);
  });
});

// ---------------------------------------------------------------------------
// T05 step 11 + R02 (FR-031 §9.3): forced-freshness fence at the model layer.
// The claim transaction's first action reads the seed message's
// replyNegativeCheckAt; only a complete, context-matching fresh NEGATIVE
// satisfies it. A positive (`replyDetectedAt`) is NEVER permission to send —
// the fence treats a null `replyNegativeCheckAt` as stale (freshness_stale,
// NO write) regardless of how fresh any positive is. If the observation is
// older than FORCED_FRESHNESS_WINDOW_MS (5s) it returns `freshness_stale`. The
// delivery service (covered in EmailReplyDeliveryFakeSmtp) reruns detection
// outside the transaction and re-claims once. These tests prove the fence
// semantics directly against the model: the read is non-writing, the timestamp
// comparison is correct, a positive never permits the claim, and the sibling
// check remains authoritative when a sibling sends during the refresh window.
// ---------------------------------------------------------------------------
describe("EmailReply send claim — forced-freshness fence (T05 step 11, §9.3)", () => {
  let dbpath: string;
  let draftModel: EmailReplyDraftModel;
  let approvalModel: EmailReplyApprovalModel;
  let attemptModel: EmailReplySendAttemptModel;

  beforeAll(async () => {
    dbpath = path.join(
      os.tmpdir(),
      `aifetchly-reply-freshness-${Date.now()}`
    );
    fs.mkdirSync(dbpath, { recursive: true });
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    draftModel = new EmailReplyDraftModel(dbpath);
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

  const SERVICE_ID = 7;

  async function seedMessage(): Promise<EmailReceivedMessageEntity> {
    const message = new EmailReceivedMessageEntity();
    message.emailServiceId = SERVICE_ID;
    message.providerUid = `uid-${Math.random()}`;
    message.fromAddress = "prospect@example.com";
    message.toAddressesJson = '["me@x.com"]';
    message.subject = "Pricing?";
    message.receivedAt = new Date();
    message.normalizedMessageId = null;
    return await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .save(message);
  }

  /** Write a replyNegativeCheckAt observation directly to the seed message. */
  async function writeObservation(
    messageId: number,
    observedAt: Date
  ): Promise<void> {
    await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .update({ id: messageId }, { replyNegativeCheckAt: observedAt });
  }

  function claimInputFor(
    seed: Awaited<ReturnType<typeof seedApprovedDraft>>,
    messageId: number
  ) {
    return {
      draftId: seed.draftId,
      revisionId: seed.revisionId,
      approvedHash: seed.contentHash,
      idempotencyKey: seed.idempotencyKey,
      approvalId: seed.approvalId,
      messageId,
      conversationId: null,
      emailServiceId: seed.emailServiceId,
      senderAddress: `owner@service${seed.emailServiceId}.com`,
      recipientAddress: "prospect@example.com",
      policyVersion: "policy-1",
      guardId: null,
    };
  }

  it("observation ≤5s old -> claim proceeds (no freshness_stale)", async () => {
    const msg = await seedMessage();
    const seed = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg.id }
    );
    // Fresh observation: 1 second old (within the 5s window).
    await writeObservation(msg.id, new Date(Date.now() - 1_000));

    const result = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed, msg.id)
    );

    expect(result.status).toBe("claimed");
    if (result.status === "claimed") {
      const attempt = await attemptModel.read(result.attemptId);
      expect(attempt?.status).toBe("claimed");
    }
  });

  it("R02: fresh timestamp from an expired owner -> freshness_stale with NO write", async () => {
    // The negative was observed 1s ago but its owning probe expired 5s ago
    // (abandoned timed-out probe whose compensating void never ran). Readers
    // must reject expired-owner results exactly like missing ones: the
    // timestamp looks fresh, but the observation outlived its owner.
    const msg = await seedMessage();
    const seed = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg.id }
    );
    await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .update(
        { id: msg.id },
        {
          replyNegativeCheckAt: new Date(Date.now() - 1_000),
          replyNegativeOwnerExpiresAt: new Date(Date.now() - 5_000),
        }
      );

    const result = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed, msg.id)
    );

    expect(result.status).toBe("precondition_failed");
    if (result.status === "precondition_failed") {
      expect(result.reason).toBe("freshness_stale");
      expect(result.code).toBe("probe_failed");
    }
    // NO write: the draft stays approved, and no attempt row was inserted.
    const draft = await draftModel.readAggregate(seed.draftId);
    expect(draft?.status).toBe("approved");
    const attempts = await attemptModel.listByDraft(seed.draftId);
    expect(attempts).toHaveLength(0);
  });

  it("R02: fresh timestamp within a live owner window -> claim proceeds", async () => {
    // Same fresh timestamp, but the owner expiry is in the future: a live
    // owner's negative is trusted like before (owner tracking must not
    // break the healthy path).
    const msg = await seedMessage();
    const seed = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg.id }
    );
    await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .update(
        { id: msg.id },
        {
          replyNegativeCheckAt: new Date(Date.now() - 1_000),
          replyNegativeOwnerExpiresAt: new Date(Date.now() + 60_000),
        }
      );

    const result = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed, msg.id)
    );

    expect(result.status).toBe("claimed");
  });

  it("observation 6s old -> freshness_stale with NO write (draft stays approved, no attempt)", async () => {
    const msg = await seedMessage();
    const seed = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg.id }
    );
    // Stale observation: 6 seconds old (outside the 5s window).
    await writeObservation(msg.id, new Date(Date.now() - 6_000));

    const result = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed, msg.id)
    );

    expect(result.status).toBe("precondition_failed");
    if (result.status === "precondition_failed") {
      expect(result.reason).toBe("freshness_stale");
    }
    // NO write: the draft stays approved, and no attempt row was inserted.
    const draft = await draftModel.readAggregate(seed.draftId);
    expect(draft?.status).toBe("approved");
    const attempts = await attemptModel.listByDraft(seed.draftId);
    expect(attempts).toHaveLength(0);
  });

  it("no observation on the seed message -> fence fail-closed to freshness_stale (D1a)", async () => {
    // The pre-send detection (step 5b) MUST have written a fresh observation
    // before the claim; a null replyNegativeCheckAt means either the detection
    // never ran or its persistence failed silently. Treating that as "fresh"
    // (the old fail-open skip) lets a send proceed with zero persisted reply
    // evidence — defeating the branch's core no-duplicate-reply guarantee.
    // Fail-closed: return freshness_stale with NO write so the delivery service
    // reruns detection OUTSIDE the transaction and re-claims once (§9.3). A
    // legacy pre-T03 row with no detection columns is handled upstream — the
    // delivery service runs detection before the claim, so by the time the
    // claim opens the timestamp is populated; if it is not, that is itself a
    // defect signal, not a pass condition.
    const msg = await seedMessage();
    const seed = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg.id }
    );
    // No writeObservation call — both timestamps are null.

    const result = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed, msg.id)
    );

    expect(result.status).toBe("precondition_failed");
    if (result.status === "precondition_failed") {
      expect(result.reason).toBe("freshness_stale");
    }
    // NO write: the draft stays approved, and no attempt row was inserted.
    const draft = await draftModel.readAggregate(seed.draftId);
    expect(draft?.status).toBe("approved");
    const attempts = await attemptModel.listByDraft(seed.draftId);
    expect(attempts).toHaveLength(0);
  });

  it("injected `now` controls the fence deterministically (review D9.1)", async () => {
    // The fence must read the injected clock, not Date.now(). Pin `now` to a
    // fixed instant and an observation 4s before it (inside the 5s window) —
    // the claim MUST proceed even if real wall-clock time has advanced past
    // the window (CI slowness / clock skew must not flip the fence). Then
    // pin `now` 6s past the same observation and assert freshness_stale.
    // Both directions prove the comparison is `now - observedAt`, never the
    // ambient wall clock.
    const msg = await seedMessage();
    const seed = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg.id }
    );
    const observedAt = new Date("2026-01-15T12:00:00.000Z");
    await writeObservation(msg.id, observedAt);

    // 4s after observation → inside the 5s window → claim proceeds.
    const freshNow = new Date("2026-01-15T12:00:04.000Z");
    const freshResult = await draftModel.claimApprovedRevisionForSend({
      ...claimInputFor(seed, msg.id),
      now: freshNow,
    });
    expect(freshResult.status).toBe("claimed");

    // 6s after the SAME observation → outside the window → freshness_stale,
    // proving the comparison used freshNow (not the wall clock, which by now
    // is months past 2026-01-15 and would otherwise always be stale).
    const staleNow = new Date("2026-01-15T12:00:06.000Z");
    const msg2 = await seedMessage();
    const seed2 = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg2.id }
    );
    await writeObservation(msg2.id, observedAt);
    const staleResult = await draftModel.claimApprovedRevisionForSend({
      ...claimInputFor(seed2, msg2.id),
      now: staleNow,
    });
    expect(staleResult.status).toBe("precondition_failed");
    if (staleResult.status === "precondition_failed") {
      expect(staleResult.reason).toBe("freshness_stale");
    }
  });

  it("a sticky positive (replyDetectedAt) is NEVER permission to send (R02)", async () => {
    // R02: a positive is never permission to send. The freshness fence
    // requires a complete, context-matching fresh NEGATIVE
    // (`replyNegativeCheckAt`); a sticky positive (`replyDetectedAt`) with no
    // negative on file is rejected at the fence (null negative →
    // freshness_stale, NO write). The previous behavior accepted a fresh
    // positive as "fresh enough" and let the claim proceed to SMTP despite
    // known reply evidence — the canonical identity had a reply and we sent
    // anyway. The delivery service reruns detection outside the transaction;
    // the positive is then refused upstream by runPreSendDetection. This test
    // isolates the fence's negative-only logic: the fence refuses before any
    // write, regardless of how fresh the positive is.
    const msg = await seedMessage();
    const seed = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg.id }
    );
    await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .update(
        { id: msg.id },
        { replyDetectedAt: new Date(Date.now() - 2_000), replyNegativeCheckAt: null }
      );

    const result = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed, msg.id)
    );

    expect(result.status).toBe("precondition_failed");
    if (result.status === "precondition_failed") {
      expect(result.reason).toBe("freshness_stale");
    }
    // No attempt was inserted and the draft stayed approved (no write).
    const attempts = await attemptModel.listByDraft(seed.draftId);
    expect(attempts.length).toBe(0);
  });

  it("sibling sent during the freshness refresh window -> re-claim refused by the sibling check", async () => {
    // §9.3: the fence returns freshness_stale with NO write. The delivery
    // service reruns detection outside the transaction and re-claims. If a
    // SIBLING send completes between the freshness-stale refusal and the
    // re-claim, the re-claim MUST be refused by the canonical-cluster sibling
    // check (the sibling check is still authoritative, even after a successful
    // refresh). This test isolates the model-level re-claim behavior: the
    // first claim is freshness_stale; a sibling send lands; the re-claim with
    // a now-fresh observation is STILL refused because the cluster blocks it.
    const msg = await seedMessage();
    const seed = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg.id }
    );
    // Stale observation on the first claim.
    await writeObservation(msg.id, new Date(Date.now() - 6_000));

    const firstClaim = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed, msg.id)
    );
    expect(firstClaim.status).toBe("precondition_failed");
    if (firstClaim.status !== "precondition_failed") return;
    expect(firstClaim.reason).toBe("freshness_stale");

    // Simulate a sibling send completing during the refresh window: insert a
    // `sent` attempt on a SIBLING draft in the same cluster (a different
    // approved draft on the same message row). This is what a sibling draft's
    // finalizeSendOutcome(sent) would leave behind, and it is the cluster
    // evidence the canonical-cluster sibling check reads (§8.2).
    const sibling = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg.id }
    );
    const siblingAttempt = new EmailReplySendAttemptEntity();
    siblingAttempt.idempotencyKey = `freshness-sibling-${Math.random()}`;
    siblingAttempt.draftId = sibling.draftId;
    siblingAttempt.revisionId = sibling.revisionId;
    siblingAttempt.approvalId = sibling.approvalId;
    siblingAttempt.messageId = msg.id;
    siblingAttempt.conversationId = null;
    siblingAttempt.emailServiceId = SERVICE_ID;
    siblingAttempt.senderAddress = "me@x.com";
    siblingAttempt.recipientAddress = "prospect@example.com";
    siblingAttempt.status = "sent";
    siblingAttempt.claimedAt = new Date();
    await attemptModel.create(siblingAttempt);

    // The refresh writes a fresh observation (the fence would now pass)...
    await writeObservation(msg.id, new Date(Date.now() - 1_000));
    // ...but the re-claim MUST be refused by the sibling check, because a
    // sibling send is terminal evidence (§8.2).
    const reClaim = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed, msg.id)
    );

    expect(reClaim.status).toBe("precondition_failed");
    if (reClaim.status === "precondition_failed") {
      // The refusal reason is the sibling-check reason, NOT freshness_stale —
      // proving the sibling check runs after the fence and is authoritative.
      expect(reClaim.reason).not.toBe("freshness_stale");
      expect(reClaim.reason).toContain("Message-level state blocks send");
    }
    // No attempt was ever inserted for THIS draft (the sibling's attempt is
    // on its own draft, not the claiming draft).
    const attempts = await attemptModel.listByDraft(seed.draftId);
    expect(attempts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// R20 — Send lifecycle audits carry invocation correlation (P2).
// Per-invocation requestCorrelationId joins a send invocation's claim/outcome
// events; the deterministic per-message messageCorrelationId is kept as a
// separate stable field. Omitted id → fallback to the message id so existing
// audit grouping still works.
//
// Todo regression (verbatim): "two invocations have different request IDs;
// each invocation's claim/outcome events share its returned ID and keep the
// separate message identifier."
// ---------------------------------------------------------------------------
describe("R20 — Send lifecycle audit dual-correlation (model level)", () => {
  let dbpath: string;
  let draftModel: EmailReplyDraftModel;
  let approvalModel: EmailReplyApprovalModel;

  beforeAll(async () => {
    dbpath = path.join(
      os.tmpdir(),
      `aifetchly-r20-correlation-${Date.now()}`
    );
    fs.mkdirSync(dbpath, { recursive: true });
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    draftModel = new EmailReplyDraftModel(dbpath);
    approvalModel = new EmailReplyApprovalModel(dbpath);
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    try {
      fs.rmSync(dbpath, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  const SERVICE_ID = 7;

  async function seedMessage(): Promise<EmailReceivedMessageEntity> {
    const message = new EmailReceivedMessageEntity();
    message.emailServiceId = SERVICE_ID;
    message.providerUid = `uid-r20-${Math.random()}`;
    message.fromAddress = "prospect@example.com";
    message.toAddressesJson = '["me@x.com"]';
    message.subject = "Pricing?";
    message.receivedAt = new Date();
    message.normalizedMessageId = null;
    return await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .save(message);
  }

  async function writeObservation(messageId: number): Promise<void> {
    await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .update({ id: messageId }, { replyNegativeCheckAt: new Date() });
  }

  function claimInputFor(
    seed: Awaited<ReturnType<typeof seedApprovedDraft>>,
    messageId: number,
    guardId: number | null,
    over: { requestCorrelationId?: string } = {}
  ) {
    return {
      draftId: seed.draftId,
      revisionId: seed.revisionId,
      approvedHash: seed.contentHash,
      idempotencyKey: seed.idempotencyKey,
      approvalId: seed.approvalId,
      messageId,
      conversationId: null,
      emailServiceId: seed.emailServiceId,
      senderAddress: `owner@service${seed.emailServiceId}.com`,
      recipientAddress: "prospect@example.com",
      policyVersion: "policy-1",
      guardId,
      requestCorrelationId: over.requestCorrelationId,
    };
  }

  /** Read all audit rows for a message from the temp DB. */
  async function auditsFor(messageId: number) {
    return await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReplyAuditLogEntity)
      .find({ where: { messageId } });
  }

  /** Parse the dual-correlation metadata from an audit row. */
  function parseCorrelation(row: { metadataJson: string | null }): {
    correlationId?: string;
    messageCorrelationId?: string;
  } {
    return JSON.parse(row.metadataJson ?? "{}") as {
      correlationId?: string;
      messageCorrelationId?: string;
    };
  }

  it("claim with requestCorrelationId → send_claimed audit carries that id AND the deterministic message id", async () => {
    const msg = await seedMessage();
    const seed = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg.id }
    );
    await writeObservation(msg.id);
    const requestCorrelationId = "erx-req-r20-test-1";

    const result = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed, msg.id, null, { requestCorrelationId })
    );
    expect(result.status).toBe("claimed");

    const audits = await auditsFor(msg.id);
    const claimed = audits.filter((r) => r.action === "send_claimed");
    expect(claimed).toHaveLength(1);
    const meta = parseCorrelation(claimed[0]);
    // The invocation id is written as correlationId.
    expect(meta.correlationId).toBe(requestCorrelationId);
    // The deterministic per-message id is a separate field.
    expect(meta.messageCorrelationId).toBeTruthy();
    expect(meta.messageCorrelationId).not.toBe(requestCorrelationId);
    expect(meta.messageCorrelationId).toMatch(/^erx-/);
  });

  it("finalize outcome=sent with requestCorrelationId → reply_sent audit carries dual fields", async () => {
    const msg = await seedMessage();
    const seed = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg.id }
    );
    await writeObservation(msg.id);
    const requestCorrelationId = "erx-req-r20-sent-1";

    const claim = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed, msg.id, null, {
        requestCorrelationId,
      })
    );
    if (claim.status !== "claimed") throw new Error("claim failed");

    await draftModel.finalizeSendOutcome({
      attemptId: claim.attemptId,
      draftId: seed.draftId,
      approvalId: seed.approvalId,
      emailServiceId: seed.emailServiceId,
      messageId: msg.id,
      outcome: "sent",
      providerMessageId: "<prov-r20@x>",
      requestCorrelationId,
    });

    const audits = await auditsFor(msg.id);
    const sentAudits = audits.filter((r) => r.action === "reply_sent");
    expect(sentAudits).toHaveLength(1);
    const meta = parseCorrelation(sentAudits[0]);
    expect(meta.correlationId).toBe(requestCorrelationId);
    expect(meta.messageCorrelationId).toBeTruthy();
    expect(meta.messageCorrelationId).not.toBe(requestCorrelationId);
    expect(meta.messageCorrelationId).toMatch(/^erx-/);
  });

  it("finalize outcome=failed with requestCorrelationId → send_failed audit carries dual fields", async () => {
    const msg = await seedMessage();
    const seed = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg.id }
    );
    await writeObservation(msg.id);
    const requestCorrelationId = "erx-req-r20-fail-1";

    const claim = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed, msg.id, null, {
        requestCorrelationId,
      })
    );
    if (claim.status !== "claimed") throw new Error("claim failed");

    await draftModel.finalizeSendOutcome({
      attemptId: claim.attemptId,
      draftId: seed.draftId,
      approvalId: seed.approvalId,
      emailServiceId: seed.emailServiceId,
      messageId: msg.id,
      outcome: "failed",
      failureCode: "smtp_rejected",
      sanitizedError: "Recipient address rejected",
      requestCorrelationId,
    });

    const audits = await auditsFor(msg.id);
    const failedAudits = audits.filter((r) => r.action === "send_failed");
    expect(failedAudits).toHaveLength(1);
    const meta = parseCorrelation(failedAudits[0]);
    expect(meta.correlationId).toBe(requestCorrelationId);
    expect(meta.messageCorrelationId).toBeTruthy();
    expect(meta.messageCorrelationId).not.toBe(requestCorrelationId);
    expect(meta.messageCorrelationId).toMatch(/^erx-/);
  });

  it("finalize outcome=delivery_unknown with requestCorrelationId → delivery_unknown audit carries dual fields", async () => {
    const msg = await seedMessage();
    const seed = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg.id }
    );
    await writeObservation(msg.id);
    const requestCorrelationId = "erx-req-r20-unknown-1";

    const claim = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed, msg.id, null, {
        requestCorrelationId,
      })
    );
    if (claim.status !== "claimed") throw new Error("claim failed");

    await draftModel.finalizeSendOutcome({
      attemptId: claim.attemptId,
      draftId: seed.draftId,
      approvalId: seed.approvalId,
      emailServiceId: seed.emailServiceId,
      messageId: msg.id,
      outcome: "delivery_unknown",
      sanitizedError: "SMTP disconnect after possible acceptance",
      requestCorrelationId,
    });

    const audits = await auditsFor(msg.id);
    const unknownAudits = audits.filter(
      (r) => r.action === "delivery_unknown"
    );
    expect(unknownAudits).toHaveLength(1);
    const meta = parseCorrelation(unknownAudits[0]);
    expect(meta.correlationId).toBe(requestCorrelationId);
    expect(meta.messageCorrelationId).toBeTruthy();
    expect(meta.messageCorrelationId).not.toBe(requestCorrelationId);
    expect(meta.messageCorrelationId).toMatch(/^erx-/);
  });

  it("reconcile confirm_sent with requestCorrelationId → reply_sent audit carries dual fields", async () => {
    const msg = await seedMessage();
    // Guard starts idle so the claim can bind it; the delivery_unknown
    // finalize below transitions it to the pre-reconcile state.
    const guard = new EmailReplyGuardEntity();
    guard.emailServiceId = SERVICE_ID;
    guard.replyKey = `row:${msg.id}`;
    guard.messageId = msg.id;
    guard.phase = "idle";
    guard.ownerToken = null;
    guard.leaseExpiresAt = null;
    guard.activeDraftId = null;
    guard.activeAttemptId = null;
    const savedGuard = await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReplyGuardEntity)
      .save(guard);

    const seed = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg.id }
    );
    await writeObservation(msg.id);

    // Claim → delivery_unknown (simulate ambiguous delivery).
    const claim = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed, msg.id, savedGuard.id)
    );
    if (claim.status !== "claimed") throw new Error("claim failed");

    await draftModel.finalizeSendOutcome({
      attemptId: claim.attemptId,
      draftId: seed.draftId,
      approvalId: seed.approvalId,
      emailServiceId: seed.emailServiceId,
      messageId: msg.id,
      outcome: "delivery_unknown",
      sanitizedError: "Recovered as delivery-unknown",
      guardId: savedGuard.id,
    });

    const requestCorrelationId = "erx-req-r20-reconcile-1";
    await draftModel.reconcileDelivery({
      attemptId: claim.attemptId,
      draftId: seed.draftId,
      messageId: msg.id,
      emailServiceId: seed.emailServiceId,
      action: "confirm_sent",
      evidence: "Mailbox verified",
      providerMessageId: "<prov-reconcile@x>",
      guardId: savedGuard.id,
      requestCorrelationId,
    });

    // The reconciliation writes its own audit (action reply_sent). Filter out
    // the earlier delivery_unknown audit from the finalize step.
    const audits = await auditsFor(msg.id);
    const reconcileAudits = audits.filter(
      (r) => r.action === "reply_sent" && r.reason === "Manual reconciliation: confirm_sent"
    );
    expect(reconcileAudits).toHaveLength(1);
    const meta = parseCorrelation(reconcileAudits[0]);
    expect(meta.correlationId).toBe(requestCorrelationId);
    expect(meta.messageCorrelationId).toBeTruthy();
    expect(meta.messageCorrelationId).not.toBe(requestCorrelationId);
    expect(meta.messageCorrelationId).toMatch(/^erx-/);
  });

  it("reconcile confirm_not_sent with requestCorrelationId → send_failed audit carries dual fields", async () => {
    const msg = await seedMessage();
    // Guard starts idle so the claim can bind it (same flow as above).
    const guard = new EmailReplyGuardEntity();
    guard.emailServiceId = SERVICE_ID;
    guard.replyKey = `row:${msg.id}`;
    guard.messageId = msg.id;
    guard.phase = "idle";
    guard.ownerToken = null;
    guard.leaseExpiresAt = null;
    guard.activeDraftId = null;
    guard.activeAttemptId = null;
    const savedGuard = await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReplyGuardEntity)
      .save(guard);

    const seed = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg.id }
    );
    await writeObservation(msg.id);

    const claim = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed, msg.id, savedGuard.id)
    );
    if (claim.status !== "claimed") throw new Error("claim failed");

    await draftModel.finalizeSendOutcome({
      attemptId: claim.attemptId,
      draftId: seed.draftId,
      approvalId: seed.approvalId,
      emailServiceId: seed.emailServiceId,
      messageId: msg.id,
      outcome: "delivery_unknown",
      sanitizedError: "Recovered as delivery-unknown",
      guardId: savedGuard.id,
    });

    const requestCorrelationId = "erx-req-r20-not-sent-1";
    await draftModel.reconcileDelivery({
      attemptId: claim.attemptId,
      draftId: seed.draftId,
      messageId: msg.id,
      emailServiceId: seed.emailServiceId,
      action: "confirm_not_sent",
      evidence: "Operator confirmed not sent",
      providerMessageId: null,
      guardId: savedGuard.id,
      requestCorrelationId,
    });

    // The reconciliation writes a send_failed audit for confirm_not_sent.
    // Filter out the earlier delivery_unknown audit from the finalize step.
    const audits = await auditsFor(msg.id);
    const reconcileAudits = audits.filter(
      (r) => r.action === "send_failed" && r.reason === "Manual reconciliation: confirm_not_sent"
    );
    expect(reconcileAudits).toHaveLength(1);
    const meta = parseCorrelation(reconcileAudits[0]);
    expect(meta.correlationId).toBe(requestCorrelationId);
    expect(meta.messageCorrelationId).toBeTruthy();
    expect(meta.messageCorrelationId).not.toBe(requestCorrelationId);
    expect(meta.messageCorrelationId).toMatch(/^erx-/);
  });

  // ---- Core regression: two invocations with different request IDs ----
  it("two invocations have different request IDs; each invocation's claim/outcome events share its returned ID and keep the separate message identifier", async () => {
    // Two independent invocations on two messages (a second claim on the
    // first message would be refused by the T08 sibling fence once the first
    // draft is sent — the sibling fence is out of scope here). Each
    // invocation's claim + outcome events must share THAT invocation's
    // request id, while the deterministic messageCorrelationId stays a
    // separate per-message identifier.
    const msg = await seedMessage();
    const seed1 = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg.id }
    );
    await writeObservation(msg.id);

    // Invocation 1: claim + finalize sent with requestCorrelationId A.
    const reqId1 = "erx-req-r20-invocation-1";
    const claim1 = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed1, msg.id, null, {
        requestCorrelationId: reqId1,
      })
    );
    expect(claim1.status).toBe("claimed");
    if (claim1.status !== "claimed") return;

    await draftModel.finalizeSendOutcome({
      attemptId: claim1.attemptId,
      draftId: seed1.draftId,
      approvalId: seed1.approvalId,
      emailServiceId: seed1.emailServiceId,
      messageId: msg.id,
      outcome: "sent",
      providerMessageId: "<prov-inv1@x>",
      requestCorrelationId: reqId1,
    });

    // Verify invocation 1's two audits share the SAME correlationId.
    const audits1 = await auditsFor(msg.id);
    const claimed1 = audits1.filter((r) => r.action === "send_claimed");
    const sent1 = audits1.filter((r) => r.action === "reply_sent");
    expect(claimed1).toHaveLength(1);
    expect(sent1).toHaveLength(1);
    const metaClaim1 = parseCorrelation(claimed1[0]);
    const metaSent1 = parseCorrelation(sent1[0]);
    // Both events from invocation 1 share the invocation's request id.
    expect(metaClaim1.correlationId).toBe(reqId1);
    expect(metaSent1.correlationId).toBe(reqId1);
    // Both carry the SAME deterministic message id.
    expect(metaClaim1.messageCorrelationId).toBe(
      metaSent1.messageCorrelationId
    );
    expect(metaClaim1.messageCorrelationId).not.toBe(reqId1);
    expect(metaClaim1.messageCorrelationId).toMatch(/^erx-/);

    // Invocation 2: a different message with its own invocation id.
    const msg2 = await seedMessage();
    const seed2 = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg2.id }
    );
    await writeObservation(msg2.id);
    const reqId2 = "erx-req-r20-invocation-2";
    const claim2 = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed2, msg2.id, null, {
        requestCorrelationId: reqId2,
      })
    );
    expect(claim2.status).toBe("claimed");
    if (claim2.status !== "claimed") return;

    await draftModel.finalizeSendOutcome({
      attemptId: claim2.attemptId,
      draftId: seed2.draftId,
      approvalId: seed2.approvalId,
      emailServiceId: seed2.emailServiceId,
      messageId: msg2.id,
      outcome: "sent",
      providerMessageId: "<prov-inv2@x>",
      requestCorrelationId: reqId2,
    });

    const audits2 = await auditsFor(msg2.id);
    const claimed2 = audits2.filter((r) => r.action === "send_claimed");
    const sent2 = audits2.filter((r) => r.action === "reply_sent");
    expect(claimed2).toHaveLength(1);
    expect(sent2).toHaveLength(1);
    const metaClaim2 = parseCorrelation(claimed2[0]);
    const metaSent2 = parseCorrelation(sent2[0]);
    // Invocation 2's events share its OWN request id (distinct from inv 1).
    expect(metaClaim2.correlationId).toBe(reqId2);
    expect(metaSent2.correlationId).toBe(reqId2);
    expect(metaClaim2.correlationId).not.toBe(reqId1);
    // Invocation 2's messageCorrelationId is different from invocation 1's
    // (different messageId → deterministic id is different).
    expect(metaClaim2.messageCorrelationId).not.toBe(
      metaClaim1.messageCorrelationId
    );
    expect(metaClaim2.messageCorrelationId).toMatch(/^erx-/);
  });

  it("omitted requestCorrelationId (background recovery) falls back to correlationIdForMessage", async () => {
    const msg = await seedMessage();
    const seed = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg.id }
    );
    await writeObservation(msg.id);

    // Claim WITHOUT requestCorrelationId — simulates a background recovery
    // sweep that has no per-invocation id.
    const result = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed, msg.id, null)
    );
    expect(result.status).toBe("claimed");
    if (result.status !== "claimed") return;

    await draftModel.finalizeSendOutcome({
      attemptId: result.attemptId,
      draftId: seed.draftId,
      approvalId: seed.approvalId,
      emailServiceId: seed.emailServiceId,
      messageId: msg.id,
      outcome: "delivery_unknown",
      sanitizedError: "Recovered as delivery-unknown",
      // No requestCorrelationId — recovery sweep.
    });

    const audits = await auditsFor(msg.id);
    const claimed = audits.filter((r) => r.action === "send_claimed");
    const unknown = audits.filter((r) => r.action === "delivery_unknown");
    expect(claimed).toHaveLength(1);
    expect(unknown).toHaveLength(1);

    // When omitted, both correlationId and messageCorrelationId fall back to
    // the deterministic per-message id — so they are EQUAL. This preserves
    // existing audit grouping by correlationId for legacy callers.
    const metaClaim = parseCorrelation(claimed[0]);
    const metaUnknown = parseCorrelation(unknown[0]);
    expect(metaClaim.correlationId).toBeTruthy();
    expect(metaClaim.correlationId).toBe(metaClaim.messageCorrelationId);
    expect(metaUnknown.correlationId).toBe(metaUnknown.messageCorrelationId);
    // Both events share the same fallback id.
    expect(metaClaim.correlationId).toBe(metaUnknown.correlationId);
    expect(metaClaim.correlationId).toMatch(/^erx-/);
  });

  it("deterministic messageCorrelationId is STABLE when the same message is claimed twice across different invocations", async () => {
    // First invocation: claim + finalize with requestCorrelationId A.
    // Then R13 re-approve the failed draft and claim again with requestCorrelationId B.
    // Both sets of audits must share the SAME messageCorrelationId.
    const msg = await seedMessage();
    const seed = await seedApprovedDraft(
      { draftModel, approvalModel },
      { messageId: msg.id }
    );
    await writeObservation(msg.id);

    const reqId1 = "erx-req-r20-stable-1";
    const claim1 = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(seed, msg.id, null, {
        requestCorrelationId: reqId1,
      })
    );
    expect(claim1.status).toBe("claimed");
    if (claim1.status !== "claimed") return;

    await draftModel.finalizeSendOutcome({
      attemptId: claim1.attemptId,
      draftId: seed.draftId,
      approvalId: seed.approvalId,
      emailServiceId: seed.emailServiceId,
      messageId: msg.id,
      outcome: "failed",
      failureCode: "smtp_rejected",
      sanitizedError: "Recipient rejected",
      requestCorrelationId: reqId1,
    });

    // Re-approve after failure (R13 reopen): failed -> draft, then flip the
    // draft back to approved for the SAME revision + hash so the re-claim's
    // precondition passes (the approval service's normal path does both).
    await draftModel.reopenFailedDraftForRetry({
      draftId: seed.draftId,
      messageId: msg.id,
      emailServiceId: seed.emailServiceId,
    });
    const reapproved = await draftModel.markApproved(
      seed.draftId,
      seed.revisionId,
      seed.contentHash,
      "policy-1"
    );
    expect(reapproved).toBe(true);
    // Fresh approval row + token for the retry invocation.
    const reapproval = await approvalModel.create({
      draftId: seed.draftId,
      revisionId: seed.revisionId,
      approvedByType: "user",
      approvedById: "test-user",
      approvedHash: seed.contentHash,
      approvalTokenHash: hashApprovalToken(generateApprovalToken()),
      approvedAt: new Date(),
      expiresAt: null,
      invalidatedAt: null,
      invalidationReason: null,
    } as never);

    await writeObservation(msg.id);
    const reqId2 = "erx-req-r20-stable-2";
    const reClaimKey = buildSendIdempotencyKey(
      seed.draftId,
      seed.revisionId,
      seed.contentHash,
      reapproval.id
    );
    const claim2 = await draftModel.claimApprovedRevisionForSend({
      draftId: seed.draftId,
      revisionId: seed.revisionId,
      approvedHash: seed.contentHash,
      idempotencyKey: reClaimKey,
      approvalId: reapproval.id,
      messageId: msg.id,
      conversationId: null,
      emailServiceId: seed.emailServiceId,
      senderAddress: `owner@service${seed.emailServiceId}.com`,
      recipientAddress: "prospect@example.com",
      policyVersion: "policy-1",
      requestCorrelationId: reqId2,
    });
    expect(claim2.status).toBe("claimed");
    if (claim2.status !== "claimed") return;

    await draftModel.finalizeSendOutcome({
      attemptId: claim2.attemptId,
      draftId: seed.draftId,
      approvalId: reapproval.id,
      emailServiceId: seed.emailServiceId,
      messageId: msg.id,
      outcome: "sent",
      providerMessageId: "<prov-r20-retry@x>",
      requestCorrelationId: reqId2,
    });

    // All audits for this message: order-independent matching by request id.
    const audits = await auditsFor(msg.id);
    const rowFor = (reqId: string) =>
      audits.filter(
        (r) =>
          (JSON.parse(r.metadataJson ?? "{}") as { correlationId?: string })
            .correlationId === reqId
      );
    const inv1Rows = rowFor(reqId1);
    const inv2Rows = rowFor(reqId2);
    expect(inv1Rows.length).toBeGreaterThanOrEqual(2); // send_claimed + send_failed
    expect(inv2Rows.length).toBeGreaterThanOrEqual(2); // send_claimed + reply_sent

    // Distinct correlationIds per invocation.
    const inv1CorrIds = inv1Rows.map(
      (r) =>
        (JSON.parse(r.metadataJson ?? "{}") as { correlationId?: string })
          .correlationId
    );
    const inv2CorrIds = inv2Rows.map(
      (r) =>
        (JSON.parse(r.metadataJson ?? "{}") as { correlationId?: string })
          .correlationId
    );
    expect(new Set(inv1CorrIds).size).toBe(1);
    expect(new Set(inv2CorrIds).size).toBe(1);
    expect(inv1CorrIds[0]).not.toBe(inv2CorrIds[0]);

    // SAME deterministic messageCorrelationId across BOTH invocations.
    const inv1MsgCorrIds = inv1Rows.map(
      (r) =>
        (JSON.parse(r.metadataJson ?? "{}") as {
          messageCorrelationId?: string;
        }).messageCorrelationId
    );
    const inv2MsgCorrIds = inv2Rows.map(
      (r) =>
        (JSON.parse(r.metadataJson ?? "{}") as {
          messageCorrelationId?: string;
        }).messageCorrelationId
    );
    expect(new Set(inv1MsgCorrIds).size).toBe(1);
    expect(new Set(inv2MsgCorrIds).size).toBe(1);
    expect(inv1MsgCorrIds[0]).toBe(inv2MsgCorrIds[0]);
    expect(inv1MsgCorrIds[0]).toMatch(/^erx-/);
  });
});
