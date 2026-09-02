import { describe, expect, it, beforeEach } from "vitest";
import { OutboundEmailDraftService } from "@/service/outboundEmail/OutboundEmailDraftService";
import { OutboundEmailDraftModel } from "@/model/OutboundEmailDraft.model";
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
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
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
});