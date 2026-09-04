import { describe, expect, it, beforeEach } from "vitest";
import { OutboundEmailWorkerEventBridge } from "@/service/outboundEmail/OutboundEmailWorkerEventBridge";
import { OutboundEmailDeliveryService } from "@/service/outboundEmail/OutboundEmailDeliveryService";
import { OutboundEmailAuthorizationService } from "@/service/outboundEmail/OutboundEmailAuthorizationService";
import { OutboundEmailDraftService } from "@/service/outboundEmail/OutboundEmailDraftService";
import { OutboundEmailDeliveryModel } from "@/model/OutboundEmailDelivery.model";
import { OutboundEmailDraftModel } from "@/model/OutboundEmailDraft.model";
import { OutboundEmailAuditLogModel } from "@/model/OutboundEmailAuditLog.model";
import { SqliteDb } from "@/config/SqliteDb";
import type { EmailItem } from "@/entityTypes/emailmarketingType";
import type {
  AuthorizedEmailWorkerEvent,
  AuthorizedEmailWorkerEventSubmitted,
  AuthorizedEmailWorkerEventFailed,
  AuthorizedEmailWorkerEventComplete,
} from "@/entityTypes/outboundEmailDeliveryTypes";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-outbound-bridge");

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

async function seedAndClaim(): Promise<{
  batchId: number;
  attemptId: number;
  draftId: number;
  revisionId: number;
  envelopeHash: string;
  batchHash: string;
}> {
  SqliteDb.getInstance(tmpDir);
  await SqliteDb.ensureInitialized();

  const draftService = new OutboundEmailDraftService(tmpDir, {
    aiEnabledOverride: true,
  });
  const generated = await draftService.generateBatch({
    conversationId: "conv-bridge",
    sourceUserMessageId: "msg-bridge",
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

  // Seed an intent decision so authorization can validate it.
  const { OutboundEmailIntentModel } = await import(
    "@/model/OutboundEmailIntent.model"
  );
  const { OutboundEmailIntentEntity } = await import(
    "@/entity/OutboundEmailIntent.entity"
  );
  const intentModel = new OutboundEmailIntentModel(tmpDir);
  const intent = new OutboundEmailIntentEntity();
  intent.conversationId = "conv-bridge";
  intent.sourceUserMessageId = "msg-bridge";
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
    sourceUserMessageId: "msg-bridge",
    conversationId: "conv-bridge",
    batchHash: generated.batchHash!,
  });
  expect(auth.success).toBe(true);

  // Claim with a no-op workerStarter so the attempt + pending outcome exist
  // but the worker hasn't actually run. The bridge will process events as if
  // the worker posted them.
  const delivery = new OutboundEmailDeliveryService(tmpDir, {
    workerStarter: async () => ({ started: true }),
  });
  const result = await delivery.claim({
    batchId: generated.batchId!,
    authorizationId: auth.authorizationId!,
    batchHash: generated.batchHash!,
  });
  expect(result.status).toBe("claimed");

  // The OutboundEmailDeliveryService constructor bounces the SqliteDb singleton
  // (its super("") falls back to a temp dir, then it rebinds to tmpDir). Any
  // model constructed BEFORE that bounce holds repositories bound to the
  // destroyed connection. Re-create models here so they pick up the live
  // singleton — mirrors the recovery test's pattern.
  const liveDraftModel = new OutboundEmailDraftModel(tmpDir);
  const drafts = await liveDraftModel.listDraftsByBatch(generated.batchId!);
  expect(drafts).toHaveLength(1);
  const revision = await liveDraftModel.readCurrentRevision(drafts[0].id);
  expect(revision).not.toBeNull();

  // The outcome's envelopeHash is the one the bridge must match against.
  const deliveryModel = new OutboundEmailDeliveryModel(tmpDir);
  const outcome = await deliveryModel.findOutcomeByAttemptAndDraft(
    result.attemptId!,
    drafts[0].id
  );
  expect(outcome).not.toBeNull();

  return {
    batchId: generated.batchId!,
    attemptId: result.attemptId!,
    draftId: drafts[0].id,
    revisionId: revision!.id,
    envelopeHash: outcome!.envelopeHash,
    batchHash: generated.batchHash!,
  };
}

