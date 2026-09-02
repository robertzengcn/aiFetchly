import { describe, expect, it, beforeEach } from "vitest";
import { OutboundEmailAuthorizationModel } from "@/model/OutboundEmailAuthorization.model";
import { OutboundEmailDeliveryModel } from "@/model/OutboundEmailDelivery.model";
import { OutboundEmailAuthorizationEntity } from "@/entity/OutboundEmailAuthorization.entity";
import { OutboundEmailSendAttemptEntity } from "@/entity/OutboundEmailSendAttempt.entity";
import { OutboundEmailDeliveryOutcomeEntity } from "@/entity/OutboundEmailDeliveryOutcome.entity";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-outbound-auth-model");

function buildAuthorization(
  overrides: Partial<OutboundEmailAuthorizationEntity> = {}
): OutboundEmailAuthorizationEntity {
  const e = new OutboundEmailAuthorizationEntity();
  e.batchId = 1;
  e.type = "explicit_user_instruction";
  e.sourceUserMessageId = "msg-1";
  e.intentDecisionId = 1;
  e.batchHash = "a".repeat(64);
  e.tokenHash = null;
  e.status = "active";
  e.expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  return Object.assign(e, overrides);
}

function buildAttempt(
  overrides: Partial<OutboundEmailSendAttemptEntity> = {}
): OutboundEmailSendAttemptEntity {
  const e = new OutboundEmailSendAttemptEntity();
  e.batchId = 1;
  e.authorizationId = 1;
  e.batchHash = "a".repeat(64);
  e.idempotencyKey = "outbound-email:v1:1:1:" + "a".repeat(64);
  e.status = "claimed";
  e.claimedAt = new Date();
  return Object.assign(e, overrides);
}

function buildOutcome(
  overrides: Partial<OutboundEmailDeliveryOutcomeEntity> = {}
): OutboundEmailDeliveryOutcomeEntity {
  const e = new OutboundEmailDeliveryOutcomeEntity();
  e.sendAttemptId = 1;
  e.batchId = 1;
  e.draftId = 1;
  e.revisionId = 1;
  e.envelopeHash = "a".repeat(64);
  e.recipientAddress = "a@example.com";
  e.status = "submitted";
  return Object.assign(e, overrides);
}

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
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
});

describe("OutboundEmailAuthorizationModel", () => {
  it("creates and reads an authorization", async () => {
    const model = new OutboundEmailAuthorizationModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const created = await model.create(buildAuthorization());
    expect(typeof created.id).toBe("number");
    const found = await model.read(created.id);
    expect(found?.batchId).toBe(1);
    expect(found?.status).toBe("active");
  });

  it("finds the single active authorization for a batch", async () => {
    const model = new OutboundEmailAuthorizationModel(tmpDir);
    await SqliteDb.ensureInitialized();
    await model.create(buildAuthorization());
    const active = await model.findActiveByBatch(1);
    expect(active).not.toBeNull();
    expect(active?.status).toBe("active");
  });

  it("marks an authorization consumed", async () => {
    const model = new OutboundEmailAuthorizationModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const created = await model.create(buildAuthorization());
    await model.consume(created.id, new Date());
    const found = await model.read(created.id);
    expect(found?.status).toBe("consumed");
    expect(found?.consumedAt).not.toBeNull();
  });
});

describe("OutboundEmailDeliveryModel", () => {
  it("creates a send attempt and enforces a unique idempotency key", async () => {
    const model = new OutboundEmailDeliveryModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const created = await model.createAttempt(buildAttempt());
    expect(typeof created.id).toBe("number");
    await expect(
      model.createAttempt(buildAttempt())
    ).rejects.toThrow();
  });

  it("creates a delivery outcome and enforces unique (sendAttemptId, draftId)", async () => {
    const model = new OutboundEmailDeliveryModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const created = await model.createOutcome(buildOutcome());
    expect(typeof created.id).toBe("number");
    await expect(
      model.createOutcome(buildOutcome())
    ).rejects.toThrow();
  });

  it("lists outcomes for a send attempt", async () => {
    const model = new OutboundEmailDeliveryModel(tmpDir);
    await SqliteDb.ensureInitialized();
    await model.createOutcome(buildOutcome());
    await model.createOutcome(buildOutcome({ draftId: 2 }));
    const outcomes = await model.listOutcomesByAttempt(1);
    expect(outcomes).toHaveLength(2);
  });
});