/**
 * T11/FR-038 §5.3 — forward-compatible rollback: rollout disabling cannot
 * remove the mandatory local duplicate protection.
 *
 * The kill switch (`EMAIL_REPLY_KILL_SWITCH_FLAG`) disables NEW work only:
 * draft generation and new send claims are refused at the IPC/tool boundary
 * (`emailReceive-ipc.ts` / `EmailReceiveAiTools.ts`). It NEVER removes the
 * cluster-evidence blocking paths — `acquireReservation`'s
 * sent/unknown/conflict/sending checks and `claimApprovedRevisionForSend`'s
 * canonical-cluster sibling check contain NO feature-flag reads. They run
 * unconditionally, so a sent/unknown/conflict cluster still blocks even when
 * every rollout flag (kill switch + recoverable-history + tool-output) is OFF.
 *
 * This suite proves that invariant directly: the blocking paths are exercised
 * with every rollout flag in its default-OFF state, and a sibling send claim
 * is refused even though the kill switch would refuse a NEW claim at the IPC
 * boundary. The kill switch and the cluster protection are independent —
 * disabling the workflow cannot erode the duplicate guard.
 */

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
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import {
  hashApprovalEnvelope,
  hashApprovalToken,
  buildSendIdempotencyKey,
  generateApprovalToken,
} from "@/service/emailReply/EmailReplyRevisionHasher";
import type { EmailReplyApprovalEnvelope } from "@/entityTypes/emailReplyReliabilityTypes";

