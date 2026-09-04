import { describe, expect, it, beforeEach } from "vitest";
import { OutboundEmailRecoveryService } from "@/service/outboundEmail/OutboundEmailRecoveryService";
import { OutboundEmailDeliveryService } from "@/service/outboundEmail/OutboundEmailDeliveryService";
import { OutboundEmailAuthorizationService } from "@/service/outboundEmail/OutboundEmailAuthorizationService";
import { OutboundEmailDraftService } from "@/service/outboundEmail/OutboundEmailDraftService";
import { OutboundEmailDeliveryModel } from "@/model/OutboundEmailDelivery.model";
import { OutboundEmailDraftModel } from "@/model/OutboundEmailDraft.model";
import { OutboundEmailAuthorizationModel } from "@/model/OutboundEmailAuthorization.model";
import { OutboundEmailAuditLogModel } from "@/model/OutboundEmailAuditLog.model";
import { SqliteDb } from "@/config/SqliteDb";
import type { EmailItem } from "@/entityTypes/emailmarketingType";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-outbound-recovery");

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        // ignore
      }
    }
  }
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
});

function recipients(): EmailItem[] {
  return [{ address: "a@example.com", title: "A", source: "direct" }];
}

/**
 * Seed a fully-authorized batch + intent decision + active authorization, then
 * claim it (worker starts successfully). Returns the handles recovery mutates.
 */
async function seedClaimedBatch(): Promise<{
  batchId: number;
  batchHash: string;
  authorizationId: number;
  attemptId: number;
}> {
  SqliteDb.getInstance(tmpDir);
  await SqliteDb.ensureInitialized();
  const draftService = new OutboundEmailDraftService(tmpDir, {
    aiEnabledOverride: true,
  });
  const generated = await draftService.generateBatch({
    conversationId: "conv-1",
    sourceUserMessageId: "msg-1",
    intentDecisionId: 1,
    recipientSourceType: "direct",
    recipients: recipients(),
    serviceIds: [1],
    senderAddress: "sender@example.com",
    subject: "Hello",
    bodyText: "Hi",
    bodyHtml: null,
  });
  expect(generated.success).toBe(true);

  const { OutboundEmailIntentModel } = await import(
    "@/model/OutboundEmailIntent.model"
  );
  const { OutboundEmailIntentEntity } = await import(
    "@/entity/OutboundEmailIntent.entity"
  );
  const intentModel = new OutboundEmailIntentModel(tmpDir);
  const intent = new OutboundEmailIntentEntity();
  intent.conversationId = "conv-1";
  intent.sourceUserMessageId = "msg-1";
  intent.mode = "send_now";
  intent.reasonCode = "explicit_send_instruction";
  intent.confidence = 1;
  intent.evidenceJson = "[]";
  intent.sourceTextHash = "a".repeat(64);
  intent.resolverVersion = "outbound-resolver-v1";
  intent.previousAssistantMessageId = null;
  const createdIntent = await intentModel.create(intent);

  const draftModel = new OutboundEmailDraftModel(tmpDir);
  await draftModel.updateBatchStatus(generated.batchId!, "draft_ready", {
    intentDecisionId: createdIntent.id,
  });

  const authz = new OutboundEmailAuthorizationService(tmpDir);
  const auth = await authz.createDirectSendAuthorization({
    intentDecisionId: createdIntent.id,
    batchId: generated.batchId!,
    sourceUserMessageId: "msg-1",
    conversationId: "conv-1",
    batchHash: generated.batchHash!,
  });
  expect(auth.success).toBe(true);

  const deliveryService = new OutboundEmailDeliveryService(tmpDir, {
    workerStarter: async () => ({ started: true }),
  });
  const claim = await deliveryService.claim({
    batchId: generated.batchId!,
    authorizationId: auth.authorizationId!,
    batchHash: generated.batchHash!,
  });
  expect(claim.status).toBe("claimed");

  return {
    batchId: generated.batchId!,
    batchHash: generated.batchHash!,
    authorizationId: auth.authorizationId!,
    attemptId: claim.attemptId!,
  };
}

