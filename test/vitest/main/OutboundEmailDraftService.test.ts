import { describe, expect, it, beforeEach } from "vitest";
import { OutboundEmailDraftService } from "@/service/outboundEmail/OutboundEmailDraftService";
import { OutboundEmailDraftModel } from "@/model/OutboundEmailDraft.model";
import { EmailServiceModel } from "@/model/EmailService.model";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import { OutboundEmailDraftBatchEntity } from "@/entity/OutboundEmailDraftBatch.entity";
import { OutboundEmailDraftEntity } from "@/entity/OutboundEmailDraft.entity";
import { OutboundEmailEnvelopeHasher } from "@/service/outboundEmail/OutboundEmailEnvelopeHasher";
import type { BatchEnvelopeEntryV2 } from "@/service/outboundEmail/OutboundEmailEnvelopeHasher";
import { SqliteDb } from "@/config/SqliteDb";
import type { EmailItem } from "@/entityTypes/emailmarketingType";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-outbound-draft-service");

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
  return [
    { address: "Alpha@Example.com", title: "Alpha", source: "direct" },
    { address: "alpha@example.com", title: "Alpha again", source: "direct" },
    { address: "beta@example.com", title: "Beta", source: "direct" },
  ];
}

describe("OutboundEmailDraftService.materializeRecipients", () => {
  const service = new OutboundEmailDraftService(tmpDir, {
    aiEnabledOverride: true,
  });

  it("canonicalizes and dedupes by case-insensitive address", () => {
    const result = service.materializeRecipients(recipients());
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.address)).toEqual([
      "alpha@example.com",
      "beta@example.com",
    ]);
    // The first occurrence wins (its title/source preserved).
    expect(result[0].title).toBe("Alpha");
  });

  it("trims whitespace from addresses", () => {
    const result = service.materializeRecipients([
      { address: "  gamma@example.com  ", source: "direct" },
    ]);
    expect(result[0].address).toBe("gamma@example.com");
  });
});

