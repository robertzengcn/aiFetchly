import { describe, expect, it, beforeEach } from "vitest";
import { OutboundEmailDeliveryService } from "@/service/outboundEmail/OutboundEmailDeliveryService";
import type { ClaimResult } from "@/service/outboundEmail/OutboundEmailDeliveryService";
import { OutboundEmailAuthorizationService } from "@/service/outboundEmail/OutboundEmailAuthorizationService";
import { OutboundEmailDraftService } from "@/service/outboundEmail/OutboundEmailDraftService";
import { OutboundEmailEnvelopeHasher } from "@/service/outboundEmail/OutboundEmailEnvelopeHasher";
import { OutboundEmailDeliveryModel } from "@/model/OutboundEmailDelivery.model";
import { OutboundEmailDraftModel } from "@/model/OutboundEmailDraft.model";
import { OutboundEmailAuthorizationModel } from "@/model/OutboundEmailAuthorization.model";
import { SqliteDb } from "@/config/SqliteDb";
import type { EmailItem } from "@/entityTypes/emailmarketingType";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

/**
 * Type guard: narrow a {@link ClaimResult} to the statuses that carry an
 * `attemptId` (claimed / already_processed / worker_start_failed). The §17/§15
 * gates (legacy_identity_requires_review, mixed_version_batch,
 * sender_identity_changed) abort without an attempt.
 */
function attemptIdOf(claim: ClaimResult): number {
  if ("attemptId" in claim) return claim.attemptId;
  throw new Error(`expected claim to carry an attemptId, got ${claim.status}`);
}

const tmpDir = path.join(os.tmpdir(), "aifetchly-outbound-delivery-svc");

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
 * Seed an email-service row with id=1 whose resolved identity matches what
 * `generateBatch` freezes into the revision (from=sender@example.com,
 * smtpUsername=null→resolves to from, replyTo=null). The §15.5 identity-reload
 * gate reads this row at claim time; without it, `readIdentity(1)` returns
 * null and the claim aborts with `sender_identity_changed`.
 */
async function seedEmailService(overrides?: {
  from?: string;
  smtpUsername?: string | null;
  replyTo?: string | null;
}): Promise<void> {
  const { EmailServiceModel } = await import("@/model/EmailService.model");
  const { EmailServiceEntity } = await import("@/entity/EmailService.entity");
  const model = new EmailServiceModel(tmpDir);
  const entity = new EmailServiceEntity();
  entity.id = 1;
  entity.name = "Primary";
  entity.from = overrides?.from ?? "sender@example.com";
  entity.smtpUsername = overrides?.smtpUsername ?? null;
  entity.replyTo = overrides?.replyTo ?? null;
  entity.password = "secret";
  entity.host = "smtp.example.com";
  entity.port = "465";
  entity.ssl = 1;
  entity.status = 1;
  await model.create(entity);
}

async function seedAuthorizedBatch(
  serviceOverrides?: Parameters<typeof seedEmailService>[0]
): Promise<{
  batchId: number;
  batchHash: string;
  authorizationId: number;
}> {
  SqliteDb.getInstance(tmpDir);
  await SqliteDb.ensureInitialized();
  await seedEmailService(serviceOverrides);
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

  // Seed an intent decision so the authorization service can validate it.
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

  // Patch the batch's intentDecisionId to the real intent id.
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

  return {
    batchId: generated.batchId!,
    batchHash: generated.batchHash!,
    authorizationId: auth.authorizationId!,
  };
}

