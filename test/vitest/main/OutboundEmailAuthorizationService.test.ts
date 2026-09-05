import { describe, expect, it, beforeEach } from "vitest";
import { OutboundEmailAuthorizationService } from "@/service/outboundEmail/OutboundEmailAuthorizationService";
import { OutboundEmailAuthorizationModel } from "@/model/OutboundEmailAuthorization.model";
import { OutboundEmailDraftModel } from "@/model/OutboundEmailDraft.model";
import { OutboundEmailDraftBatchEntity } from "@/entity/OutboundEmailDraftBatch.entity";
import { OutboundEmailIntentEntity } from "@/entity/OutboundEmailIntent.entity";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-outbound-auth-service");

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

function makeIntent(
  overrides: Partial<OutboundEmailIntentEntity> = {}
): OutboundEmailIntentEntity {
  const e = new OutboundEmailIntentEntity();
  e.conversationId = "conv-1";
  e.sourceUserMessageId = "msg-1";
  e.mode = "send_now";
  e.reasonCode = "explicit_send_instruction";
  e.confidence = 1;
  e.evidenceJson = "[]";
  e.sourceTextHash = "a".repeat(64);
  e.resolverVersion = "outbound-resolver-v1";
  e.previousAssistantMessageId = null;
  return Object.assign(e, overrides);
}

function makeBatch(
  overrides: Partial<OutboundEmailDraftBatchEntity> = {}
): OutboundEmailDraftBatchEntity {
  const e = new OutboundEmailDraftBatchEntity();
  e.conversationId = "conv-1";
  e.sourceUserMessageId = "msg-1";
  e.intentDecisionId = 1;
  e.status = "draft_ready";
  e.recipientSourceType = "direct";
  e.recipientCount = 1;
  e.validRecipientCount = 1;
  e.emailServiceIdsJson = "[1]";
  e.batchHash = "a".repeat(64);
  return Object.assign(e, overrides);
}

async function seedIntentAndBatch(
  draftModel: OutboundEmailDraftModel,
  intent: OutboundEmailIntentEntity,
  batch: OutboundEmailDraftBatchEntity
): Promise<{ intentId: number; batchId: number }> {
  await SqliteDb.ensureInitialized();
  // Persist the intent via the intent model so it has a real id.
  const { OutboundEmailIntentModel } = await import(
    "@/model/OutboundEmailIntent.model"
  );
  const intentModel = new OutboundEmailIntentModel(tmpDir);
  const createdIntent = await intentModel.create(intent);
  batch.intentDecisionId = createdIntent.id;
  const createdBatch = await draftModel.createBatch(batch);
  return { intentId: createdIntent.id, batchId: createdBatch.id };
}