describe("OutboundEmailDraftService.generateBatch", () => {
  it("returns ai_disabled when the AI entitlement is disabled", async () => {
    const disabled = new OutboundEmailDraftService(tmpDir, {
      aiEnabledOverride: false,
    });
    const result = await disabled.generateBatch({
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
    expect(result.success).toBe(false);
    expect(result.code).toBe("ai_disabled");
  });

  it("materializes recipients into one draft each with an immutable revision", async () => {
    const service = new OutboundEmailDraftService(tmpDir, {
      aiEnabledOverride: true,
    });
    await SqliteDb.ensureInitialized();

    const result = await service.generateBatch({
      conversationId: "conv-1",
      sourceUserMessageId: "msg-1",
      intentDecisionId: 1,
      recipientSourceType: "direct",
      recipients: recipients(),
      serviceIds: [1],
      senderAddress: "sender@example.com",
      subject: "Hello",
      bodyText: "Hi {name}",
      bodyHtml: "<p>Hi</p>",
    });
    expect(result.success).toBe(true);
    expect(result.draftCount).toBe(2);
    expect(result.batchId).toBeTypeOf("number");

    const model = new OutboundEmailDraftModel(tmpDir);
    const drafts = await model.listDraftsByBatch(result.batchId!);
    expect(drafts).toHaveLength(2);
    expect(drafts.map((d) => d.recipientAddress).sort()).toEqual([
      "alpha@example.com",
      "beta@example.com",
    ]);

    // Every draft has a current revision with evidence.
    for (const draft of drafts) {
      expect(draft.currentRevisionId).toBeTypeOf("number");
      const revision = await model.readRevision(draft.currentRevisionId!);
      expect(revision).not.toBeNull();
      expect(revision!.subject).toBe("Hello");
      // Personalization evidence is present (§10.3).
      const evidence = JSON.parse(
        revision!.personalizationEvidenceJson ?? "[]"
      );
      expect(evidence.length).toBeGreaterThan(0);
    }

    // Batch hash pointer was set.
    const batch = await model.readBatch(result.batchId!);
    expect(batch?.batchHash).toMatch(/^[0-9a-f]{64}$/);
    // Policy/validation versions are persisted at batch creation (§15.1.7) so
    // the claim can detect a stale policy/validator before send.
    expect(batch?.policyVersion).toBe("outbound-policy-v1");
    expect(batch?.validationVersion).toBe("outbound-validation-v1");
  });

  it("creates revisions immutably (append creates a new revision, not a mutation)", async () => {
    const service = new OutboundEmailDraftService(tmpDir, {
      aiEnabledOverride: true,
    });
    await SqliteDb.ensureInitialized();

    const result = await service.generateBatch({
      conversationId: "conv-1",
      sourceUserMessageId: "msg-1",
      intentDecisionId: 1,
      recipientSourceType: "direct",
      recipients: recipients(),
      serviceIds: [1],
      senderAddress: "sender@example.com",
      subject: "V1",
      bodyText: "Body v1",
      bodyHtml: null,
    });
    expect(result.success).toBe(true);

    const model = new OutboundEmailDraftModel(tmpDir);
    const drafts = await model.listDraftsByBatch(result.batchId!);
    const draft = drafts[0];
    const firstRevision = await model.readRevision(draft.currentRevisionId!);
    expect(firstRevision!.subject).toBe("V1");

    // Appending a new revision leaves the first untouched and advances the
    // pointer (immutability, §10.4).
    const edited = await model.appendRevision({
      draftId: draft.id,
      actor: "user",
      emailServiceId: 1,
      senderAddress: "sender@example.com",
      recipientAddress: draft.recipientAddress,
      subject: "V2",
      bodyText: "Body v2",
      bodyHtml: null,
      contentHash: "b".repeat(64),
    });
    expect(edited.revisionNumber).toBe(2);

    const firstReloaded = await model.readRevision(firstRevision!.id);
    expect(firstReloaded!.subject).toBe("V1");
  });

  it("binds the SMTP from-address when generateBatch is given an empty sender", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    const serviceId = await seedSmtpService("bound-sender@example.com");
    const service = new OutboundEmailDraftService(tmpDir, {
      aiEnabledOverride: true,
    });
    const result = await service.generateBatch({
      conversationId: "conv-1",
      sourceUserMessageId: "msg-1",
      intentDecisionId: 1,
      recipientSourceType: "direct",
      recipients: recipients(),
      serviceIds: [serviceId],
      senderAddress: "",
      subject: "Hello",
      bodyText: "Hi",
      bodyHtml: null,
    });
    expect(result.success).toBe(true);
    const model = new OutboundEmailDraftModel(tmpDir);
    const drafts = await model.listDraftsByBatch(result.batchId!);
    const revision = await model.readCurrentRevision(drafts[0].id);
    expect(revision?.senderAddress).toBe("bound-sender@example.com");
    expect(revision?.emailServiceId).toBe(serviceId);
  });

  it("returns sender_address_missing when no SMTP from-address can be resolved", async () => {
    const service = new OutboundEmailDraftService(tmpDir, {
      aiEnabledOverride: true,
    });
    await SqliteDb.ensureInitialized();
    const result = await service.generateBatch({
      conversationId: "conv-1",
      sourceUserMessageId: "msg-1",
      intentDecisionId: 1,
      recipientSourceType: "direct",
      recipients: recipients(),
      serviceIds: [],
      senderAddress: "",
      subject: "Hello",
      bodyText: "Hi",
      bodyHtml: null,
    });
    expect(result.success).toBe(false);
    expect(result.code).toBe("sender_address_missing");
  });

  it("fillMissingSenders appends a revision with the SMTP from-address", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    const serviceId = await seedSmtpService("repair-sender@example.com");
    const batchId = await seedEmptySenderBatch(serviceId);
    const service = new OutboundEmailDraftService(tmpDir, {
      aiEnabledOverride: true,
    });
    const filled = await service.fillMissingSenders(batchId);
    expect(filled.changed).toBe(true);
    expect(filled.batchHash).toMatch(/^[0-9a-f]{64}$/);

    const model = new OutboundEmailDraftModel(tmpDir);
    const drafts = await model.listDraftsByBatch(batchId);
    const revision = await model.readCurrentRevision(drafts[0].id);
    expect(revision?.senderAddress).toBe("repair-sender@example.com");
    expect(revision?.revisionNumber).toBe(2);
  });

  it("creates v2 revisions with smtpUsername, replyToAddress, and envelopeVersion=2", async () => {
    const service = new OutboundEmailDraftService(tmpDir, {
      aiEnabledOverride: true,
    });
    await SqliteDb.ensureInitialized();

    const result = await service.generateBatch({
      conversationId: "conv-v2",
      sourceUserMessageId: "msg-v2",
      intentDecisionId: 1,
      recipientSourceType: "direct",
      recipients: [
        { address: "alpha@example.com", title: "Alpha", source: "direct" },
      ],
      serviceIds: [1],
      senderAddress: "sender@example.com",
      subject: "V2 test",
      bodyText: "Body v2",
      bodyHtml: "<p>v2</p>",
    });
    expect(result.success).toBe(true);

    const model = new OutboundEmailDraftModel(tmpDir);
    const drafts = await model.listDraftsByBatch(result.batchId!);
    const revision = await model.readCurrentRevision(drafts[0].id);
    expect(revision).not.toBeNull();
    expect(revision!.envelopeVersion).toBe(2);
    // Caller-supplied sender address with serviceId=1 → smtpUsername defaults
    // to the resolved identity's smtpUsername (fallback rule: from when no
    // smtpUsername configured on the service).
    expect(revision!.smtpUsername).toBe("sender@example.com");
    expect(revision!.replyToAddress).toBeNull();
  });

  it("produces a v2 content hash that differs from v1 for the same content", async () => {
    const service = new OutboundEmailDraftService(tmpDir, {
      aiEnabledOverride: true,
    });
    await SqliteDb.ensureInitialized();

    const result = await service.generateBatch({
      conversationId: "conv-hash",
      sourceUserMessageId: "msg-hash",
      intentDecisionId: 1,
      recipientSourceType: "direct",
      recipients: [
        { address: "hash@example.com", title: "Hash", source: "direct" },
      ],
      serviceIds: [1],
      senderAddress: "sender@example.com",
      subject: "Hash test",
      bodyText: "Hash body",
      bodyHtml: null,
    });
    expect(result.success).toBe(true);

    const model = new OutboundEmailDraftModel(tmpDir);
    const drafts = await model.listDraftsByBatch(result.batchId!);
    const revision = await model.readCurrentRevision(drafts[0].id);
    expect(revision).not.toBeNull();

    // The stored hash must match a v2 recomputation.
    const v2Envelope: BatchEnvelopeEntryV2 = {
      version: 2,
      draftId: drafts[0].id,
      emailServiceId: revision!.emailServiceId,
      smtpUsername: revision!.smtpUsername ?? "",
      senderAddress: revision!.senderAddress,
      replyToAddress: revision!.replyToAddress,
      recipientAddress: revision!.recipientAddress,
      subject: revision!.subject,
      bodyText: revision!.bodyText,
      bodyHtml: revision!.bodyHtml,
    };
    const v2Hash = OutboundEmailEnvelopeHasher.hashEnvelopeV2(v2Envelope);
    expect(revision!.contentHash).toBe(v2Hash);

    // v1 hash over the same content must differ (v2 includes smtpUsername
    // and replyToAddress fields that v1 does not).
    const v1Hash = OutboundEmailEnvelopeHasher.hashEnvelope({
      version: 1,
      emailServiceId: revision!.emailServiceId,
      senderAddress: revision!.senderAddress,
      recipientAddress: revision!.recipientAddress,
      subject: revision!.subject,
      bodyText: revision!.bodyText,
      bodyHtml: revision!.bodyHtml,
    });
    expect(v2Hash).not.toBe(v1Hash);
  });

  it("fillMissingSenders creates v2 revisions with identity snapshot", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    const serviceId = await seedSmtpService("identity-sender@example.com");
    const batchId = await seedEmptySenderBatch(serviceId);
    const service = new OutboundEmailDraftService(tmpDir, {
      aiEnabledOverride: true,
    });
    const filled = await service.fillMissingSenders(batchId);
    expect(filled.changed).toBe(true);

    const model = new OutboundEmailDraftModel(tmpDir);
    const drafts = await model.listDraftsByBatch(batchId);
    const revision = await model.readCurrentRevision(drafts[0].id);
    expect(revision?.envelopeVersion).toBe(2);
    expect(revision?.senderAddress).toBe("identity-sender@example.com");
    // No explicit smtpUsername on the seeded service → fallback rule applies
    // (smtpUsername = from address).
    expect(revision?.smtpUsername).toBe("identity-sender@example.com");
    expect(revision?.replyToAddress).toBeNull();
  });
});

