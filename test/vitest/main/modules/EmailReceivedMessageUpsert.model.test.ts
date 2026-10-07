import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { SqliteDb } from "@/config/SqliteDb";
import { EmailReceivedMessageModel } from "@/model/EmailReceivedMessage.model";
import {
  EmailReceivedMessageEntity,
} from "@/entity/EmailReceivedMessage.entity";

// Same isolated-per-run temp-path pattern as EmailReplyGuardReservation tests:
// BaseDb resolves the singleton via SqliteDb.getInstance(filepath), and a
// second worker running synchronize() DDL on the shared `aifetchly-test` file
// throws SQLITE_BUSY.

/**
 * T03/FR-030 Step 2 — `upsertByProviderUid` must be a TARGETED provider-field
 * update (never a full-entity save of a stale snapshot), and
 * `updateReplyEvidence` must enforce the sticky-positive fence (technical
 * design §5.1): a later zero/negative observation can never reset a protected
 * message. These are DB-integration proofs — mocks cannot show the update
 * actually scopes its columns.
 */
describe("EmailReceivedMessageModel targeted upsert + sticky evidence (T03)", () => {
  let dbpath: string;
  let model: EmailReceivedMessageModel;

  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-msg-upsert-${Date.now()}`);
    fs.mkdirSync(dbpath, { recursive: true });
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    model = new EmailReceivedMessageModel(dbpath);
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    try {
      fs.rmSync(dbpath, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  const SERVICE_ID = 11;

  /** Seed a message row through the model's own upsert (the sync write path). */
  async function seedMessage(
    over: Partial<EmailReceivedMessageEntity> = {}
  ): Promise<EmailReceivedMessageEntity> {
    const message = new EmailReceivedMessageEntity();
    message.emailServiceId = SERVICE_ID;
    message.providerUid = `imap:INBOX:42:${Math.floor(Math.random() * 1e9)}`;
    message.fromAddress = "prospect@example.com";
    message.toAddressesJson = '["me@x.com"]';
    message.subject = "Pricing?";
    message.receivedAt = new Date();
    message.isAnswered = 0;
    Object.assign(message, over);
    return await model.upsertByProviderUid(message);
  }

  it("targeted update refreshes provider fields but preserves classification/processedAt", async () => {
    const seeded = await seedMessage({ isUnread: 1 });
    const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
      EmailReceivedMessageEntity
    );
    // Simulate local processing state written by another subsystem AFTER the
    // sync read the row (the exact race the full-entity copy used to lose).
    await repo.update(
      { id: seeded.id },
      {
        classification: "interested",
        classificationConfidence: 0.87,
        processedAt: new Date("2026-10-05T12:00:00Z"),
        replyStatus: "draft_created",
      }
    );

    // A later sync of the same providerUid (subject refreshed).
    const resync = await seedMessage({
      providerUid: seeded.providerUid,
      subject: "Pricing? (updated)",
    });
    const after = await repo.findOneByOrFail({ id: seeded.id });

    expect(after.subject).toBe("Pricing? (updated)");
    // Local state untouched by the provider refresh.
    expect(after.classification).toBe("interested");
    expect(after.classificationConfidence).toBe(0.87);
    expect(after.processedAt?.toISOString()).toBe("2026-10-05T12:00:00.000Z");
    expect(after.replyStatus).toBe("draft_created");
    expect(resync.id).toBe(seeded.id);
  });

  it("sync refreshes the answered flag observation without touching evidence columns", async () => {
    const seeded = await seedMessage({ isAnswered: 0 });
    const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
      EmailReceivedMessageEntity
    );
    // Detection wrote evidence.
    const detectedAt = new Date("2026-10-05T09:00:00Z");
    await repo.update(
      { id: seeded.id },
      {
        replyDetectedAt: detectedAt,
        replyDetectionSource: "sent_search",
        replyMatchedMessageId: "<sent-1@example.com>",
      }
    );

    // Sync later observes the answered flag (a stronger provider signal) but
    // carries NO detection evidence of its own — it must not clear the row.
    await seedMessage({
      providerUid: seeded.providerUid,
      isAnswered: 1,
      answeredFlagCheckedAt: new Date("2026-10-05T11:00:00Z"),
    });
    const after = await repo.findOneByOrFail({ id: seeded.id });

    expect(after.isAnswered).toBe(1);
    expect(after.answeredFlagCheckedAt?.toISOString()).toBe(
      "2026-10-05T11:00:00.000Z"
    );
    // Evidence preserved through the provider refresh.
    expect(after.replyDetectedAt?.toISOString()).toBe("2026-10-05T09:00:00.000Z");
    expect(after.replyDetectionSource).toBe("sent_search");
    expect(after.replyMatchedMessageId).toBe("<sent-1@example.com>");
  });

  it("answered flag promotion strengthens replyStatus to sent exactly once", async () => {
    const seeded = await seedMessage({ isAnswered: 0 });
    const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
      EmailReceivedMessageEntity
    );

    // Sync observes \Answered → projection promoted (historical sent rule).
    await seedMessage({
      providerUid: seeded.providerUid,
      isAnswered: 1,
      answeredFlagCheckedAt: new Date(),
    });
    const promoted = await repo.findOneByOrFail({ id: seeded.id });
    expect(promoted.replyStatus).toBe("sent");
    expect(promoted.processedAt).toBeInstanceOf(Date);

    // A later CLEARED flag sync must not downgrade back (sticky protection).
    await seedMessage({
      providerUid: seeded.providerUid,
      isAnswered: 0,
      answeredFlagCheckedAt: new Date(),
    });
    const afterClear = await repo.findOneByOrFail({ id: seeded.id });
    expect(afterClear.replyStatus).toBe("sent");
    expect(afterClear.isAnswered).toBe(0);
  });

  it("updateReplyEvidence positive is sticky: later negative does not clear it", async () => {
    const seeded = await seedMessage();
    const firstPositive = new Date("2026-10-05T09:00:00Z");

    const wrote = await model.updateReplyEvidence({
      id: seeded.id,
      replyDetectedAt: firstPositive,
      replyDetectionSource: "mailbox_flag",
      replyMatchedMessageId: null,
    });
    expect(wrote).toBe(true);

    // A later negative observation attempts to land on the same row.
    const negativeWritten = await model.updateReplyEvidence({
      id: seeded.id,
      replyNegativeCheckAt: new Date("2026-10-05T09:30:00Z"),
      replyNegativeContextHash: "ctx-hash-a",
    });
    expect(negativeWritten).toBe(false);

    const after = await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .findOneByOrFail({ id: seeded.id });
    expect(after.replyDetectedAt?.toISOString()).toBe("2026-10-05T09:00:00.000Z");
    expect(after.replyDetectionSource).toBe("mailbox_flag");
    expect(after.replyNegativeCheckAt).toBeNull();
    expect(after.replyNegativeContextHash).toBeNull();
  });

  it("updateReplyEvidence positive never moves the first detection timestamp", async () => {
    const seeded = await seedMessage();
    const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
      EmailReceivedMessageEntity
    );
    const first = new Date("2026-10-05T09:00:00Z");
    await repo.update(
      { id: seeded.id },
      { replyDetectedAt: first, replyDetectionSource: "mailbox_flag" }
    );

    // A SECOND, later positive (e.g. sent_search confirming) must not move
    // the sticky first-positive timestamp, but may update provenance.
    await model.updateReplyEvidence({
      id: seeded.id,
      replyDetectedAt: new Date("2026-10-05T10:00:00Z"),
      replyDetectionSource: "sent_search",
      replyMatchedMessageId: "<sent-2@example.com>",
    });
    const after = await repo.findOneByOrFail({ id: seeded.id });
    expect(after.replyDetectedAt?.toISOString()).toBe("2026-10-05T09:00:00.000Z");
    expect(after.replyDetectionSource).toBe("sent_search");
    expect(after.replyMatchedMessageId).toBe("<sent-2@example.com>");
  });

  it("negative-only then positive: positive lands and negative fields stop updating", async () => {
    const seeded = await seedMessage();
    const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
      EmailReceivedMessageEntity
    );

    const negWritten = await model.updateReplyEvidence({
      id: seeded.id,
      replyNegativeCheckAt: new Date("2026-10-05T08:00:00Z"),
      replyNegativeContextHash: "ctx-hash-a",
    });
    expect(negWritten).toBe(true);
    let after = await repo.findOneByOrFail({ id: seeded.id });
    expect(after.replyNegativeCheckAt).toBeInstanceOf(Date);
    expect(after.replyNegativeContextHash).toBe("ctx-hash-a");

    const posWritten = await model.updateReplyEvidence({
      id: seeded.id,
      replyDetectedAt: new Date("2026-10-05T09:00:00Z"),
      replyDetectionSource: "sent_search",
      replyMatchedMessageId: "<sent-3@example.com>",
    });
    expect(posWritten).toBe(true);
    after = await repo.findOneByOrFail({ id: seeded.id });
    expect(after.replyDetectedAt?.toISOString()).toBe("2026-10-05T09:00:00.000Z");

    // Negative fields no longer update once positive exists.
    const negAfterPos = await model.updateReplyEvidence({
      id: seeded.id,
      replyNegativeCheckAt: new Date("2026-10-05T09:30:00Z"),
      replyNegativeContextHash: "ctx-hash-b",
    });
    expect(negAfterPos).toBe(false);
  });

  it("updateProviderUidNamespacing is a targeted provenance-only update", async () => {
    const bare = `legacy-${Math.floor(Math.random() * 1e9)}`;
    const seeded = await seedMessage({ providerUid: bare });
    const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
      EmailReceivedMessageEntity
    );
    await repo.update(
      { id: seeded.id },
      {
        classification: "interested",
        replyStatus: "sent",
        processedAt: new Date("2026-10-05T12:00:00Z"),
      }
    );

    const ok = await model.updateProviderUidNamespacing({
      id: seeded.id,
      emailServiceId: SERVICE_ID,
      providerUid: `imap:INBOX:42:${bare}`,
      providerFolder: "INBOX",
      providerUidValidity: "42",
    });
    expect(ok).toBe(true);

    const after = await repo.findOneByOrFail({ id: seeded.id });
    expect(after.providerUid).toBe(`imap:INBOX:42:${bare}`);
    expect(after.providerFolder).toBe("INBOX");
    expect(after.providerUidValidity).toBe("42");
    // All local state survived the namespacing adoption.
    expect(after.classification).toBe("interested");
    expect(after.replyStatus).toBe("sent");
    expect(after.processedAt?.toISOString()).toBe("2026-10-05T12:00:00.000Z");
  });

  it("updateProviderUidNamespacing refuses when the target key is already taken", async () => {
    // A prior sync inserted the namespaced row while the legacy row lingered.
    const bare = `coll-${Math.floor(Math.random() * 1e9)}`;
    const target = `imap:INBOX:42:${bare}`;
    await seedMessage({ providerUid: target, subject: "already namespaced" });
    const legacy = await seedMessage({ providerUid: bare });

    const ok = await model.updateProviderUidNamespacing({
      id: legacy.id,
      emailServiceId: SERVICE_ID,
      providerUid: target,
      providerFolder: "INBOX",
      providerUidValidity: "42",
    });
    expect(ok).toBe(false);

    // Neither row changed: the legacy row keeps its bare key, and the
    // existing namespaced row was not overwritten.
    const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
      EmailReceivedMessageEntity
    );
    const legacyAfter = await repo.findOneByOrFail({ id: legacy.id });
    expect(legacyAfter.providerUid).toBe(bare);
    const targetRows = await repo.find({
      where: { emailServiceId: SERVICE_ID, providerUid: target },
    });
    expect(targetRows.length).toBe(1);
    expect(targetRows[0].subject).toBe("already namespaced");
  });

  it("insert path applies the narrowed answered promotion on first sight", async () => {
    const seeded = await seedMessage({ isAnswered: 1 });
    // Fresh insert with the \Answered flag observed → historical promotion
    // applies at insert time too (the mailbox already knows this answered).
    expect(seeded.replyStatus).toBe("sent");
    expect(seeded.processedAt).toBeInstanceOf(Date);
  });

  it("findLegacyBareUidRow locates only the exact bare-UID row", async () => {
    const bare = `77-${Math.floor(Math.random() * 1e9)}`;
    const seeded = await seedMessage({ providerUid: bare });

    const found = await model.findLegacyBareUidRow({
      emailServiceId: SERVICE_ID,
      bareUid: bare,
    });
    expect(found?.id).toBe(seeded.id);

    const missing = await model.findLegacyBareUidRow({
      emailServiceId: SERVICE_ID,
      bareUid: "does-not-exist",
    });
    expect(missing).toBeNull();
  });
});