describe("OutboundEmailAuthorizationService.createDirectSendAuthorization", () => {
  it("creates an explicit_user_instruction authorization when all conditions hold", async () => {
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const service = new OutboundEmailAuthorizationService(tmpDir);
    const { intentId, batchId } = await seedIntentAndBatch(
      draftModel,
      makeIntent(),
      makeBatch()
    );

    const result = await service.createDirectSendAuthorization({
      intentDecisionId: intentId,
      batchId,
      sourceUserMessageId: "msg-1",
      conversationId: "conv-1",
      batchHash: "a".repeat(64),
    });

    expect(result.success).toBe(true);
    expect(result.authorizationId).toBeTypeOf("number");
    expect(result.type).toBe("explicit_user_instruction");

    // Exactly one active authorization for the batch.
    const authModel = new OutboundEmailAuthorizationModel(tmpDir);
    const active = await authModel.findActiveByBatch(batchId);
    expect(active).not.toBeNull();
    expect(active?.type).toBe("explicit_user_instruction");
  });

  it("rejects when the intent mode is not send_now", async () => {
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const service = new OutboundEmailAuthorizationService(tmpDir);
    const { intentId, batchId } = await seedIntentAndBatch(
      draftModel,
      makeIntent({ mode: "review_first" }),
      makeBatch()
    );

    const result = await service.createDirectSendAuthorization({
      intentDecisionId: intentId,
      batchId,
      sourceUserMessageId: "msg-1",
      conversationId: "conv-1",
      batchHash: "a".repeat(64),
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("intent_not_send_now");
  });

  it("rejects when the source user message does not match the intent", async () => {
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const service = new OutboundEmailAuthorizationService(tmpDir);
    const { intentId, batchId } = await seedIntentAndBatch(
      draftModel,
      makeIntent(),
      makeBatch()
    );

    const result = await service.createDirectSendAuthorization({
      intentDecisionId: intentId,
      batchId,
      sourceUserMessageId: "different-message",
      conversationId: "conv-1",
      batchHash: "a".repeat(64),
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("source_message_mismatch");
  });

  it("rejects when the batch hash does not match the intent-batch binding", async () => {
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const service = new OutboundEmailAuthorizationService(tmpDir);
    const { intentId, batchId } = await seedIntentAndBatch(
      draftModel,
      makeIntent(),
      makeBatch({ batchHash: "a".repeat(64) })
    );

    const result = await service.createDirectSendAuthorization({
      intentDecisionId: intentId,
      batchId,
      sourceUserMessageId: "msg-1",
      conversationId: "conv-1",
      batchHash: "b".repeat(64),
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("batch_hash_mismatch");
  });
});

describe("OutboundEmailAuthorizationService.createReviewApproval", () => {
  it("returns the raw token once and stores only its SHA-256 hash", async () => {
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const service = new OutboundEmailAuthorizationService(tmpDir);
    const { batchId } = await seedIntentAndBatch(
      draftModel,
      makeIntent({ mode: "review_first" }),
      makeBatch({ batchHash: "c".repeat(64) })
    );

    const result = await service.createReviewApproval({
      batchId,
      batchHash: "c".repeat(64),
      sourceUserMessageId: "msg-1",
    });

    expect(result.success).toBe(true);
    expect(result.authorizationId).toBeTypeOf("number");
    expect(result.token).toMatch(/^[0-9a-f]+$/);
    expect(result.token!.length).toBeGreaterThan(0);

    // The stored authorization holds only the hash, never the raw token.
    const authModel = new OutboundEmailAuthorizationModel(tmpDir);
    const active = await authModel.findActiveByBatch(batchId);
    expect(active?.tokenHash).not.toBe(result.token);
    expect(active?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(active?.type).toBe("exact_draft_approval");
  });
});

describe("OutboundEmailAuthorizationService.invalidateOnRevisionChange", () => {
  it("invalidates the active authorization when content changes", async () => {
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const service = new OutboundEmailAuthorizationService(tmpDir);
    const { intentId, batchId } = await seedIntentAndBatch(
      draftModel,
      makeIntent(),
      makeBatch()
    );

    const created = await service.createDirectSendAuthorization({
      intentDecisionId: intentId,
      batchId,
      sourceUserMessageId: "msg-1",
      conversationId: "conv-1",
      batchHash: "a".repeat(64),
    });
    expect(created.success).toBe(true);

    await service.invalidateOnRevisionChange(batchId, "content_edited");

    const authModel = new OutboundEmailAuthorizationModel(tmpDir);
    const active = await authModel.findActiveByBatch(batchId);
    expect(active).toBeNull();
    const read = await authModel.read(created.authorizationId!);
    expect(read?.status).toBe("invalidated");
    expect(read?.invalidationReason).toBe("content_edited");
  });
});

describe("OutboundEmailAuthorizationService.resolveDirectSendForTurn", () => {
  /**
   * This is the orchestrating seam the outbound-email tool gate calls (RC1,
   * technical design §13.1 + §14.2). Given the trusted turn identity
   * (conversationId + sourceUserMessageId) and the persisted intent decision
   * id, it must locate the turn's draft_ready batch, create (or reuse) an
   * explicit_user_instruction authorization, and return the
   * {batchId, authorizationId, batchHash} triple the gate needs to allow a
   * send and the delivery service needs to claim (§15.1 idempotency key).
   */
  it("creates a direct-send authorization and returns the claim triple for a send_now turn", async () => {
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const service = new OutboundEmailAuthorizationService(tmpDir);
    const { intentId, batchId } = await seedIntentAndBatch(
      draftModel,
      makeIntent(),
      makeBatch({ batchHash: "a".repeat(64) })
    );

    const result = await service.resolveDirectSendForTurn({
      conversationId: "conv-1",
      sourceUserMessageId: "msg-1",
      intentDecisionId: intentId,
    });

    expect(result).not.toBeNull();
    expect(result!.batchId).toBe(batchId);
    expect(result!.authorizationId).toBeTypeOf("number");
    expect(result!.batchHash).toBe("a".repeat(64));

    // The batch is now direct_authorized — the status the claim transaction
    // requires (§8.1 lifecycle).
    const batch = await draftModel.readBatch(batchId);
    expect(batch?.status).toBe("direct_authorized");
    expect(batch?.authorizationId).toBe(result!.authorizationId);
  });

  it("reuses the existing active authorization instead of erroring when already authorized", async () => {
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const service = new OutboundEmailAuthorizationService(tmpDir);
    const { intentId, batchId } = await seedIntentAndBatch(
      draftModel,
      makeIntent(),
      makeBatch()
    );

    // First call creates the authorization.
    const first = await service.resolveDirectSendForTurn({
      conversationId: "conv-1",
      sourceUserMessageId: "msg-1",
      intentDecisionId: intentId,
    });
    expect(first).not.toBeNull();

    // Second call for the SAME turn must reuse the same authorization, not
    // fail with authorization_already_active. This is the idempotent retry
    // path: the model may re-call the send tool after the gate allows.
    const second = await service.resolveDirectSendForTurn({
      conversationId: "conv-1",
      sourceUserMessageId: "msg-1",
      intentDecisionId: intentId,
    });
    expect(second).not.toBeNull();
    expect(second!.authorizationId).toBe(first!.authorizationId);
    expect(second!.batchId).toBe(batchId);
  });

  it("returns null when no authorizable batch exists for the turn", async () => {
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const service = new OutboundEmailAuthorizationService(tmpDir);
    const { intentId } = await seedIntentAndBatch(
      draftModel,
      makeIntent(),
      makeBatch({ status: "sent" }) // terminal — not authorizable
    );

    const result = await service.resolveDirectSendForTurn({
      conversationId: "conv-1",
      sourceUserMessageId: "msg-1",
      intentDecisionId: intentId,
    });
    expect(result).toBeNull();
  });

  it("returns null when the intent mode is not send_now", async () => {
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const service = new OutboundEmailAuthorizationService(tmpDir);
    const { intentId } = await seedIntentAndBatch(
      draftModel,
      makeIntent({ mode: "review_first" }),
      makeBatch()
    );

    const result = await service.resolveDirectSendForTurn({
      conversationId: "conv-1",
      sourceUserMessageId: "msg-1",
      intentDecisionId: intentId,
    });
    expect(result).toBeNull();
  });

  it("picks the newest authorizable batch when several exist for the turn", async () => {
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const service = new OutboundEmailAuthorizationService(tmpDir);
    const { intentId } = await seedIntentAndBatch(
      draftModel,
      makeIntent(),
      makeBatch({ batchHash: "a".repeat(64) })
    );
    // A second, newer draft_ready batch for the SAME turn.
    const newer = await draftModel.createBatch(
      makeBatch({ batchHash: "b".repeat(64) })
    );
    // Point the newer batch at the same intent (seedIntentAndBatch wired the
    // first batch's intentDecisionId; the newer one reuses the id too).
    await draftModel.updateBatchStatus(newer.id, "draft_ready", {
      intentDecisionId: intentId,
    });

    const result = await service.resolveDirectSendForTurn({
      conversationId: "conv-1",
      sourceUserMessageId: "msg-1",
      intentDecisionId: intentId,
    });
    expect(result).not.toBeNull();
    expect(result!.batchId).toBe(newer.id);
    expect(result!.batchHash).toBe("b".repeat(64));
  });
});