describe("OutboundEmailRecoveryService", () => {
  // §21 rule 1 — expire active authorizations past expiresAt.
  it("expires an active authorization whose TTL has elapsed", async () => {
    const seed = await seedClaimedBatch();
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const authModel = new OutboundEmailAuthorizationModel(tmpDir);

    // Create a *second* active authorization for the batch whose expiresAt is
    // already in the past. The claimed batch's own authorization was consumed,
    // so we mint a fresh expired-active row directly via the model.
    const { OutboundEmailAuthorizationEntity } = await import(
      "@/entity/OutboundEmailAuthorization.entity"
    );
    const expiredActive = new OutboundEmailAuthorizationEntity();
    expiredActive.batchId = seed.batchId;
    expiredActive.type = "explicit_user_instruction";
    expiredActive.sourceUserMessageId = "msg-1";
    expiredActive.intentDecisionId = 1;
    expiredActive.batchHash = seed.batchHash;
    expiredActive.tokenHash = null;
    expiredActive.status = "active";
    expiredActive.expiresAt = new Date(Date.now() - 60_000); // expired 1m ago
    expiredActive.consumedAt = null;
    expiredActive.invalidatedAt = null;
    expiredActive.invalidationReason = null;
    const created = await authModel.create(expiredActive);

    const recovery = new OutboundEmailRecoveryService(tmpDir);
    const summary = await recovery.recover();

    expect(summary.authorizationsExpired).toBeGreaterThanOrEqual(1);

    const after = await authModel.read(created.id);
    expect(after?.status).toBe("expired");

    // Audit rule 6 — every transition is audited.
    const auditModel = new OutboundEmailAuditLogModel(tmpDir);
    const logs = await auditModel.listByBatch(seed.batchId);
    expect(
      logs.some((l) => l.eventCode === "authorization_expired")
    ).toBe(true);

    // Rule 5 — recovery never created a new send attempt.
    const deliveryModel = new OutboundEmailDeliveryModel(tmpDir);
    const attempt = await deliveryModel.readAttempt(seed.attemptId);
    expect(attempt?.status).toBe("claimed"); // untouched by rule 1
    void draftModel; // keep ref to avoid unused-warning in some toolchains
  });

  // §21 rule 2 — claimed attempt with no worker-start past the threshold,
  // worker never started is proven by null workerStartedAt → mark failed.
  it("marks a stale claimed attempt (worker never started) failed", async () => {
    const seed = await seedClaimedBatch();
    const deliveryModel = new OutboundEmailDeliveryModel(tmpDir);

    // Rewind claimedAt past the 2-minute threshold; workerStartedAt stays null.
    const stale = new Date(Date.now() - 3 * 60_000);
    await deliveryModel.updateAttemptStatus(seed.attemptId, "claimed", {
      claimedAt: stale,
      workerStartedAt: null,
    });

    const recovery = new OutboundEmailRecoveryService(tmpDir);
    const summary = await recovery.recover();

    expect(summary.attemptsRecovered).toBeGreaterThanOrEqual(1);

    const attempt = await deliveryModel.readAttempt(seed.attemptId);
    expect(attempt?.status).toBe("failed");
    expect(attempt?.lastErrorCode).toBe("worker_never_started");

    // Pending outcomes → failed (definite pre-acceptance rejection only).
    const outcomes = await deliveryModel.listOutcomesByAttempt(
      seed.attemptId
    );
    expect(outcomes.every((o) => o.status === "failed")).toBe(true);

    // Batch recomputed to failed (rule 4).
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const batch = await draftModel.readBatch(seed.batchId);
    expect(batch?.status).toBe("failed");

    // Audit rule 6.
    const auditModel = new OutboundEmailAuditLogModel(tmpDir);
    const logs = await auditModel.listByBatch(seed.batchId);
    expect(
      logs.some((l) => l.eventCode === "recovery_attempt_failed")
    ).toBe(true);
  });

  // §21 rule 3 — sending attempt with a dead worker and pending/submitted
  // outcomes → uncertain recipients become delivery_unknown (NEVER failed,
  // NEVER auto-retried — FR-019).
  it("marks uncertain recipients delivery_unknown for a dead sending attempt", async () => {
    const seed = await seedClaimedBatch();
    const deliveryModel = new OutboundEmailDeliveryModel(tmpDir);

    // Simulate a worker that started, reached sending, then died — with a
    // pending outcome (uncertain). Rewind timestamps past the threshold.
    const stale = new Date(Date.now() - 3 * 60_000);
    await deliveryModel.updateAttemptStatus(seed.attemptId, "sending", {
      claimedAt: stale,
      workerStartedAt: new Date(Date.now() - 3 * 60_000 + 5_000),
    });

    const recovery = new OutboundEmailRecoveryService(tmpDir);
    const summary = await recovery.recover();

    expect(summary.attemptsRecovered).toBeGreaterThanOrEqual(1);

    const attempt = await deliveryModel.readAttempt(seed.attemptId);
    expect(attempt?.status).toBe("delivery_unknown");
    expect(attempt?.lastErrorCode).toBe("recovery_timeout");

    // Uncertain (pending/submitted) outcomes → delivery_unknown, NOT failed.
    const outcomes = await deliveryModel.listOutcomesByAttempt(
      seed.attemptId
    );
    expect(outcomes.every((o) => o.status === "delivery_unknown")).toBe(true);

    // Batch recomputed to delivery_unknown (rule 4).
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const batch = await draftModel.readBatch(seed.batchId);
    expect(batch?.status).toBe("delivery_unknown");

    // Audit rule 6.
    const auditModel = new OutboundEmailAuditLogModel(tmpDir);
    const logs = await auditModel.listByBatch(seed.batchId);
    expect(
      logs.some((l) => l.eventCode === "recovery_delivery_unknown")
    ).toBe(true);
  });

  // §21 rule 5 — recovery NEVER creates a new send attempt.
  it("never creates a new send attempt during recovery", async () => {
    const seed = await seedClaimedBatch();
    const deliveryModel = new OutboundEmailDeliveryModel(tmpDir);

    // Count attempts before.
    const { OutboundEmailSendAttemptEntity } = await import(
      "@/entity/OutboundEmailSendAttempt.entity"
    );
    const conn = SqliteDb.getInstance(tmpDir).connection;
    const beforeCount = await conn
      .getRepository(OutboundEmailSendAttemptEntity)
      .count();

    // Stale the attempt so recovery has work to do.
    const stale = new Date(Date.now() - 3 * 60_000);
    await deliveryModel.updateAttemptStatus(seed.attemptId, "sending", {
      claimedAt: stale,
      workerStartedAt: new Date(Date.now() - 3 * 60_000 + 5_000),
    });

    const recovery = new OutboundEmailRecoveryService(tmpDir);
    await recovery.recover();

    const afterCount = await conn
      .getRepository(OutboundEmailSendAttemptEntity)
      .count();
    expect(afterCount).toBe(beforeCount); // no new attempt created
  });

  // §21 rule 4 — batch status recomputed from recipient outcomes: all sent →
  // sent; a terminal mix → partially_sent; the batch reflects outcomes, not
  // the (possibly stale) attempt status.
  it("recomputes batch status to sent when every outcome is sent", async () => {
    const seed = await seedClaimedBatch();
    const deliveryModel = new OutboundEmailDeliveryModel(tmpDir);

    // Mark the single outcome sent, then ask recovery to recompute.
    const outcomes = await deliveryModel.listOutcomesByAttempt(
      seed.attemptId
    );
    for (const o of outcomes) {
      await deliveryModel.updateOutcomeStatus(o.id, "sent", {
        completedAt: new Date(),
      });
    }

    const recovery = new OutboundEmailRecoveryService(tmpDir);
    await recovery.recomputeBatchStatus(seed.batchId);

    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const batch = await draftModel.readBatch(seed.batchId);
    expect(batch?.status).toBe("sent");
  });

  // A clean batch (no stale state) is left untouched — recovery is a no-op.
  it("is a no-op when there is nothing to recover", async () => {
    await seedClaimedBatch();
    const recovery = new OutboundEmailRecoveryService(tmpDir);
    const summary = await recovery.recover();

    expect(summary.authorizationsExpired).toBe(0);
    expect(summary.attemptsRecovered).toBe(0);
  });
});
