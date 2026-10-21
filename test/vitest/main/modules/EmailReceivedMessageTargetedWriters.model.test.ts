import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { FindOneOptions, Repository } from "typeorm";

import { SqliteDb } from "@/config/SqliteDb";
import { EmailReceivedMessageModel } from "@/model/EmailReceivedMessage.model";
import { EmailReplyGuardModel } from "@/model/EmailReplyGuard.model";
import {
  EmailReceivedMessageEntity,
} from "@/entity/EmailReceivedMessage.entity";

// D01 (2026-10-17 re-audit r2) — real-SQL regressions for the targeted
// column-ownership fix of `updateReplyStatus` / `updateClassification` /
// `markRead`. Isolated per-run temp path, same pattern as the other
// EmailReceivedMessage model tests (BaseDb resolves the singleton via
// SqliteDb.getInstance(filepath); a second worker running synchronize() DDL
// against a shared file throws SQLITE_BUSY).
//
// Each test follows the audit's prescribed sequence: materialize the old
// (pre-evidence) view of the row, persist a negative observation and the
// sticky positive through the ACTUAL mutex-guarded writer, resume the
// unrelated writer, then assert the SAFE result — positive timestamp,
// source, matched ID and flag metadata survive, unrelated lifecycle,
// negative-cache and normalization fields are untouched, and the preserved
// evidence still refuses fresh guarded work (guard acquire → already_replied).
//
// Because a reintroduced load-mutate-save implementation would load the row
// FIRST (its fresh snapshot would include the already-landed positive), the
// erasure alone cannot discriminate regression — so the tests additionally
// enforce the no-load contract itself ("Missing rows can remain a no-op
// without loading the complete entity") via a findOne counter probe. The
// load step of the old implementation is what brought the stale entity into
// the collision; a writer that loads nothing cannot replay stale columns.
describe("EmailReceivedMessageModel targeted writer ownership (D01)", () => {
  let dbpath: string;
  let model: EmailReceivedMessageModel;
  let guardModel: EmailReplyGuardModel;
  let repo: Repository<EmailReceivedMessageEntity>;

  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-msg-writers-${Date.now()}`);
    fs.mkdirSync(dbpath, { recursive: true });
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    model = new EmailReceivedMessageModel(dbpath);
    guardModel = new EmailReplyGuardModel(dbpath);
    repo = SqliteDb.getInstance(dbpath).connection.getRepository(
      EmailReceivedMessageEntity
    );
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    try {
      fs.rmSync(dbpath, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  let serviceSeq = 0;
  function nextServiceId(): number {
    serviceSeq += 1;
    return 9100 + serviceSeq;
  }

  /** Seed a message row through the model's sync upsert path. */
  async function seedMessage(
    over: Partial<EmailReceivedMessageEntity> = {}
  ): Promise<EmailReceivedMessageEntity> {
    const message = new EmailReceivedMessageEntity();
    message.emailServiceId = nextServiceId();
    message.providerUid = `imap:INBOX:42:${Math.floor(Math.random() * 1e9)}`;
    message.fromAddress = "prospect@example.com";
    message.toAddressesJson = '["me@x.com"]';
    message.subject = "Pricing?";
    message.receivedAt = new Date();
    message.isUnread = 1;
    Object.assign(message, over);
    return await model.upsertByProviderUid(message);
  }

  const DETECTED_AT = new Date("2026-10-05T09:00:00Z");
  const FLAG_CHECKED_AT = new Date("2026-10-05T09:30:00Z");
  const SENT_SOURCE = "sent_search";
  const SENT_MATCHED = "<sent-D01@example.com>";
  const NEG_CHECK_AT = new Date("2026-10-05T08:00:00Z");
  const NEG_OWNER_AT = new Date("2026-10-05T08:30:00Z");
  const NEG_HASH = "ctx-D01-a";

  /** Persist a sticky positive through the real mutex-guarded writer. */
  function landPositive(id: number): Promise<boolean> {
    return model.updateReplyEvidence({
      id,
      replyDetectedAt: DETECTED_AT,
      replyDetectionSource: SENT_SOURCE,
      replyMatchedMessageId: SENT_MATCHED,
      isAnswered: 1,
      answeredFlagCheckedAt: FLAG_CHECKED_AT,
    });
  }

  /** Persist a negative observation through the real guarded writer. */
  function landNegative(id: number): Promise<boolean> {
    return model.updateReplyEvidence({
      id,
      replyNegativeCheckAt: NEG_CHECK_AT,
      replyNegativeContextHash: NEG_HASH,
      replyNegativeOwnerExpiresAt: NEG_OWNER_AT,
    });
  }

  /**
   * Verbatim audit sequence: materialize the unrelated operation's view of
   * the row while `replyDetectedAt`/provenance are still null (the "old
   * entity"), then persist a negative observation and the sticky positive
   * through the ACTUAL guarded writer. The writer under test then resumes on
   * top of these landed facts.
   */
  async function landFactsAfterStaleLoad(
    id: number
  ): Promise<EmailReceivedMessageEntity> {
    const staleView = await repo.findOneByOrFail({ id });
    expect(staleView.replyDetectedAt).toBeNull();
    expect(staleView.replyDetectionSource).toBeNull();
    expect(staleView.replyMatchedMessageId).toBeNull();
    expect(staleView.isAnswered).toBe(0);
    const negWritten = await landNegative(id);
    expect(negWritten).toBe(true);
    const posWritten = await landPositive(id);
    expect(posWritten).toBe(true);
    return staleView;
  }

  /**
   * Structural probe for the D01 fix: count the writer's row loads. The fix
   * performs a single-statement targeted UPDATE — it never loads the row
   * ("Missing rows can remain a no-op without loading the complete entity").
   * A reintroduced load-mutate-save writer will call findOne first, so the
   * count below fails deterministically BEFORE any interleave could erase
   * the written facts.
   */
  function installNoLoadProbe(): {
    restore: () => void;
    expectNoLoads: () => void;
  } {
    const rawFindOne = repo.findOne.bind(repo) as (
      options?: FindOneOptions<EmailReceivedMessageEntity>
    ) => Promise<EmailReceivedMessageEntity | null>;
    let loads = 0;
    const spy = vi.spyOn(repo, "findOne");
    spy.mockImplementation(async (options) => {
      loads += 1;
      spy.mockRestore();
      return await rawFindOne(options);
    });
    return {
      restore: () => spy.mockRestore(),
      expectNoLoads: () => expect(loads).toBe(0),
    };
  }

  /** The preserved sent/positive evidence must refuse fresh guarded work. */
  async function expectAcquireBlocked(
    seed: EmailReceivedMessageEntity
  ): Promise<void> {
    const now = new Date();
    const result = await guardModel.acquireReservation({
      emailServiceId: seed.emailServiceId,
      replyKey: `row:${seed.id}`,
      messageId: seed.id,
      ownerToken: "a".repeat(128),
      leaseExpiresAt: new Date(now.getTime() + 5 * 60_000),
      now,
      normalizedMessageId: null,
    });
    expect(result).toEqual({
      status: "blocked",
      code: "already_replied",
    });
  }

  /**
   * Safe-result assertions: all evidence/provenance/negative-cache/
   * normalization fields survived the unrelated writer, and no marker
   * provenance leaked into the row (the interception never fired).
   */
  async function expectEvidenceIntact(
    id: number
  ): Promise<EmailReceivedMessageEntity> {
    const after = await repo.findOneByOrFail({ id });
    expect(after.replyDetectedAt?.toISOString()).toBe(
      DETECTED_AT.toISOString()
    );
    expect(after.replyDetectionSource).toBe(SENT_SOURCE);
    expect(after.replyMatchedMessageId).toBe(SENT_MATCHED);
    expect(after.isAnswered).toBe(1);
    expect(after.answeredFlagCheckedAt?.toISOString()).toBe(
      FLAG_CHECKED_AT.toISOString()
    );
    expect(after.replyNegativeCheckAt?.toISOString()).toBe(
      NEG_CHECK_AT.toISOString()
    );
    expect(after.replyNegativeContextHash).toBe(NEG_HASH);
    expect(after.replyNegativeOwnerExpiresAt?.toISOString()).toBe(
      NEG_OWNER_AT.toISOString()
    );
    expect(after.conversationId).toBe(777);
    expect(after.normalizedMessageId).toBe("<orig-D01@example.com>");
    return after;
  }

  it("markRead is a targeted isUnread-only write: no entity load, evidence survives", async () => {
    const seeded = await seedMessage();
    await model.setConversation(seeded.id, 777);
    await model.updateNormalization(seeded.id, {
      normalizedMessageId: "<orig-D01@example.com>",
    });
    await landFactsAfterStaleLoad(seeded.id);

    const probe = installNoLoadProbe();
    try {
      await model.markRead(seeded.id, false);
    } finally {
      probe.restore();
    }
    // The old load-mutate-save implementation called findOne once here.
    probe.expectNoLoads();

    const after = await expectEvidenceIntact(seeded.id);
    expect(after.isUnread).toBe(0);
    // The preserved positive still refuses new guarded work.
    await expectAcquireBlocked(seeded);
  });

  it("updateClassification is a targeted classification-only write: no entity load, evidence survives", async () => {
    const seeded = await seedMessage({ isUnread: 1 });
    await model.setConversation(seeded.id, 777);
    await model.updateNormalization(seeded.id, {
      normalizedMessageId: "<orig-D01@example.com>",
    });
    await landFactsAfterStaleLoad(seeded.id);

    const probe = installNoLoadProbe();
    try {
      await model.updateClassification(seeded.id, "interested", 0.87);
    } finally {
      probe.restore();
    }
    probe.expectNoLoads();

    const after = await expectEvidenceIntact(seeded.id);
    expect(after.classification).toBe("interested");
    expect(after.classificationConfidence).toBeCloseTo(0.87);
    // Reading state is not owned by the classifier — unchanged.
    expect(after.isUnread).toBe(1);
    expect(after.replyStatus).toBe("not_started");
    await expectAcquireBlocked(seeded);
  });

  it("updateReplyStatus is a targeted status/processedAt-only write: no entity load, evidence survives", async () => {
    const seeded = await seedMessage({ isUnread: 1 });
    await model.setConversation(seeded.id, 777);
    await model.updateNormalization(seeded.id, {
      normalizedMessageId: "<orig-D01@example.com>",
    });
    await landFactsAfterStaleLoad(seeded.id);

    const probe = installNoLoadProbe();
    try {
      await model.updateReplyStatus(
        seeded.id,
        "skipped",
        new Date("2026-10-05T10:00:00Z")
      );
    } finally {
      probe.restore();
    }
    probe.expectNoLoads();

    const after = await expectEvidenceIntact(seeded.id);
    expect(after.replyStatus).toBe("skipped");
    expect(after.processedAt?.toISOString()).toBe("2026-10-05T10:00:00.000Z");
    await expectAcquireBlocked(seeded);

    // Status-only follow-up: an absent processedAt argument must preserve an
    // existing processedAt (never nulled, never moved).
    await model.updateReplyStatus(seeded.id, "blocked");
    const second = await repo.findOneByOrFail({ id: seeded.id });
    expect(second.replyStatus).toBe("blocked");
    expect(second.processedAt?.toISOString()).toBe("2026-10-05T10:00:00.000Z");
  });

  it("unread/classification writes cannot revert a successful send projection or newer negative/normalization", async () => {
    const seeded = await seedMessage();
    // Stale view materialized before the raced facts exist (pre-send).
    const stale = await repo.findOneByOrFail({ id: seeded.id });
    expect(stale.replyStatus).toBe("not_started");

    // Successful send projection — the same targeted write the send commit
    // transaction performs on the message row (EmailReplyDraft model).
    const sentAt = new Date("2026-10-05T12:00:00Z");
    await repo.update(
      { id: seeded.id },
      { replyStatus: "sent", processedAt: sentAt }
    );

    // A newer negative observation + newer normalization land after the send.
    const negAt = new Date("2026-10-05T13:00:00Z");
    const negOwner = new Date("2026-10-05T14:00:00Z");
    const negWritten = await model.updateReplyEvidence({
      id: seeded.id,
      replyNegativeCheckAt: negAt,
      replyNegativeContextHash: "ctx-send-2",
      replyNegativeOwnerExpiresAt: negOwner,
    });
    expect(negWritten).toBe(true);
    await model.updateNormalization(seeded.id, {
      normalizedMessageId: "<post-send-D01@example.com>",
      normalizedBodyText: "post-send body",
      conversationId: 4242,
    });

    // The raced stale writers: an unread/classification update must apply
    // ONLY its owned columns and touch nothing else.
    await model.markRead(seeded.id, false);
    await model.updateClassification(seeded.id, "interested", 0.9);

    const after = await repo.findOneByOrFail({ id: seeded.id });
    // Owned columns applied.
    expect(after.isUnread).toBe(0);
    expect(after.classification).toBe("interested");
    expect(after.classificationConfidence).toBeCloseTo(0.9);
    // Send projection NOT reverted (the old stale full save reopened
    // eligibility by restoring not_started).
    expect(after.replyStatus).toBe("sent");
    expect(after.processedAt?.toISOString()).toBe("2026-10-05T12:00:00.000Z");
    // Newer negative cache intact (stale save would have erased it).
    expect(after.replyNegativeCheckAt?.toISOString()).toBe(
      negAt.toISOString()
    );
    expect(after.replyNegativeContextHash).toBe("ctx-send-2");
    expect(after.replyNegativeOwnerExpiresAt?.toISOString()).toBe(
      negOwner.toISOString()
    );
    // Normalization intact.
    expect(after.normalizedMessageId).toBe("<post-send-D01@example.com>");
    expect(after.normalizedBodyText).toBe("post-send body");
    expect(after.conversationId).toBe(4242);
    // No stale save reopened eligibility: the sent projection still blocks.
    await expectAcquireBlocked(seeded);
  });

  it("targeted writers are no-ops for missing rows and never create rows", async () => {
    const missingId = 978_654_321;
    const rowCountBefore = await repo.count();
    await expect(model.markRead(missingId, false)).resolves.toBeUndefined();
    await expect(
      model.updateClassification(missingId, "interested", 0.5)
    ).resolves.toBeUndefined();
    await expect(
      model.updateReplyStatus(missingId, "skipped", new Date())
    ).resolves.toBeUndefined();
    const rowCountAfter = await repo.count();
    expect(rowCountAfter).toBe(rowCountBefore);
  });
});
