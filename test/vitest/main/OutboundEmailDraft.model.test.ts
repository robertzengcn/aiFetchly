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

  it("readCurrentRevisions batch-reads the highest revision per draft in one query", async () => {
    const model = new OutboundEmailDraftModel(tmpDir);
    await SqliteDb.ensureInitialized();

    // Draft A: two revisions (current = revision 2, subject "A2"). Use
    // appendRevision so revisionNumber auto-increments — createRevision would
    // collide on the (draftId, revisionNumber) unique index.
    const batchA = await model.createBatch(buildBatch());
    const draftA = await model.createDraft(buildDraft(batchA.id));
    await model.appendRevision({
      draftId: draftA.id,
      actor: "ai",
      emailServiceId: 1,
      senderAddress: "sender@example.com",
      recipientAddress: "a@example.com",
      subject: "A1",
      bodyText: "Hi",
      bodyHtml: null,
      contentHash: "a".repeat(64),
    });
    await model.appendRevision({
      draftId: draftA.id,
      actor: "user",
      emailServiceId: 1,
      senderAddress: "sender@example.com",
      recipientAddress: "a@example.com",
      subject: "A2",
      bodyText: "Hi",
      bodyHtml: null,
      contentHash: "b".repeat(64),
    });

    // Draft B: one revision (current = revision 1, subject "B1").
    const batchB = await model.createBatch(buildBatch());
    const draftB = await model.createDraft(
      buildDraft(batchB.id, { recipientAddress: "b@example.com" })
    );
    await model.appendRevision({
      draftId: draftB.id,
      actor: "ai",
      emailServiceId: 1,
      senderAddress: "sender@example.com",
      recipientAddress: "b@example.com",
      subject: "B1",
      bodyText: "Hi",
      bodyHtml: null,
      contentHash: "c".repeat(64),
    });

    // Batch-read both current revisions in a single query.
    const map = await model.readCurrentRevisions([draftA.id, draftB.id]);

    expect(map.size).toBe(2);
    expect(map.get(draftA.id)?.subject).toBe("A2");
    expect(map.get(draftB.id)?.subject).toBe("B1");
  });

  it("readCurrentRevisions returns an empty map for no draftIds", async () => {
    const model = new OutboundEmailDraftModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const map = await model.readCurrentRevisions([]);
    expect(map.size).toBe(0);
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

  it("findLatestBatchForTurn returns the newest non-terminal batch for a conversation+turn", async () => {
    const model = new OutboundEmailDraftModel(tmpDir);
    await SqliteDb.ensureInitialized();

    // An older batch for the SAME turn, already sent (terminal).
    const oldBatch = await model.createBatch(buildBatch({ status: "sent" }));
    // A newer draft_ready batch for the SAME turn — this is the one the gate
    // should authorize when the user asks to send.
    const newBatch = await model.createBatch(
      buildBatch({ status: "draft_ready", batchHash: "d".repeat(64) })
    );
    expect(newBatch.id).not.toBe(oldBatch.id);

    const found = await model.findLatestBatchForTurn("conv-1", "msg-1");
    expect(found?.id).toBe(newBatch.id);
    expect(found?.status).toBe("draft_ready");
  });

  it("findLatestBatchForTurn ignores batches for other conversations or turns", async () => {
    const model = new OutboundEmailDraftModel(tmpDir);
    await SqliteDb.ensureInitialized();

    await model.createBatch(
      buildBatch({ status: "draft_ready", conversationId: "other-conv" })
    );
    await model.createBatch(
      buildBatch({ status: "draft_ready", sourceUserMessageId: "other-msg" })
    );

    const found = await model.findLatestBatchForTurn("conv-1", "msg-1");
    expect(found).toBeNull();
  });

  it("findLatestBatchForTurn skips terminal batches when only terminal batches exist", async () => {
    const model = new OutboundEmailDraftModel(tmpDir);
    await SqliteDb.ensureInitialized();

    await model.createBatch(buildBatch({ status: "discarded" }));
    await model.createBatch(buildBatch({ status: "failed" }));

    const found = await model.findLatestBatchForTurn("conv-1", "msg-1");
    expect(found).toBeNull();
  });

  it("findLatestAuthorizableBatchForConversation returns the newest draft across turns", async () => {
    const model = new OutboundEmailDraftModel(tmpDir);
    await SqliteDb.ensureInitialized();

    await model.createBatch(
      buildBatch({
        status: "draft_ready",
        sourceUserMessageId: "msg-1",
        batchHash: "a".repeat(64),
      })
    );
    const newer = await model.createBatch(
      buildBatch({
        status: "draft_ready",
        sourceUserMessageId: "msg-2",
        batchHash: "b".repeat(64),
      })
    );

    const found = await model.findLatestAuthorizableBatchForConversation(
      "conv-1"
    );
    expect(found?.id).toBe(newer.id);
    expect(
      await model.findLatestAuthorizableBatchForConversation("other-conv")
    ).toBeNull();
  });
});
