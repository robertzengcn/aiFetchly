import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { SqliteDb } from "@/config/SqliteDb";
import { EmailReplyGuardModel } from "@/model/EmailReplyGuard.model";
import { EmailReplyDraftModel } from "@/model/EmailReplyDraft.model";
import { EmailReplySendAttemptModel } from "@/model/EmailReplySendAttempt.model";
import { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { EmailReplyGuardEntity } from "@/entity/EmailReplyGuard.entity";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplyDraftRevisionEntity } from "@/entity/EmailReplyDraftRevision.entity";
import { EmailReplyAuditLogEntity } from "@/entity/EmailReplyAuditLog.entity";
import { runReplyTxn } from "@/model/replyTxn";
import {
  canonicalReplyKey,
  normalizeStoredMessageId,
} from "@/service/emailReceive/EmailReplyIdentity";

// R01/R02/R03 — adversarial regression suite for the canonical eligibility/
// evidence contract. These tests prove the cluster resolver, the commit-time
// reconciliation (R01), and the claim-time positive rejection (R02) directly
// against the model layer with a real SQLite DB. They cannot be asserted with
// mocks: the entire point is the transaction-aware cluster read inside the
// same `runReplyTxn` that writes (no TOCTOU between read and write).
//
// Same isolation pattern as EmailReplyGuardReservation.model.test.ts: reset
// the SqliteDb singleton onto a per-run temp path so a second vitest worker
// does not collide on the shared `aifetchly-test` file (SQLITE_BUSY).