describe("OutboundEmailDeliveryService.claim", () => {
  it("claims an authorized batch and creates a send attempt + pending outcomes", async () => {
    const seed = await seedAuthorizedBatch();
    const service = new OutboundEmailDeliveryService(tmpDir, {
      workerStarter: async () => ({ started: true }),
    });

    const result = await service.claim({
      batchId: seed.batchId,
      authorizationId: seed.authorizationId,
      batchHash: seed.batchHash,
    });

    expect(result.status).toBe("claimed");
    expect(attemptIdOf(result)).toBeTypeOf("number");

    // Authorization is consumed.
    const authModel = new OutboundEmailAuthorizationModel(tmpDir);
    const active = await authModel.findActiveByBatch(seed.batchId);
    expect(active).toBeNull();

    // One pending outcome per draft.
    const deliveryModel = new OutboundEmailDeliveryModel(tmpDir);
    const outcomes = await deliveryModel.listOutcomesByAttempt(
      attemptIdOf(result)
    );
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe("pending");
  });

  it("returns already_processed for a duplicate idempotency key", async () => {
    const seed = await seedAuthorizedBatch();
    let starts = 0;
    const service = new OutboundEmailDeliveryService(tmpDir, {
      workerStarter: async () => {
        starts += 1;
        return { started: true };
      },
    });

    const first = await service.claim({
      batchId: seed.batchId,
      authorizationId: seed.authorizationId,
      batchHash: seed.batchHash,
    });
    expect(first.status).toBe("claimed");

    // A second claim for the same batch must not start another worker; it must
    // deduplicate. There is no active authorization anymore (consumed), so the
    // service detects the existing attempt by idempotency key and returns it.
    const second = await service.claim({
      batchId: seed.batchId,
      authorizationId: seed.authorizationId,
      batchHash: seed.batchHash,
    });
    expect(second.status).toBe("already_processed");
    expect(attemptIdOf(second)).toBe(attemptIdOf(first));
    expect(starts).toBe(1);
  });

  it("returns already_processed when a concurrent claim inserts the key between the pre-check and the transaction", async () => {
    // Simulate the race: the pre-transaction duplicate check sees no row, but
    // a concurrent claim inserts the idempotency key before this claim's
    // transaction re-checks. The in-transaction re-check must turn that race
    // into a clean already_processed instead of a thrown constraint violation.
    const seed = await seedAuthorizedBatch();
    let starts = 0;
    const service = new OutboundEmailDeliveryService(tmpDir, {
      workerStarter: async () => {
        starts += 1;
        return { started: true };
      },
    });

    const deliveryModel = new OutboundEmailDeliveryModel(tmpDir);
    const { OutboundEmailSendAttemptEntity } = await import(
      "@/entity/OutboundEmailSendAttempt.entity"
    );

    // Stub the model so the FIRST (pre-txn) lookup returns null and the SECOND
    // (in-txn) lookup returns a row a concurrent claim just inserted.
    let lookupCount = 0;
    const originalFind =
      deliveryModel.findAttemptByIdempotencyKey.bind(deliveryModel);
    deliveryModel.findAttemptByIdempotencyKey = async (key: string) => {
      lookupCount += 1;
      if (lookupCount === 1) {
        // Pre-transaction fast path: nothing yet.
        return null;
      }
      // In-transaction re-check: simulate the concurrent winner.
      const raced = new OutboundEmailSendAttemptEntity();
      raced.id = 999;
      raced.batchId = seed.batchId;
      raced.authorizationId = seed.authorizationId;
      raced.batchHash = seed.batchHash;
      raced.idempotencyKey = key;
      raced.status = "claimed";
      return raced;
    };
    // Force the service to use this stubbed model instance.
    (
      service as unknown as { deliveryModel: OutboundEmailDeliveryModel }
    ).deliveryModel = deliveryModel;
    void originalFind;

    const result = await service.claim({
      batchId: seed.batchId,
      authorizationId: seed.authorizationId,
      batchHash: seed.batchHash,
    });
    expect(result.status).toBe("already_processed");
    expect(attemptIdOf(result)).toBe(999);
    // The worker was never started for the losing claim.
    expect(starts).toBe(0);
    // Suppress unused-original lint — the stub replaces findAttemptByIdempotencyKey.
    void originalFind;
  });

  it("throws batch_hash_mismatch when the stored batch hash differs from the claim", async () => {
    const seed = await seedAuthorizedBatch();
    const service = new OutboundEmailDeliveryService(tmpDir, {
      workerStarter: async () => ({ started: true }),
    });

    await expect(
      service.claim({
        batchId: seed.batchId,
        authorizationId: seed.authorizationId,
        batchHash: "b".repeat(64),
      })
    ).rejects.toThrow(/batch_hash_mismatch/);
  });

  it("marks the attempt failed with worker_start_failed when the worker cannot start", async () => {
    const seed = await seedAuthorizedBatch();
    const service = new OutboundEmailDeliveryService(tmpDir, {
      workerStarter: async () => {
        throw new Error("spawn failed");
      },
    });

    const result = await service.claim({
      batchId: seed.batchId,
      authorizationId: seed.authorizationId,
      batchHash: seed.batchHash,
    });

    expect(result.status).toBe("worker_start_failed");

    const deliveryModel = new OutboundEmailDeliveryModel(tmpDir);
    const attempt = await deliveryModel.readAttempt(attemptIdOf(result));
    expect(attempt?.status).toBe("failed");
    expect(attempt?.lastErrorCode).toBe("worker_start_failed");

    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const batch = await draftModel.readBatch(seed.batchId);
    expect(batch?.status).toBe("failed");
  });

  // §17.2 — a batch mixing v1 and v2 current revisions cannot be sent under
  // one canonicalization rule. The delivery service must reject it before
  // consuming the authorization, without inserting a send attempt.
  it("rejects a mixed v1+v2 batch with mixed_version_batch (no attempt created)", async () => {
    // Seed a batch with TWO recipients → two drafts, both v2 revisions.
    const draftService = new OutboundEmailDraftService(tmpDir, {
      aiEnabledOverride: true,
    });
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    await seedEmailService();
    const generated = await draftService.generateBatch({
      conversationId: "conv-mixed",
      sourceUserMessageId: "msg-mixed",
      intentDecisionId: 1,
      recipientSourceType: "direct",
      recipients: [
        { address: "a@example.com", title: "A", source: "direct" },
        { address: "b@example.com", title: "B", source: "direct" },
      ],
      serviceIds: [1],
      senderAddress: "sender@example.com",
      subject: "Hello",
      bodyText: "Hi",
      bodyHtml: null,
    });
    expect(generated.success).toBe(true);

    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const drafts = await draftModel.listDraftsByBatch(generated.batchId!);
    expect(drafts).toHaveLength(2);

    // Overwrite the FIRST draft's current revision with a v1 revision. The
    // second draft stays v2. This creates a mixed v1+v2 batch.
    const v1ContentHash = OutboundEmailEnvelopeHasher.hashEnvelope({
      version: 1,
      emailServiceId: 1,
      senderAddress: "sender@example.com",
      recipientAddress: "a@example.com",
      subject: "Hello",
      bodyText: "Hi",
      bodyHtml: null,
    });
    await draftModel.appendRevision({
      draftId: drafts[0].id,
      actor: "ai",
      emailServiceId: 1,
      envelopeVersion: 1, // force v1
      smtpUsername: null,
      replyToAddress: null,
      senderAddress: "sender@example.com",
      recipientAddress: "a@example.com",
      subject: "Hello",
      bodyText: "Hi",
      bodyHtml: null,
      contentHash: v1ContentHash,
    });
    // Recompute batch hash (now mixed → v2 majority path per recomputeBatchHash).
    const newBatchHash = await draftService.recomputeBatchHash(
      generated.batchId!
    );

    // Seed intent + authorization with the recomputed hash.
    const { OutboundEmailIntentModel } = await import(
      "@/model/OutboundEmailIntent.model"
    );
    const { OutboundEmailIntentEntity } = await import(
      "@/entity/OutboundEmailIntent.entity"
    );
    const intentModel = new OutboundEmailIntentModel(tmpDir);
    const intent = new OutboundEmailIntentEntity();
    intent.conversationId = "conv-mixed";
    intent.sourceUserMessageId = "msg-mixed";
    intent.mode = "send_now";
    intent.reasonCode = "explicit_send_instruction";
    intent.confidence = 1;
    intent.evidenceJson = "[]";
    intent.sourceTextHash = "b".repeat(64);
    intent.resolverVersion = "outbound-resolver-v1";
    intent.previousAssistantMessageId = null;
    const createdIntent = await intentModel.create(intent);
    await draftModel.updateBatchStatus(generated.batchId!, "draft_ready", {
      intentDecisionId: createdIntent.id,
    });

    const authz = new OutboundEmailAuthorizationService(tmpDir);
    const auth = await authz.createDirectSendAuthorization({
      intentDecisionId: createdIntent.id,
      batchId: generated.batchId!,
      sourceUserMessageId: "msg-mixed",
      conversationId: "conv-mixed",
      batchHash: newBatchHash!,
    });
    expect(auth.success).toBe(true);

    const service = new OutboundEmailDeliveryService(tmpDir, {
      workerStarter: async () => ({ started: true }),
    });
    const result = await service.claim({
      batchId: generated.batchId!,
      authorizationId: auth.authorizationId!,
      batchHash: newBatchHash!,
    });

    // §17.2 — mixed batch rejected without an attempt.
    expect(result.status).toBe("mixed_version_batch");
    expect("attemptId" in result).toBe(false);

    // Authorization was NOT consumed (still active).
    const authModel = new OutboundEmailAuthorizationModel(tmpDir);
    const active = await authModel.findActiveByBatch(generated.batchId!);
    expect(active).not.toBeNull();
  });

  // §17.1 — a legacy all-v1 batch whose service identity no longer satisfies
  // the legacy gate (effective From == approved sender, effective Reply-To ==
  // null, effective SMTP username == approved sender) must be rejected for
  // review rather than sent. This preserves the authentication identity that
  // v1 implicitly assumed.
  it("rejects a legacy v1 batch with legacy_identity_requires_review when the service has a non-null Reply-To", async () => {
    // Seed a service with a non-null replyTo → fails the "Reply-To == null"
    // condition of the §17.1 gate.
    const draftService = new OutboundEmailDraftService(tmpDir, {
      aiEnabledOverride: true,
    });
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    await seedEmailService({ replyTo: "replies@example.com" });
    const generated = await draftService.generateBatch({
      conversationId: "conv-legacy",
      sourceUserMessageId: "msg-legacy",
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

    // Overwrite the current v2 revision with a v1 revision so the batch is
    // all-v1 (the §17.1 path). The v1 revision carries no smtpUsername/
    // replyToAddress; the gate checks the *service* identity, not the revision.
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const drafts = await draftModel.listDraftsByBatch(generated.batchId!);
    expect(drafts).toHaveLength(1);
    const v1ContentHash = OutboundEmailEnvelopeHasher.hashEnvelope({
      version: 1,
      emailServiceId: 1,
      senderAddress: "sender@example.com",
      recipientAddress: "a@example.com",
      subject: "Hello",
      bodyText: "Hi",
      bodyHtml: null,
    });
    await draftModel.appendRevision({
      draftId: drafts[0].id,
      actor: "ai",
      emailServiceId: 1,
      envelopeVersion: 1, // force v1 → triggers §17.1 gate
      smtpUsername: null,
      replyToAddress: null,
      senderAddress: "sender@example.com",
      recipientAddress: "a@example.com",
      subject: "Hello",
      bodyText: "Hi",
      bodyHtml: null,
      contentHash: v1ContentHash,
    });
    // Recompute batch hash (now all-v1 → v1 hash path).
    const newBatchHash = await draftService.recomputeBatchHash(
      generated.batchId!
    );

    // Seed intent + authorization with the recomputed v1 hash.
    const { OutboundEmailIntentModel } = await import(
      "@/model/OutboundEmailIntent.model"
    );
    const { OutboundEmailIntentEntity } = await import(
      "@/entity/OutboundEmailIntent.entity"
    );
    const intentModel = new OutboundEmailIntentModel(tmpDir);
    const intent = new OutboundEmailIntentEntity();
    intent.conversationId = "conv-legacy";
    intent.sourceUserMessageId = "msg-legacy";
    intent.mode = "send_now";
    intent.reasonCode = "explicit_send_instruction";
    intent.confidence = 1;
    intent.evidenceJson = "[]";
    intent.sourceTextHash = "c".repeat(64);
    intent.resolverVersion = "outbound-resolver-v1";
    intent.previousAssistantMessageId = null;
    const createdIntent = await intentModel.create(intent);
    await draftModel.updateBatchStatus(generated.batchId!, "draft_ready", {
      intentDecisionId: createdIntent.id,
    });

    const authz = new OutboundEmailAuthorizationService(tmpDir);
    const auth = await authz.createDirectSendAuthorization({
      intentDecisionId: createdIntent.id,
      batchId: generated.batchId!,
      sourceUserMessageId: "msg-legacy",
      conversationId: "conv-legacy",
      batchHash: newBatchHash!,
    });
    expect(auth.success).toBe(true);

    const service = new OutboundEmailDeliveryService(tmpDir, {
      workerStarter: async () => ({ started: true }),
    });
    const result = await service.claim({
      batchId: generated.batchId!,
      authorizationId: auth.authorizationId!,
      batchHash: newBatchHash!,
    });

    // §17.1 — legacy batch with a non-null Reply-To requires review.
    expect(result.status).toBe("legacy_identity_requires_review");
    expect("attemptId" in result).toBe(false);

    // Authorization was NOT consumed (still active).
    const authModel = new OutboundEmailAuthorizationModel(tmpDir);
    const active = await authModel.findActiveByBatch(generated.batchId!);
    expect(active).not.toBeNull();
  });
});
