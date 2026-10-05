import { describe, expect, it, beforeEach, vi } from "vitest";
import { OutboundEmailDeliveryService } from "@/service/outboundEmail/OutboundEmailDeliveryService";
import type { ClaimResult } from "@/service/outboundEmail/OutboundEmailDeliveryService";
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

/**
 * §15.5 `sender_identity_changed` gate — the mismatch path of
 * `verifyIdentityNotChanged`. The companion suite
 * (OutboundEmailDeliveryService.test.ts) seeds identity-matching services so
 * every claim in it exercises the PASS side of this gate. This file locks the
 * FAIL side: when the service identity was edited after approval, the claim
 * must (a) return `sender_identity_changed` (no attemptId), (b) mark the
 * committed attempt + pending outcomes + batch failed via
 * handleWorkerStartFailure, and (c) never start the worker.
 */

const tmpDir = path.join(os.tmpdir(), "aifetchly-outbound-identity-changed");

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

async function seedEmailService(): Promise<void> {
  const { EmailServiceModel } = await import("@/model/EmailService.model");
  const { EmailServiceEntity } = await import("@/entity/EmailService.entity");
  const model = new EmailServiceModel(tmpDir);
  const entity = new EmailServiceEntity();
  entity.id = 1;
  entity.name = "Primary";
  entity.from = "sender@example.com";
  entity.smtpUsername = null;
  entity.replyTo = null;
  entity.password = "secret";
  entity.host = "smtp.example.com";
  entity.port = "465";
  entity.ssl = 1;
  entity.status = 1;
  await model.create(entity);
}

/**
 * Mutate service 1's identity AFTER approval so the §15.5 reload at claim
 * time finds a row that no longer matches the frozen revision.
 */
async function mutateServiceIdentity(
  patch: Partial<{
    smtpUsername: string | null;
    replyTo: string | null;
    from: string;
  }>
): Promise<void> {
  const { EmailServiceModel } = await import("@/model/EmailService.model");
  const { EmailServiceEntity } = await import("@/entity/EmailService.entity");
  const model = new EmailServiceModel(tmpDir);
  const entity = new EmailServiceEntity();
  if (patch.smtpUsername !== undefined)
    entity.smtpUsername = patch.smtpUsername;
  if (patch.replyTo !== undefined) entity.replyTo = patch.replyTo;
  if (patch.from !== undefined) entity.from = patch.from;
  await model.update(1, entity);
}

async function seedAuthorizedBatch(): Promise<{
  batchId: number;
  batchHash: string;
  authorizationId: number;
}> {
  SqliteDb.getInstance(tmpDir);
  await SqliteDb.ensureInitialized();
  await seedEmailService();
  const draftService = new OutboundEmailDraftService(tmpDir, {
    aiEnabledOverride: true,
  });
  const generated = await draftService.generateBatch({
    conversationId: "conv-identity",
    sourceUserMessageId: "msg-identity",
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
  intent.conversationId = "conv-identity";
  intent.sourceUserMessageId = "msg-identity";
  intent.mode = "send_now";
  intent.reasonCode = "explicit_send_instruction";
  intent.confidence = 1;
  intent.evidenceJson = "[]";
  intent.sourceTextHash = "d".repeat(64);
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
    sourceUserMessageId: "msg-identity",
    conversationId: "conv-identity",
    batchHash: generated.batchHash!,
  });
  expect(auth.success).toBe(true);

  return {
    batchId: generated.batchId!,
    batchHash: generated.batchHash!,
    authorizationId: auth.authorizationId!,
  };
}

describe("OutboundEmailDeliveryService.claim §15.5 sender_identity_changed", () => {
  it("fails the claim with sender_identity_changed (no attemptId, worker never started, attempt marked failed) when replyTo is edited after approval", async () => {
    const seed = await seedAuthorizedBatch();

    // Edit the service Reply-To after approval. The frozen revision says
    // replyToAddress=null; the reloaded row now says replies@example.com.
    await mutateServiceIdentity({ replyTo: "replies@example.com" });

    const workerStarter = vi.fn(async () => ({ started: true }));
    const service = new OutboundEmailDeliveryService(tmpDir, {
      workerStarter,
    });

    const result: ClaimResult = await service.claim({
      batchId: seed.batchId,
      authorizationId: seed.authorizationId,
      batchHash: seed.batchHash,
    });

    // §15.5 — stable status, no attempt surfaced to the caller.
    expect(result.status).toBe("sender_identity_changed");
    expect("attemptId" in result).toBe(false);

    // The worker was never started (no SMTP capacity consumed).
    expect(workerStarter).not.toHaveBeenCalled();

    // The committed attempt was routed through handleWorkerStartFailure:
    // attempt failed, pending outcome failed, batch failed.
    const deliveryModel = new OutboundEmailDeliveryModel(tmpDir);
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const batch = await draftModel.readBatch(seed.batchId);
    expect(batch?.status).toBe("failed");
    const outcomes = await deliveryModel.listOutcomesByBatch(seed.batchId);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe("failed");
    expect(outcomes[0].errorCode).toBe("worker_start_failed");

    // The authorization was consumed (the claim transaction committed before
    // the identity reload) — a retry requires a fresh approval.
    const authModel = new OutboundEmailAuthorizationModel(tmpDir);
    const active = await authModel.findActiveByBatch(seed.batchId);
    expect(active).toBeNull();
  });

  it("fails the claim with sender_identity_changed when smtpUsername is edited after approval", async () => {
    const seed = await seedAuthorizedBatch();

    // Frozen revision: smtpUsername resolves to from ("sender@example.com").
    // Edit the row so the effective SMTP login differs.
    await mutateServiceIdentity({ smtpUsername: "legacy-login@example.com" });

    const workerStarter = vi.fn(async () => ({ started: true }));
    const service = new OutboundEmailDeliveryService(tmpDir, {
      workerStarter,
    });

    const result = await service.claim({
      batchId: seed.batchId,
      authorizationId: seed.authorizationId,
      batchHash: seed.batchHash,
    });

    expect(result.status).toBe("sender_identity_changed");
    expect(workerStarter).not.toHaveBeenCalled();
  });

  it("fails the claim with sender_identity_changed when the service row is deleted after approval", async () => {
    const seed = await seedAuthorizedBatch();

    // Service deleted between approval and delivery — readIdentity(1) returns
    // null and the gate must fail closed.
    const { EmailServiceModel } = await import("@/model/EmailService.model");
    await new EmailServiceModel(tmpDir).delete(1);

    const workerStarter = vi.fn(async () => ({ started: true }));
    const service = new OutboundEmailDeliveryService(tmpDir, {
      workerStarter,
    });

    const result = await service.claim({
      batchId: seed.batchId,
      authorizationId: seed.authorizationId,
      batchHash: seed.batchHash,
    });

    expect(result.status).toBe("sender_identity_changed");
    expect(workerStarter).not.toHaveBeenCalled();
  });
});