describe("EmailReply cluster eligibility contract (R01/R02/R03) — DB integration", () => {
  let dbpath: string;
  let guardModel: EmailReplyGuardModel;
  let draftModel: EmailReplyDraftModel;
  let attemptModel: EmailReplySendAttemptModel;

  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-eligibility-${Date.now()}`);
    fs.mkdirSync(dbpath, { recursive: true });
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    guardModel = new EmailReplyGuardModel(dbpath);
    draftModel = new EmailReplyDraftModel(dbpath);
    attemptModel = new EmailReplySendAttemptModel(dbpath);
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    try {
      fs.rmSync(dbpath, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  const SERVICE_ID = 9;
  const OWNER_TOKEN = "t".repeat(128);

  /** Seed a received-message row as the canonical cluster seed. */
  async function seedMessage(
    over: Partial<EmailReceivedMessageEntity> = {}
  ): Promise<EmailReceivedMessageEntity> {
    const message = new EmailReceivedMessageEntity();
    message.emailServiceId = SERVICE_ID;
    message.providerUid = `uid-${Math.random()}`;
    message.fromAddress = "prospect@example.com";
    message.toAddressesJson = '["me@x.com"]';
    message.subject = "Pricing?";
    message.receivedAt = new Date();
    Object.assign(message, over);
    return await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .save(message);
  }

  /**
   * Seed an equivalent cluster row sharing the SAME normalized id so the
   * resolver aggregates sibling evidence. The `normalizedMessageId` argument
   * is the canonical (bracket-stripped) token — production sync stores the
   * normalized form, and `readClusterEvidence` normalizes legacy raw headers
   * to the same form before the join.
   */
  async function seedEquivalent(
    normalizedMessageId: string,
    over: Partial<EmailReceivedMessageEntity> = {}
  ): Promise<EmailReceivedMessageEntity> {
    const message = new EmailReceivedMessageEntity();
    message.emailServiceId = SERVICE_ID;
    message.providerUid = `uid-${Math.random()}`;
    message.messageId = `<msg-${Math.random()}@x.com>`;
    message.normalizedMessageId = normalizedMessageId;
    message.fromAddress = "prospect@example.com";
    message.toAddressesJson = '["me@x.com"]';
    message.subject = "Pricing?";
    message.receivedAt = new Date();
    Object.assign(message, over);
    return await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .save(message);
  }

  /** Acquire a generation reservation on a message, returning the guard id. */
  async function acquireReservation(
    messageId: number,
    normalizedMessageId: string | null
  ): Promise<number> {
    const now = new Date();
    const result = await guardModel.acquireReservation({
      emailServiceId: SERVICE_ID,
      replyKey: canonicalReplyKey({
        normalizedMessageId,
        rowId: messageId,
      }),
      messageId,
      ownerToken: OWNER_TOKEN,
      leaseExpiresAt: new Date(now.getTime() + 5 * 60_000),
      now,
      normalizedMessageId,
    });
    expect(result.status).toBe("acquired");
    if (result.status !== "acquired") throw new Error("reservation not acquired");
    return result.guardId;
  }

  /** Build a raw draft entity matching the generation service's shape. */
  function buildRawDraft(messageId: number): EmailReplyDraftEntity {
    const draft = new EmailReplyDraftEntity();
    draft.messageId = messageId;
    draft.emailServiceId = SERVICE_ID;
    draft.subject = "Re: Pricing?";
    draft.bodyText = "Here is our pricing.";
    draft.bodyHtml = null;
    draft.status = "draft";
    draft.generationSource = "ai";
    return draft;
  }

  /** Commit-input helper. */
  function commitInputFor(guardId: number, messageId: number, rfcId: string) {
    return {
      guardId,
      ownerToken: OWNER_TOKEN,
      rawDraft: buildRawDraft(messageId),
      emailServiceId: SERVICE_ID,
      messageId,
      subject: "Re: Pricing?",
      bodyText: "Here is our pricing.",
      senderAddress: "me@x.com",
      recipientAddress: "prospect@example.com",
      generationMetadataJson: null,
      requestCorrelationId: rfcId,
      now: new Date(),
    };
  }

  // ---------------------------------------------------------------
  // R01 — commit transaction reconciles current reply evidence
  //
  // R01 defends against the race where reply evidence appears BETWEEN the
  // reservation acquire (which has its own cluster check) and the commit.
  // The acquire layer blocks on sent drafts/attempts/in-flight/multi-live-
  // draft evidence at the cluster level, but it has the R03 hole: a sibling
  // sticky positive (`replyDetectedAt`) or row-level `replyStatus=sent` on a
  // sibling is NOT aggregated by the acquire layer's checks. The commit-time
  // reconciliation closes that hole and the race.
  // ---------------------------------------------------------------

  it("R01: commit refuses with already_replied when a sibling gains a sticky positive (replyDetectedAt) AFTER acquire (the race R01 defends against)", async () => {
    // R03 closed the acquire-layer hole: a sibling sticky positive at acquire
    // time now blocks at acquire (see the acquire-layer R03 test below). So the
    // canonical R01 adversarial case is the RACE: acquire on a clean cluster,
    // then a sibling's `replyDetectedAt` appears between acquire and commit.
    // Only the commit-time `classifyClusterEligibility` reconciliation catches
    // it — the authoritative backstop that R01 exists to provide.
    const rawId = `<seed-${Math.random()}@x.com>`;
    const normalizedId = normalizeStoredMessageId(rawId)!;
    const seed = await seedMessage({
      messageId: rawId,
      normalizedMessageId: normalizedId,
    });
    const sibling = await seedEquivalent(normalizedId);
    const guardId = await acquireReservation(seed.id, normalizedId);

    // Race: sibling gains a sticky positive AFTER acquire, BEFORE commit.
    await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .update(
        { id: sibling.id },
        {
          replyDetectedAt: new Date(),
          replyDetectionSource: "mailbox_flag",
        }
      );

    const result = await draftModel.commitGeneratedDraft(
      commitInputFor(guardId, seed.id, "corr-r01a")
    );

    expect(result.status).toBe("refused");
    if (result.status === "refused") {
      expect(result.reason).toBe("already_replied");
    }
    // No draft was persisted.
    const drafts = await draftModel.listByMessage(seed.id);
    expect(drafts.length).toBe(0);
  });

  it("R03 (acquire-layer closure): a sibling sticky positive at acquire time now blocks at acquire (previously passed acquire, caught only at commit)", async () => {
    // Before R03's acquire-layer fix, `acquireReservation` checked
    // `replyStatus === "sent" || sentDrafts || sentAttempts` but NOT
    // `clusterReplyDetectedAt` — a sibling sticky positive passed acquire and
    // was caught only by R01's commit-time backstop. Routing acquire through
    // `classifyClusterEligibility` closes the hole at the source: acquire now
    // returns `blocked`/`already_replied` directly, no reservation claimed.
    const rawId = `<seed-${Math.random()}@x.com>`;
    const normalizedId = normalizeStoredMessageId(rawId)!;
    const seed = await seedMessage({
      messageId: rawId,
      normalizedMessageId: normalizedId,
    });
    await seedEquivalent(normalizedId, {
      replyDetectedAt: new Date(),
      replyDetectionSource: "mailbox_flag",
    });

    const now = new Date();
    const result = await guardModel.acquireReservation({
      emailServiceId: SERVICE_ID,
      replyKey: canonicalReplyKey({
        normalizedMessageId: normalizedId,
        rowId: seed.id,
      }),
      messageId: seed.id,
      ownerToken: OWNER_TOKEN,
      leaseExpiresAt: new Date(now.getTime() + 5 * 60_000),
      now,
      normalizedMessageId: normalizedId,
    });

    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.code).toBe("already_replied");
    }
    // No guard row was claimed — the generation_in_progress lease is absent.
    const guardRow = await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReplyGuardEntity)
      .findOne({
        where: {
          emailServiceId: SERVICE_ID,
          replyKey: canonicalReplyKey({
            normalizedMessageId: normalizedId,
            rowId: seed.id,
          }),
        },
      });
    expect(guardRow).toBeNull();
  });

  it("R01: commit refuses with already_replied when the seed itself has replyStatus=sent (cluster row-level sent)", async () => {
    // replyStatus=sent on the seed IS caught by the acquire layer (it checks
    // `replyStatus === "sent"`), so to exercise the commit-time path we plant
    // the sent projection AFTER acquire (the race). The cluster has no live
    // draft at acquire time → acquired; a sibling's replyStatus flips to sent
    // between acquire and commit → commit-time reconciliation refuses.
    const rawId = `<seed-${Math.random()}@x.com>`;
    const normalizedId = normalizeStoredMessageId(rawId)!;
    const seed = await seedMessage({
      messageId: rawId,
      normalizedMessageId: normalizedId,
    });
    const sibling = await seedEquivalent(normalizedId);
    const guardId = await acquireReservation(seed.id, normalizedId);

    // Race: sibling's replyStatus flips to sent AFTER acquire.
    await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .update({ id: sibling.id }, { replyStatus: "sent" });

    const result = await draftModel.commitGeneratedDraft(
      commitInputFor(guardId, seed.id, "corr-r01b")
    );

    expect(result.status).toBe("refused");
    if (result.status === "refused") {
      expect(result.reason).toBe("already_replied");
    }
    const drafts = await draftModel.listByMessage(seed.id);
    expect(drafts.length).toBe(0);
  });

  it("R01: commit refuses with delivery_unknown when a sibling gains a delivery_unknown draft after acquire (race)", async () => {
    const rawId = `<seed-${Math.random()}@x.com>`;
    const normalizedId = normalizeStoredMessageId(rawId)!;
    const seed = await seedMessage({
      messageId: rawId,
      normalizedMessageId: normalizedId,
    });
    const sibling = await seedEquivalent(normalizedId);
    const guardId = await acquireReservation(seed.id, normalizedId);

    // Race: a delivery_unknown draft lands on the sibling between acquire
    // and commit.
    const siblingDraft = buildRawDraft(sibling.id);
    siblingDraft.status = "delivery_unknown";
    await draftModel.create(siblingDraft);

    const result = await draftModel.commitGeneratedDraft(
      commitInputFor(guardId, seed.id, "corr-r01c")
    );

    expect(result.status).toBe("refused");
    if (result.status === "refused") {
      expect(result.reason).toBe("delivery_unknown");
    }
    // The seed row got no new draft.
    const seedDrafts = await draftModel.listByMessage(seed.id);
    expect(seedDrafts.length).toBe(0);
  });

  it("R01: commit refuses with reply_in_progress when a sibling gains an in-flight send attempt after acquire (race)", async () => {
    const rawId = `<seed-${Math.random()}@x.com>`;
    const normalizedId = normalizeStoredMessageId(rawId)!;
    const seed = await seedMessage({
      messageId: rawId,
      normalizedMessageId: normalizedId,
    });
    const sibling = await seedEquivalent(normalizedId);
    const guardId = await acquireReservation(seed.id, normalizedId);

    // Race: a sibling draft goes to `sending` + an in-flight attempt lands.
    const siblingDraft = buildRawDraft(sibling.id);
    siblingDraft.status = "sending";
    const savedSibling = await draftModel.create(siblingDraft);
    const attempt = new EmailReplySendAttemptEntity();
    attempt.idempotencyKey = `r01d-${Math.random()}`;
    attempt.draftId = savedSibling.id;
    attempt.revisionId = 1;
    attempt.approvalId = 1;
    attempt.messageId = sibling.id;
    attempt.conversationId = null;
    attempt.emailServiceId = SERVICE_ID;
    attempt.senderAddress = "me@x.com";
    attempt.recipientAddress = "prospect@example.com";
    attempt.status = "submitted";
    attempt.claimedAt = new Date();
    await attemptModel.create(attempt);

    const result = await draftModel.commitGeneratedDraft(
      commitInputFor(guardId, seed.id, "corr-r01d")
    );

    expect(result.status).toBe("refused");
    if (result.status === "refused") {
      expect(result.reason).toBe("reply_in_progress");
    }
  });

  it("R01: commit succeeds on a clean cluster (eligible) and persists the draft + guard transition", async () => {
    const rawId = `<seed-${Math.random()}@x.com>`;
    const normalizedId = normalizeStoredMessageId(rawId)!;
    const seed = await seedMessage({
      messageId: rawId,
      normalizedMessageId: normalizedId,
    });
    const guardId = await acquireReservation(seed.id, normalizedId);

    const result = await draftModel.commitGeneratedDraft(
      commitInputFor(guardId, seed.id, "corr-r01e")
    );

    expect(result.status).toBe("committed");
    if (result.status === "committed") {
      const guardRow = await guardModel.read(guardId);
      expect(guardRow?.phase).toBe("draft_ready");
      expect(guardRow?.activeDraftId).toBe(result.draftId);
    }
  });

  it("R01: commit returns fenced when the guard is no longer in the generating phase (a prior commit already bound a draft)", async () => {
    // Acquire, commit once (transitions guard -> draft_ready), then attempt a
    // second commit on the same guard. The phase precondition (generating)
    // fails -> fenced, not refused. No second draft persisted.
    const rawId = `<seed-${Math.random()}@x.com>`;
    const normalizedId = normalizeStoredMessageId(rawId)!;
    const seed = await seedMessage({
      messageId: rawId,
      normalizedMessageId: normalizedId,
    });
    const guardId = await acquireReservation(seed.id, normalizedId);

    const first = await draftModel.commitGeneratedDraft(
      commitInputFor(guardId, seed.id, "corr-r01f1")
    );
    expect(first.status).toBe("committed");

    const second = await draftModel.commitGeneratedDraft(
      commitInputFor(guardId, seed.id, "corr-r01f2")
    );
    expect(second.status).toBe("fenced");
    // Only one draft on the seed.
    const drafts = await draftModel.listByMessage(seed.id);
    expect(drafts.length).toBe(1);
  });

  // ---------------------------------------------------------------
  // R03 — canonical cluster resolver includes legacy rows + sibling positives
  // ---------------------------------------------------------------

  it("R03: a legacy seed with no normalizedMessageId column forms a singleton cluster (seed included)", async () => {
    // Legacy row: raw messageId set but normalizedMessageId column is null.
    // The resolver normalizes on the fly; the seed is its own singleton.
    const rawId = `<legacy-${Math.random()}@x.com>`;
    const seed = await seedMessage({
      messageId: rawId,
      normalizedMessageId: undefined as unknown as string,
    });
    // Force the column null (model a true legacy row).
    await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .update({ id: seed.id }, { normalizedMessageId: null as unknown as string });
    const guardId = await acquireReservation(seed.id, null);

    const result = await draftModel.commitGeneratedDraft(
      commitInputFor(guardId, seed.id, "corr-r03a")
    );

    // Singleton cluster with no positive evidence -> eligible -> committed.
    expect(result.status).toBe("committed");
  });

  it("R03: a legacy seed with a valid RFC id joins its normalized sibling's cluster — the seed is never omitted from its own cluster", async () => {
    // Seed has a raw messageId but no normalizedMessageId column. An
    // equivalent sibling exists with the normalized id. The previous bug
    // (findCanonicalEquivalents returning equivalents WITHOUT the seed) meant
    // a legacy seed with sent/unknown history became invisible to its own
    // cluster. R03: the seed is always included, and the resolver aggregates
    // sibling positives so the seed's commit sees the sibling's sticky
    // positive and refuses. The sibling positive is planted AFTER acquire
    // (the race structure) because the acquire-layer R03 fix would block
    // earlier — the point here is that the LEGACY seed's COMMIT resolves the
    // cluster on the fly (null normalizedMessageId → raw header
    // normalization) and sees the sibling's evidence.
    const rawId = `<shared-${Math.random()}@x.com>`;
    const normalizedId = normalizeStoredMessageId(rawId)!;
    const seed = await seedMessage({
      messageId: rawId,
      normalizedMessageId: undefined as unknown as string,
    });
    await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .update({ id: seed.id }, { normalizedMessageId: null as unknown as string });
    // Sibling carries the normalized id (canonical form), clean at acquire.
    const sibling = await seedEquivalent(normalizedId);
    const guardId = await acquireReservation(seed.id, null);

    // Race: the sibling gains a sticky positive between acquire and commit.
    await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .update(
        { id: sibling.id },
        {
          replyDetectedAt: new Date(),
          replyDetectionSource: "sent_search",
        }
      );

    const result = await draftModel.commitGeneratedDraft(
      commitInputFor(guardId, seed.id, "corr-r03b")
    );

    // The sibling's sticky positive must refuse the seed's commit — proving
    // the legacy seed joined its cluster (was not omitted) AND the sibling
    // positive was aggregated. If the legacy seed had been omitted from its
    // own cluster, the commit would have seen a clean singleton and
    // committed.
    expect(result.status).toBe("refused");
    if (result.status === "refused") {
      expect(result.reason).toBe("already_replied");
    }
  });

  // ---------------------------------------------------------------
  // R02 — send claim rejects positive evidence (model-level, see also the
  //       EmailReplySendClaim.integration.test.ts freshness suite for the
  //       fence-level negative-only semantics)
  // ---------------------------------------------------------------

  it("R02: a cluster sibling's sticky positive blocks the send claim even with a fresh negative on the seed", async () => {
    // The seed has a fresh negative (replyNegativeCheckAt within the window)
    // so the freshness fence passes — but the sibling carries a sticky
    // positive, and the cluster-evidence sibling check (clusterEvidenceBlocksSend,
    // upgraded in R03) must refuse. This proves the fence and the sibling
    // check compose: fresh negative passes the fence, cluster positive blocks.
    const rawId = `<seed-${Math.random()}@x.com>`;
    const normalizedId = normalizeStoredMessageId(rawId)!;
    const seed = await seedMessage({
      messageId: rawId,
      normalizedMessageId: normalizedId,
      replyNegativeCheckAt: new Date(),
    });
    await seedEquivalent(normalizedId, {
      replyDetectedAt: new Date(),
      replyDetectionSource: "mailbox_flag",
    });
    // Seed an approved draft to claim.
    const draft = buildRawDraft(seed.id);
    draft.status = "approved";
    const saved = await draftModel.create(draft);
    // The refusal happens at the sibling check (after the fence passes) —
    // before the conditional UPDATE that would check the revision/hash — so
    // the exact revision/hash values do not matter here.
    const result = await draftModel.claimApprovedRevisionForSend({
      draftId: saved.id,
      revisionId: 1,
      approvedHash: "placeholder-not-checked-before-refusal",
      idempotencyKey: `r02-${Math.random()}`,
      approvalId: 1,
      messageId: seed.id,
      conversationId: null,
      emailServiceId: SERVICE_ID,
      senderAddress: "me@x.com",
      recipientAddress: "prospect@example.com",
      policyVersion: "policy-1",
      guardId: null,
      now: new Date(),
    });

    // The freshness fence passes (fresh negative), so the refusal comes from
    // the sibling check (precondition_failed, NOT freshness_stale).
    expect(result.status).toBe("precondition_failed");
    if (result.status === "precondition_failed") {
      expect(result.reason).not.toBe("freshness_stale");
      expect(result.reason).toContain("Message-level state blocks send");
    }
  });

  // ---------------------------------------------------------------
  // R09 — the commit's final mutation fence uses an advancing clock read
  // after admission (never a pre-queue timestamp) and requires current
  // owner + generating phase + unexpired lease, rolling back staged
  // draft/revision/message/audit writes on failure. Real shared-mutex
  // queue holds (not mock promises) for the admission race.
  // ---------------------------------------------------------------

  async function rowCounts(messageId: number) {
    const connection = SqliteDb.getInstance(dbpath).connection;
    const drafts = await draftModel.listByMessage(messageId);
    const revisions = await connection
      .getRepository(EmailReplyDraftRevisionEntity)
      .createQueryBuilder("rev")
      .innerJoin(
        "email_reply_draft",
        "draft",
        "draft.id = rev.draftId AND draft.messageId = :messageId",
        { messageId }
      )
      .getMany();
    const audits = await connection
      .getRepository(EmailReplyAuditLogEntity)
      .find({ where: { messageId } });
    const message = await connection
      .getRepository(EmailReceivedMessageEntity)
      .findOne({ where: { id: messageId } });
    return { drafts, revisions, audits, message };
  }

  it("R09: queued commit past lease expiry is fenced with zero writes", async () => {
    const rawId = `<r09q-${Math.random()}@x.com>`;
    const normalizedId = normalizeStoredMessageId(rawId)!;
    const seed = await seedMessage({
      messageId: rawId,
      normalizedMessageId: normalizedId,
    });
    // Short real lease: it expires while the commit waits in queue.
    const now = new Date();
    const acquired = await guardModel.acquireReservation({
      emailServiceId: SERVICE_ID,
      replyKey: canonicalReplyKey({
        normalizedMessageId: normalizedId,
        rowId: seed.id,
      }),
      messageId: seed.id,
      ownerToken: OWNER_TOKEN,
      leaseExpiresAt: new Date(now.getTime() + 200),
      now,
      normalizedMessageId: normalizedId,
    });
    expect(acquired.status).toBe("acquired");
    if (acquired.status !== "acquired") throw new Error("not acquired");

    // Occupy the shared write mutex, out-wait the lease, then release.
    let releaseQueue!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const holder = runReplyTxn(SqliteDb.getInstance(dbpath), async () => {
      await gate;
      return "held";
    });
    const commitP = draftModel.commitGeneratedDraft(
      commitInputFor(acquired.guardId, seed.id, "corr-r09q")
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    releaseQueue();
    const result = await commitP;
    await holder;
    expect(result.status).toBe("fenced");
    // Zero writes: no draft, no revision, no creation audit, no message
    // promotion — and the guard still belongs to the (expired) owner in
    // generating phase, untouched.
    const counts = await rowCounts(seed.id);
    expect(counts.drafts).toHaveLength(0);
    expect(counts.revisions).toHaveLength(0);
    expect(counts.audits).toHaveLength(0);
    expect(counts.message?.replyStatus).toBe("not_started");
    const guard = await guardModel.read(acquired.guardId);
    expect(guard?.phase).toBe("generating");
    expect(guard?.ownerToken).toBe(OWNER_TOKEN);
  }, 20_000);

  it("R09: lease expiring mid-transaction is fenced at the final mutation fence", async () => {
    const rawId = `<r09m-${Math.random()}@x.com>`;
    const normalizedId = normalizeStoredMessageId(rawId)!;
    const seed = await seedMessage({
      messageId: rawId,
      normalizedMessageId: normalizedId,
    });
    const guardId = await acquireReservation(seed.id, normalizedId);
    // Call-counted clock: first read (admission) sees a valid lease, every
    // later read (the final fence, after the in-transaction draft/revision/
    // message/audit writes staged) sees expiry. Deterministic, no sleeping.
    const t0 = Date.now();
    let calls = 0;
    const result = await draftModel.commitGeneratedDraft({
      ...commitInputFor(guardId, seed.id, "corr-r09m"),
      nowForCheck: () => {
        calls += 1;
        return calls === 1 ? t0 : t0 + 10 * 60_000;
      },
    });
    expect(calls).toBeGreaterThan(1);
    expect(result.status).toBe("fenced");
    // The staged writes rolled back: nothing persisted anywhere.
    const counts = await rowCounts(seed.id);
    expect(counts.drafts).toHaveLength(0);
    expect(counts.revisions).toHaveLength(0);
    expect(counts.audits).toHaveLength(0);
    expect(counts.message?.replyStatus).toBe("not_started");
    const guard = await guardModel.read(guardId);
    expect(guard?.phase).toBe("generating");
    expect(guard?.ownerToken).toBe(OWNER_TOKEN);
  });

  it("R09: intervening owner replacement is fenced with zero writes", async () => {
    const rawId = `<r09r-${Math.random()}@x.com>`;
    const normalizedId = normalizeStoredMessageId(rawId)!;
    const seed = await seedMessage({
      messageId: rawId,
      normalizedMessageId: normalizedId,
    });
    const guardId = await acquireReservation(seed.id, normalizedId);
    // Another owner takes over the guard row (fresh lease, still
    // generating) before our commit runs.
    await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReplyGuardEntity)
      .update(
        { id: guardId },
        {
          ownerToken: "b".repeat(128),
          leaseExpiresAt: new Date(Date.now() + 5 * 60_000),
        }
      );
    const result = await draftModel.commitGeneratedDraft(
      commitInputFor(guardId, seed.id, "corr-r09r")
    );
    expect(result.status).toBe("fenced");
    const counts = await rowCounts(seed.id);
    expect(counts.drafts).toHaveLength(0);
    expect(counts.revisions).toHaveLength(0);
    expect(counts.audits).toHaveLength(0);
    expect(counts.message?.replyStatus).toBe("not_started");
  });
});