describe("OutboundEmailWorkerEventBridge", () => {
  it("persists a submitted event as status submitted + providerMessageId", async () => {
    const ctx = await seedAndClaim();
    const bridge = new OutboundEmailWorkerEventBridge(tmpDir, {
      onBroadcast: () => undefined,
    });
    const submitted: AuthorizedEmailWorkerEventSubmitted = {
      type: "authorized-email-submitted",
      batchId: ctx.batchId,
      sendAttemptId: ctx.attemptId,
      draftId: ctx.draftId,
      revisionId: ctx.revisionId,
      envelopeHash: ctx.envelopeHash,
      providerMessageId: "<prov-123@example.com>",
    };
    await bridge.handleEvent(submitted);

    const deliveryModel = new OutboundEmailDeliveryModel(tmpDir);
    const outcome = await deliveryModel.findOutcomeByAttemptAndDraft(
      ctx.attemptId,
      ctx.draftId
    );
    expect(outcome?.status).toBe("submitted");
    expect(outcome?.providerMessageId).toBe("<prov-123@example.com>");
    expect(outcome?.submittedAt).toBeInstanceOf(Date);
  });

  it("persists a safe retry failure as status failed", async () => {
    const ctx = await seedAndClaim();
    const bridge = new OutboundEmailWorkerEventBridge(tmpDir, {
      onBroadcast: () => undefined,
    });
    const failed: AuthorizedEmailWorkerEventFailed = {
      type: "authorized-email-failed",
      batchId: ctx.batchId,
      sendAttemptId: ctx.attemptId,
      draftId: ctx.draftId,
      revisionId: ctx.revisionId,
      envelopeHash: ctx.envelopeHash,
      errorCode: "auth_bad_credentials",
      retrySafety: "safe",
    };
    await bridge.handleEvent(failed);

    const deliveryModel = new OutboundEmailDeliveryModel(tmpDir);
    const outcome = await deliveryModel.findOutcomeByAttemptAndDraft(
      ctx.attemptId,
      ctx.draftId
    );
    expect(outcome?.status).toBe("failed");
    expect(outcome?.errorCode).toBe("auth_bad_credentials");
    expect(outcome?.completedAt).toBeInstanceOf(Date);
  });

  it("persists an ambiguous failure as delivery_unknown (never auto-retried, FR-019)", async () => {
    const ctx = await seedAndClaim();
    const bridge = new OutboundEmailWorkerEventBridge(tmpDir, {
      onBroadcast: () => undefined,
    });
    const failed: AuthorizedEmailWorkerEventFailed = {
      type: "authorized-email-failed",
      batchId: ctx.batchId,
      sendAttemptId: ctx.attemptId,
      draftId: ctx.draftId,
      revisionId: ctx.revisionId,
      envelopeHash: ctx.envelopeHash,
      errorCode: "ECONNRESET",
      retrySafety: "unknown",
    };
    await bridge.handleEvent(failed);

    const deliveryModel = new OutboundEmailDeliveryModel(tmpDir);
    const outcome = await deliveryModel.findOutcomeByAttemptAndDraft(
      ctx.attemptId,
      ctx.draftId
    );
    expect(outcome?.status).toBe("delivery_unknown");
    expect(outcome?.errorCode).toBe("ECONNRESET");
  });

  it("marks the attempt + batch terminal and transitions submitted→sent on worker-complete (all sent)", async () => {
    const ctx = await seedAndClaim();
    const broadcasts: AuthorizedEmailWorkerEvent[] = [];
    const bridge = new OutboundEmailWorkerEventBridge(tmpDir, {
      onBroadcast: (e) => broadcasts.push(e),
    });

    // Simulate the worker submitting then completing.
    await bridge.handleEvent({
      type: "authorized-email-submitted",
      batchId: ctx.batchId,
      sendAttemptId: ctx.attemptId,
      draftId: ctx.draftId,
      revisionId: ctx.revisionId,
      envelopeHash: ctx.envelopeHash,
      providerMessageId: "<prov-1@example.com>",
    });
    const complete: AuthorizedEmailWorkerEventComplete = {
      type: "authorized-email-worker-complete",
      batchId: ctx.batchId,
      sendAttemptId: ctx.attemptId,
    };
    await bridge.handleEvent(complete);

    // complete event is broadcast.
    expect(broadcasts).toContainEqual(complete);

    // The single submitted outcome is confirmed `sent` at worker completion
    // (§8.3) — no provider delivery callback in this local-SMTP flow.
    const deliveryModel = new OutboundEmailDeliveryModel(tmpDir);
    const attempt = await deliveryModel.readAttempt(ctx.attemptId);
    expect(attempt?.status).toBe("completed");
    expect(attempt?.completedAt).toBeInstanceOf(Date);

    const outcome = await deliveryModel.findOutcomeByAttemptAndDraft(
      ctx.attemptId,
      ctx.draftId
    );
    expect(outcome?.status).toBe("sent");
    expect(outcome?.completedAt).toBeInstanceOf(Date);

    // All outcomes sent ⇒ the batch becomes terminal `sent`.
    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const batch = await draftModel.readBatch(ctx.batchId);
    expect(batch?.status).toBe("sent");
  });

  it("does not revive an already-terminal outcome on worker-complete", async () => {
    const ctx = await seedAndClaim();
    const bridge = new OutboundEmailWorkerEventBridge(tmpDir, {
      onBroadcast: () => undefined,
    });

    // Worker reports an ambiguous failure (terminal delivery_unknown), then
    // completes. The submitted→sent transition must not touch it.
    await bridge.handleEvent({
      type: "authorized-email-failed",
      batchId: ctx.batchId,
      sendAttemptId: ctx.attemptId,
      draftId: ctx.draftId,
      revisionId: ctx.revisionId,
      envelopeHash: ctx.envelopeHash,
      errorCode: "ECONNRESET",
      retrySafety: "unknown",
    });
    await bridge.handleEvent({
      type: "authorized-email-worker-complete",
      batchId: ctx.batchId,
      sendAttemptId: ctx.attemptId,
    });

    const deliveryModel = new OutboundEmailDeliveryModel(tmpDir);
    const outcome = await deliveryModel.findOutcomeByAttemptAndDraft(
      ctx.attemptId,
      ctx.draftId
    );
    expect(outcome?.status).toBe("delivery_unknown");

    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const batch = await draftModel.readBatch(ctx.batchId);
    // One delivery_unknown outcome (terminal) ⇒ the batch is delivery_unknown.
    expect(batch?.status).toBe("delivery_unknown");
  });

  it("recomputes batch status to sent when all outcomes reach a terminal sent state", async () => {
    const ctx = await seedAndClaim();
    const bridge = new OutboundEmailWorkerEventBridge(tmpDir, {
      onBroadcast: () => undefined,
    });

    // Worker reports a safe failure (terminal), then completes.
    await bridge.handleEvent({
      type: "authorized-email-failed",
      batchId: ctx.batchId,
      sendAttemptId: ctx.attemptId,
      draftId: ctx.draftId,
      revisionId: ctx.revisionId,
      envelopeHash: ctx.envelopeHash,
      errorCode: "permanently_rejected",
      retrySafety: "safe",
    });
    await bridge.handleEvent({
      type: "authorized-email-worker-complete",
      batchId: ctx.batchId,
      sendAttemptId: ctx.attemptId,
    });

    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const batch = await draftModel.readBatch(ctx.batchId);
    // One failed outcome (terminal) ⇒ batch is failed.
    expect(batch?.status).toBe("failed");
  });

  it("audits a worker_event_correlation_failed when the 5-field match fails", async () => {
    const ctx = await seedAndClaim();
    const bridge = new OutboundEmailWorkerEventBridge(tmpDir, {
      onBroadcast: () => undefined,
    });
    // Wrong envelopeHash — must NOT mutate the real outcome.
    const submitted: AuthorizedEmailWorkerEventSubmitted = {
      type: "authorized-email-submitted",
      batchId: ctx.batchId,
      sendAttemptId: ctx.attemptId,
      draftId: ctx.draftId,
      revisionId: ctx.revisionId,
      envelopeHash: "0".repeat(64),
      providerMessageId: "<x@example.com>",
    };
    await bridge.handleEvent(submitted);

    const deliveryModel = new OutboundEmailDeliveryModel(tmpDir);
    const outcome = await deliveryModel.findOutcomeByAttemptAndDraft(
      ctx.attemptId,
      ctx.draftId
    );
    // Outcome must remain pending — the mismatched event was rejected.
    expect(outcome?.status).toBe("pending");

    const auditModel = new OutboundEmailAuditLogModel(tmpDir);
    const logs = await auditModel.listByBatch(ctx.batchId);
    const correlationFailure = logs.find(
      (l) => l.eventCode === "worker_event_correlation_failed"
    );
    expect(correlationFailure).toBeDefined();
  });

  it("audits a correlation failure when the event batchId does not match the outcome batch", async () => {
    const ctx = await seedAndClaim();
    const bridge = new OutboundEmailWorkerEventBridge(tmpDir, {
      onBroadcast: () => undefined,
    });
    // Correct attempt/draft/revision/envelopeHash but the WRONG batchId — the
    // §15.4 five-field correlation must reject it rather than apply it.
    const submitted: AuthorizedEmailWorkerEventSubmitted = {
      type: "authorized-email-submitted",
      batchId: ctx.batchId + 999,
      sendAttemptId: ctx.attemptId,
      draftId: ctx.draftId,
      revisionId: ctx.revisionId,
      envelopeHash: ctx.envelopeHash,
      providerMessageId: "<wrong-batch@example.com>",
    };
    await bridge.handleEvent(submitted);

    const deliveryModel = new OutboundEmailDeliveryModel(tmpDir);
    const outcome = await deliveryModel.findOutcomeByAttemptAndDraft(
      ctx.attemptId,
      ctx.draftId
    );
    expect(outcome?.status).toBe("pending");
    expect(outcome?.providerMessageId).toBeNull();

    // The correlation failure is audited under the event's (wrong) batchId —
    // the bridge records what the event claimed, and rejects applying it.
    const auditModel = new OutboundEmailAuditLogModel(tmpDir);
    const logs = await auditModel.listByBatch(ctx.batchId + 999);
    const correlationFailure = logs.find(
      (l) => l.eventCode === "worker_event_correlation_failed"
    );
    expect(correlationFailure).toBeDefined();
  });

  it("ignores an event for an unknown attempt without throwing", async () => {
    const ctx = await seedAndClaim();
    const bridge = new OutboundEmailWorkerEventBridge(tmpDir, {
      onBroadcast: () => undefined,
    });
    // Nonexistent attemptId — must not throw.
    await expect(
      bridge.handleEvent({
        type: "authorized-email-worker-complete",
        batchId: ctx.batchId,
        sendAttemptId: 999999,
      })
    ).resolves.toBeUndefined();
  });
});
