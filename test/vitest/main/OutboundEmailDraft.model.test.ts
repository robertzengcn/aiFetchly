import { describe, expect, it, beforeEach } from "vitest";
import { OutboundEmailDraftModel } from "@/model/OutboundEmailDraft.model";
import { OutboundEmailDraftBatchEntity } from "@/entity/OutboundEmailDraftBatch.entity";
import { OutboundEmailDraftEntity } from "@/entity/OutboundEmailDraft.entity";
import { OutboundEmailDraftRevisionEntity } from "@/entity/OutboundEmailDraftRevision.entity";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-outbound-draft-model");

function buildBatch(
  overrides: Partial<OutboundEmailDraftBatchEntity> = {}
): OutboundEmailDraftBatchEntity {
  const e = new OutboundEmailDraftBatchEntity();
  e.conversationId = "conv-1";
  e.sourceUserMessageId = "msg-1";
  e.intentDecisionId = 1;
  e.status = "drafting";
  e.recipientSourceType = "explicit";
  e.recipientCount = 0;
  e.validRecipientCount = 0;
  e.emailServiceIdsJson = JSON.stringify([1]);
  return Object.assign(e, overrides);
}

function buildDraft(
  batchId: number,
  overrides: Partial<OutboundEmailDraftEntity> = {}
): OutboundEmailDraftEntity {
  const e = new OutboundEmailDraftEntity();
  e.batchId = batchId;
  e.recipientAddress = "a@example.com";
  e.status = "draft";
  e.revisionNumber = 0;
  return Object.assign(e, overrides);
}

function buildRevision(
  draftId: number,
  overrides: Partial<OutboundEmailDraftRevisionEntity> = {}
): OutboundEmailDraftRevisionEntity {
  const e = new OutboundEmailDraftRevisionEntity();
  e.draftId = draftId;
  e.revisionNumber = 1;
  e.actor = "ai";
  e.emailServiceId = 1;
  e.senderAddress = "sender@example.com";
  e.recipientAddress = "a@example.com";
  e.subject = "Hello";
  e.bodyText = "Hi";
  e.bodyHtml = null;
  e.contentHash = "a".repeat(64);
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
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
});

describe("OutboundEmailDraftModel", () => {
  it("creates a batch, drafts, and an immutable revision", async () => {
    const model = new OutboundEmailDraftModel(tmpDir);
    await SqliteDb.ensureInitialized();

    const batch = await model.createBatch(buildBatch());
    expect(typeof batch.id).toBe("number");
    expect(batch.status).toBe("drafting");

    const draft = await model.createDraft(buildDraft(batch.id));
    expect(typeof draft.id).toBe("number");
    expect(draft.batchId).toBe(batch.id);

    const rev = await model.createRevision(buildRevision(draft.id));
    expect(typeof rev.id).toBe("number");
    expect(rev.revisionNumber).toBe(1);
    expect(rev.actor).toBe("ai");
  });

  it("enforces unique (batchId, recipientAddress) on drafts", async () => {
    const model = new OutboundEmailDraftModel(tmpDir);
    await SqliteDb.ensureInitialized();

    const batch = await model.createBatch(buildBatch());
    await model.createDraft(buildDraft(batch.id));

    await expect(model.createDraft(buildDraft(batch.id))).rejects.toThrow();
  });

  it("enforces unique (draftId, revisionNumber) on revisions", async () => {
    const model = new OutboundEmailDraftModel(tmpDir);
    await SqliteDb.ensureInitialized();

    const batch = await model.createBatch(buildBatch());
    const draft = await model.createDraft(buildDraft(batch.id));
    await model.createRevision(buildRevision(draft.id));

    await expect(
      model.createRevision(buildRevision(draft.id))
    ).rejects.toThrow();
  });

  it("appends a new revision and advances the draft pointer atomically", async () => {
    const model = new OutboundEmailDraftModel(tmpDir);
    await SqliteDb.ensureInitialized();

    const batch = await model.createBatch(buildBatch());
    const draft = await model.createDraft(buildDraft(batch.id));

    // The initial AI-generated revision is also created via appendRevision
    // (the real-world path), which assigns revisionNumber and advances the
    // draft pointer in one transaction.
    const first = await model.appendRevision({
      draftId: draft.id,
      actor: "ai",
      emailServiceId: 1,
      senderAddress: "sender@example.com",
      recipientAddress: "a@example.com",
      subject: "Hello",
      bodyText: "Hi",
      bodyHtml: null,
      contentHash: "a".repeat(64),
    });
    expect(first.revisionNumber).toBe(1);

    // A user edit inserts a new revision (revisionNumber 2) and bumps the
    // draft's currentRevisionId + revisionNumber in one operation.
    const edited = await model.appendRevision({
      draftId: draft.id,
      actor: "user",
      emailServiceId: 1,
      senderAddress: "sender@example.com",
      recipientAddress: "a@example.com",
      subject: "Edited subject",
      bodyText: "Edited body",
      bodyHtml: "<p>Edited</p>",
      contentHash: "b".repeat(64),
    });
    expect(edited.revisionNumber).toBe(2);

    const reloaded = await model.readDraft(draft.id);
    expect(reloaded?.currentRevisionId).toBe(edited.id);
    expect(reloaded?.revisionNumber).toBe(2);
    expect(reloaded?.contentHash).toBe("b".repeat(64));

    // The first revision is untouched (append-only).
    const firstReloaded = await model.readRevision(first.id);
    expect(firstReloaded?.subject).toBe("Hello");
    expect(firstReloaded?.revisionNumber).toBe(1);
  });

  it("recomputes the batch hash pointer", async () => {
    const model = new OutboundEmailDraftModel(tmpDir);
    await SqliteDb.ensureInitialized();

    const batch = await model.createBatch(buildBatch());
    const draft = await model.createDraft(buildDraft(batch.id));
    await model.createRevision(buildRevision(draft.id));

    await model.updateBatchHash(batch.id, "c".repeat(64));
    const reloaded = await model.readBatch(batch.id);
    expect(reloaded?.batchHash).toBe("c".repeat(64));
  });
});
