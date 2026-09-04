import { describe, expect, it, beforeEach } from "vitest";
import { OutboundEmailDeliveryService } from "@/service/outboundEmail/OutboundEmailDeliveryService";
import { OutboundEmailAuthorizationService } from "@/service/outboundEmail/OutboundEmailAuthorizationService";
import { OutboundEmailDraftService } from "@/service/outboundEmail/OutboundEmailDraftService";
import { OutboundEmailDeliveryModel } from "@/model/OutboundEmailDelivery.model";
import { OutboundEmailDraftModel } from "@/model/OutboundEmailDraft.model";
import { OutboundEmailAuthorizationModel } from "@/model/OutboundEmailAuthorization.model";
import { SqliteDb } from "@/config/SqliteDb";
import type { EmailItem } from "@/entityTypes/emailmarketingType";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

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

async function seedAuthorizedBatch(): Promise<{
  batchId: number;
  batchHash: string;
  authorizationId: number;
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
    expect(result.attemptId).toBeTypeOf("number");

    // Authorization is consumed.
    const authModel = new OutboundEmailAuthorizationModel(tmpDir);
    const active = await authModel.findActiveByBatch(seed.batchId);
    expect(active).toBeNull();

    // One pending outcome per draft.
    const deliveryModel = new OutboundEmailDeliveryModel(tmpDir);
    const outcomes = await deliveryModel.listOutcomesByAttempt(
      result.attemptId!
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
    expect(second.attemptId).toBe(first.attemptId);
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
    expect(result.attemptId).toBe(999);
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
    const attempt = await deliveryModel.readAttempt(result.attemptId!);
    expect(attempt?.status).toBe("failed");
    expect(attempt?.lastErrorCode).toBe("worker_start_failed");

    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const batch = await draftModel.readBatch(seed.batchId);
    expect(batch?.status).toBe("failed");
  });
});