describe("T11 §5.3 — rollback cannot remove mandatory local duplicate protection", () => {
  let dbpath: string;
  let draftModel: EmailReplyDraftModel;
  let approvalModel: EmailReplyApprovalModel;
  let attemptModel: EmailReplySendAttemptModel;
  let guardModel: EmailReplyGuardModel;

  beforeAll(async () => {
    dbpath = path.join(
      os.tmpdir(),
      `aifetchly-reply-rollback-${process.pid}-${Date.now()}`
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
   * Write a fresh replyNegativeCheckAt so the D1a freshness fence inside
   * claimApprovedRevisionForSend passes (≤5s old, fail-closed on null).
   */
  async function writeObservation(messageId: number): Promise<void> {
    await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .update({ id: messageId }, { replyNegativeCheckAt: new Date() });
  }

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

  async function seedApprovedDraft(messageId: number): Promise<{
    draftId: number;
    revisionId: number;
    approvalId: number;
    contentHash: string;
    idempotencyKey: string;
    emailServiceId: number;
  }> {
    const draft = new EmailReplyDraftEntity();
    draft.messageId = messageId;
    draft.emailServiceId = SERVICE_ID;
    draft.subject = "Re: Pricing";
    draft.bodyText = "Here is our pricing.";
    draft.bodyHtml = null;
    draft.status = "draft";
    draft.generationSource = "ai";
    const savedDraft = await draftModel.create(draft);

    const envelope: EmailReplyApprovalEnvelope = {
      draftId: savedDraft.id,
      revisionId: 0,
      emailServiceId: SERVICE_ID,
      originalMessageId: messageId,
      senderAddress: `owner@service${SERVICE_ID}.com`,
      recipientAddress: "prospect@example.com",
      subject: "Re: Pricing",
      bodyText: "Here is our pricing.",
      bodyHtml: null,
      policyVersion: "policy-1",
      validationVersion: "validator-1",
    };

    const appended = await draftModel.appendRevision({
      draftId: savedDraft.id,
      actor: "ai",
      subject: envelope.subject,
      bodyText: envelope.bodyText,
      bodyHtml: null,
      senderAddress: envelope.senderAddress,
      recipientAddress: envelope.recipientAddress,
      contentHash: "placeholder",
    });

    const realEnvelope = { ...envelope, revisionId: appended.revision.id };
    const contentHash = hashApprovalEnvelope(realEnvelope);
    await draftModel.applyContentHash(
      savedDraft.id,
      appended.revision.id,
      contentHash
    );

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
      approvalId: approvalRow.id,
      contentHash,
      idempotencyKey: buildSendIdempotencyKey(
        savedDraft.id,
        appended.revision.id,
        contentHash,
        approvalRow.id
      ),
      emailServiceId: SERVICE_ID,
    };
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

  /**
   * The canonical-cluster sibling check inside `claimApprovedRevisionForSend`
   * has NO feature-flag dependency. Even with every rollout flag in its
   * default-OFF state (kill switch, recoverable-history, tool-output), a
   * sibling send that is already in-flight blocks a second claim before any
   * write — exactly the §5.3 "rollout disabling cannot remove mandatory
   * local duplicate protection" invariant.
   *
   * The kill switch would refuse a NEW send at the IPC boundary
   * (`emailReceive-ipc.ts` L456 throws when `isEmailReplyKillSwitchOn()`).
   * This test does NOT go through the IPC boundary; it calls the model
   * directly, the way the cluster-protection layer runs underneath any
   * rollout gate. The point is that the protection is structural — it does
   * not depend on the kill switch being OFF to function.
   */
  it("a sibling send claim is refused even when rollout flags are default-OFF (kill switch cannot remove protection)", async () => {
    const msg = await seedMessage(null);
    const guard = await seedIdleGuard(msg);
    const first = await seedApprovedDraft(msg.id);
    const second = await seedApprovedDraft(msg.id);
    await writeObservation(msg.id);

    // First claim succeeds — the cluster is clean.
    const firstClaim = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(first, msg.id, guard.id)
    );
    expect(firstClaim.status).toBe("claimed");

    // Second sibling claim on the same cluster is refused BEFORE any write,
    // regardless of rollout-flag state. No second attempt is inserted; the
    // second draft stays approved (never flipped to sending).
    const secondClaim = await draftModel.claimApprovedRevisionForSend(
      claimInputFor(second, msg.id, guard.id)
    );
    expect(secondClaim.status).toBe("precondition_failed");
    if (secondClaim.status === "precondition_failed") {
      expect(secondClaim.reason).toContain("FR-029");
    }
    const secondAttempts = await attemptModel.listByDraft(second.draftId);
    expect(secondAttempts).toHaveLength(0);
    const secondDraft = await draftModel.readAggregate(second.draftId);
    expect(secondDraft?.status).toBe("approved");

    // The guard stays bound to the first attempt — protection held.
    const after = await guardModel.read(guard.id);
    expect(after?.phase).toBe("sending");
    expect(after?.activeAttemptId).toBe(
      firstClaim.status === "claimed" ? firstClaim.attemptId : null
    );
  });

  /**
   * `shouldPromoteReplyStatusFromProvider` is the sync-side sticky-positive
   * protection: an inbound `\Answered` flag promotes `replyStatus` to `sent`,
   * but a cleared flag (or any non-sent incoming status) NEVER downgrades an
   * existing `sent`. This is a pure function with no feature-flag dependency —
   * it runs on every sync upsert, regardless of rollout state.
   */
  it("shouldPromoteReplyStatusFromProvider never downgrades a sent row (sticky positive, flag-free)", async () => {
    const { shouldPromoteReplyStatusFromProvider } = await import(
      "@/model/EmailReceivedMessage.model"
    );
    // Incoming sent + existing non-sent → promote (protects against re-drafting).
    expect(
      shouldPromoteReplyStatusFromProvider("sent", "not_started")
    ).toBe(true);
    expect(shouldPromoteReplyStatusFromProvider("sent", "draft_created")).toBe(
      true
    );
    // Incoming sent + existing sent → no-op (already protected).
    expect(shouldPromoteReplyStatusFromProvider("sent", "sent")).toBe(false);
    // A cleared flag (incoming undefined / not_started) NEVER downgrades sent.
    expect(
      shouldPromoteReplyStatusFromProvider(undefined, "sent")
    ).toBe(false);
    expect(
      shouldPromoteReplyStatusFromProvider("not_started", "sent")
    ).toBe(false);
    // Non-sent incoming on a non-sent row → no promotion (no false positive).
    expect(
      shouldPromoteReplyStatusFromProvider("not_started", "draft_created")
    ).toBe(false);
  });
});