async function seedSmtpService(from: string): Promise<number> {
  const model = new EmailServiceModel(tmpDir);
  const entity = new EmailServiceEntity();
  entity.name = "Test SMTP";
  entity.from = from;
  entity.password = "pass";
  entity.host = "smtp.example.com";
  entity.port = "465";
  entity.ssl = 1;
  entity.status = 1;
  return await model.create(entity);
}

async function seedEmptySenderBatch(emailServiceId: number): Promise<number> {
  const model = new OutboundEmailDraftModel(tmpDir);
  const batchEntity = new OutboundEmailDraftBatchEntity();
  batchEntity.conversationId = "conv-empty-sender";
  batchEntity.sourceUserMessageId = "msg-empty-sender";
  batchEntity.intentDecisionId = 1;
  batchEntity.status = "draft_ready";
  batchEntity.recipientSourceType = "direct";
  batchEntity.recipientCount = 1;
  batchEntity.validRecipientCount = 1;
  batchEntity.emailServiceIdsJson = JSON.stringify([emailServiceId]);
  const batch = await model.createBatch(batchEntity);

  const draftEntity = new OutboundEmailDraftEntity();
  draftEntity.batchId = batch.id;
  draftEntity.recipientAddress = "alice@example.com";
  draftEntity.status = "draft";
  draftEntity.revisionNumber = 0;
  const draft = await model.createDraft(draftEntity);

  const envelope = {
    version: 1 as const,
    draftId: draft.id,
    emailServiceId,
    senderAddress: "",
    recipientAddress: draft.recipientAddress,
    subject: "Hello",
    bodyText: "Hi",
    bodyHtml: null,
  };
  const contentHash = OutboundEmailEnvelopeHasher.hashEnvelope(envelope);
  await model.appendRevision({
    draftId: draft.id,
    actor: "ai",
    emailServiceId,
    senderAddress: "",
    recipientAddress: draft.recipientAddress,
    subject: "Hello",
    bodyText: "Hi",
    bodyHtml: null,
    contentHash,
  });
  await model.updateBatchHash(
    batch.id,
    OutboundEmailEnvelopeHasher.hashBatch([envelope])
  );
  return batch.id;
}
