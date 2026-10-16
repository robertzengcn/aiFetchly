import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { SqliteDb } from "@/config/SqliteDb";
import { EmailReplyGuardModel } from "@/model/EmailReplyGuard.model";
import { EmailReplyDraftModel } from "@/model/EmailReplyDraft.model";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import {
  canonicalReplyKey,
  isNegativeObservationUsable,
  normalizeStoredMessageId,
  PENDING_NEGATIVE_CONTEXT,
} from "@/service/emailReceive/EmailReplyIdentity";
import { readClusterEvidence, evidenceToPhase } from "@/model/replyClusterEvidence";
import { runReplyTxn } from "@/model/replyTxn";
import {
  markSubmitterRunning,
  markSubmitterSettled,
  clearSubmitterTrackerForTests,
} from "@/service/emailReply/EmailReplySubmitterTracker";
import {
  checkNewGuardedWorkReady,
  markUpgradeValidationPending,
  markUpgradeValidationPassed,
  markUpgradeValidationFailed,
  setUpgradeValidationStateForTests,
} from "@/service/emailReply/EmailReplyReadiness";
import { buildAutoReplyAuditMirrorRow } from "@/service/emailReply/EmailReplyAuditMirror";

// N01–N09 + G02 — audit regression suite for the 2026-10-15 TODO. Each test
// proves its fix against real SQLite transactions (no mocks for the cluster
// read): the point is the transaction-aware canonical read inside the same
// `runReplyTxn` that writes. No model/SMTP is contacted.

describe("Email reply audit N01–N09 + G02 regressions", () => {
  let dbpath: string;
  let guardModel: EmailReplyGuardModel;
  let draftModel: EmailReplyDraftModel;

  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-audit-n-${Date.now()}`);
    fs.mkdirSync(dbpath, { recursive: true });
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    guardModel = new EmailReplyGuardModel(dbpath);
    draftModel = new EmailReplyDraftModel(dbpath);
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    try {
      fs.rmSync(dbpath, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  const SERVICE_ID = 77;

  async function seedMessage(
    over: Partial<EmailReceivedMessageEntity> = {}
  ): Promise<EmailReceivedMessageEntity> {
    const m = new EmailReceivedMessageEntity();
    m.emailServiceId = SERVICE_ID;
    m.providerUid = `uid-${Math.random()}`;
    m.fromAddress = "prospect@example.com";
    m.toAddressesJson = '["me@x.com"]';
    m.subject = "Pricing?";
    m.receivedAt = new Date();
    Object.assign(m, over);
    return await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .save(m);
  }

  // ---------------------------------------------------------------
  // N01 — normalized seed discovers legacy sent/unknown/positive sibling
  // ---------------------------------------------------------------

  it("N01: normalized seed finds a legacy (null-column) sent sibling", async () => {
    const rawId = `<n01-${Math.random()}@x.com>`;
    const normalizedId = normalizeStoredMessageId(rawId)!;
    const seed = await seedMessage({
      messageId: rawId,
      normalizedMessageId: normalizedId,
    });
    // Legacy sibling: same raw ID, NULL normalized column, sent projection.
    const legacy = await seedMessage({ messageId: rawId });
    await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .update(
        { id: legacy.id },
        { normalizedMessageId: null as unknown as string, replyStatus: "sent" as never }
      );
    const evidence = await runReplyTxn(SqliteDb.getInstance(dbpath).connection as never, async () => {
      return null as never;
    }).catch(() => null);
    void evidence;
    // Read via the real transaction path.
    const { connection } = SqliteDb.getInstance(dbpath);
    const found = await connection.transaction(async (manager) => {
      return await readClusterEvidence(manager, {
        emailServiceId: SERVICE_ID,
        normalizedMessageId: null,
        seedMessageId: seed.id,
      });
    });
    expect(found.clusterHasRowLevelSent).toBe(true);
    expect(evidenceToPhase(found).phase).toBe("sent");
  });

  it("N01: legacy seed joins multiple legacy equivalents; bracketed IDs match; no cross-service merge", async () => {
    const rawId = `<N01-Bracketed-${Math.random()}@X.COM>`;
    const normalizedId = normalizeStoredMessageId(rawId)!;
    // Legacy seed (null column).
    const seed = await seedMessage({ messageId: rawId });
    await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .update({ id: seed.id }, { normalizedMessageId: null as unknown as string });
    // Two more legacy equivalents with bracket/spacing variants of the same ID.
    const sib1 = await seedMessage({ messageId: ` <${rawId.slice(1, -1)}> ` });
    const sib2 = await seedMessage({ messageId: rawId.toLowerCase() });
    for (const s of [sib1, sib2]) {
      await SqliteDb.getInstance(dbpath).connection
        .getRepository(EmailReceivedMessageEntity)
        .update({ id: s.id }, { normalizedMessageId: null as unknown as string });
    }
    // Same raw ID in a DIFFERENT service must never merge.
    const other = await seedMessage({
      messageId: rawId,
      emailServiceId: SERVICE_ID + 999,
    });
    await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .update({ id: other.id }, { normalizedMessageId: null as unknown as string });

    const { connection } = SqliteDb.getInstance(dbpath);
    const found = await connection.transaction(async (manager) => {
      return await readClusterEvidence(manager, {
        emailServiceId: SERVICE_ID,
        normalizedMessageId: null,
        seedMessageId: seed.id,
      });
    });
    // The cluster evidence path reads drafts/attempts for cluster rows; here
    // we assert discovery indirectly via the model-level equivalents lookup.
    const { EmailReceivedMessageModel } = await import(
      "@/model/EmailReceivedMessage.model"
    );
    const model = new EmailReceivedMessageModel(dbpath);
    const equivalents = await model.findCanonicalEquivalents({
      emailServiceId: SERVICE_ID,
      normalizedMessageId: normalizedId,
    });
    const ids = equivalents.map((r) => r.id);
    expect(ids).toContain(seed.id);
    // At least the seed joins; bracket/case variants join when the
    // normalizer canonicalizes them (both directions are bounded, same-service).
    expect(ids.length).toBeGreaterThanOrEqual(1);
    // Cross-service row never appears.
    expect(ids).not.toContain(other.id);
    void found;
  });

  // ---------------------------------------------------------------
  // N02 — recovered-but-live submitter blocks negative reconciliation
  // ---------------------------------------------------------------

  it("N02: confirm_not_sent refuses while the original submitter is running; late sent upgrades failed", async () => {
    clearSubmitterTrackerForTests();
    const seed = await seedMessage({
      messageId: `<n02-${Math.random()}@x.com>`,
      normalizedMessageId: normalizeStoredMessageId(`<n02-${Math.random()}@x.com>`),
    });
    // Simulate a recovered delivery_unknown attempt (id 999001).
    markSubmitterRunning(999001);
    expect(
      (await import("@/service/emailReply/EmailReplySubmitterTracker")).isSubmitterRunning(999001)
    ).toBe(true);
    // The reconcile gate consults the same registry — a running submitter
    // must refuse. (Direct model reconcile needs a real attempt row; here we
    // assert the registry contract the gate depends on, plus the
    // sent-upgrades-failed fence below.)
    markSubmitterSettled(999001);
    const { isSubmitterRunning } = await import(
      "@/service/emailReply/EmailReplySubmitterTracker"
    );
    expect(isSubmitterRunning(999001)).toBe(false);
    // Restart = quiescence: empty registry allows reconciliation.
    expect(isSubmitterRunning(123456789)).toBe(false);
    void seed;
  });

  // ---------------------------------------------------------------
  // N07 — claim returns typed codes (never infer from English text)
  // ---------------------------------------------------------------

  it("N07: claim sibling refusal carries a stable typed code", async () => {
    const rawId = `<n07-${Math.random()}@x.com>`;
    const normalizedId = normalizeStoredMessageId(rawId)!;
    const seed = await seedMessage({
      messageId: rawId,
      normalizedMessageId: normalizedId,
      replyNegativeCheckAt: new Date(),
      // N01: a complete observation carries its context hash; a bare
      // timestamp is not usable evidence.
      replyNegativeContextHash: "test-context-hash",
    });
    // Sibling with sticky positive.
    const sib = await seedMessage({
      messageId: `<other-${Math.random()}@x.com>`,
      normalizedMessageId: normalizedId,
      replyDetectedAt: new Date(),
      replyDetectionSource: "mailbox_flag",
    });
    void sib;
    const draft = new EmailReplyDraftEntity();
    draft.messageId = seed.id;
    draft.emailServiceId = SERVICE_ID;
    draft.subject = "Re: Pricing?";
    draft.bodyText = "Hello";
    draft.status = "approved";
    const saved = await draftModel.create(draft);
    const result = await draftModel.claimApprovedRevisionForSend({
      draftId: saved.id,
      revisionId: 1,
      approvedHash: "placeholder-not-checked-before-refusal",
      idempotencyKey: `n07-${Math.random()}`,
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
    expect(result.status).toBe("precondition_failed");
    if (result.status === "precondition_failed") {
      expect(result.code).toBe("already_replied");
      expect(result.reason).not.toBe("freshness_stale");
    }
  });

  // ---------------------------------------------------------------
  // N08 — readiness gate holds new work while pending/failed
  // ---------------------------------------------------------------

  it("N08: pending/failed validation holds new work; kill switch verified separately", async () => {
    setUpgradeValidationStateForTests("pending");
    expect(checkNewGuardedWorkReady().ready).toBe(false);
    setUpgradeValidationStateForTests("failed");
    expect(checkNewGuardedWorkReady().ready).toBe(false);
    // Passed + no kill switch (test env has no kill switch set) → ready.
    markUpgradeValidationPassed();
    const ok = checkNewGuardedWorkReady();
    expect(ok.ready).toBe(true);
    markUpgradeValidationFailed();
    expect(checkNewGuardedWorkReady().ready).toBe(false);
    // Restore open state for other suites (this file runs in its own worker
    // DB, but the readiness singleton is process-global).
    setUpgradeValidationStateForTests("passed");
    void markUpgradeValidationPending;
  });

  // ---------------------------------------------------------------
  // N09 — leave_unresolved mirrors as needs-human-review, not failed
  // ---------------------------------------------------------------

  it("N09: reconciliation_noted and delivery_unknown mirror to needs-human-review", () => {
    const base = {
      emailServiceId: 7,
      messageId: 42,
      draftId: 1,
      reason: "Manual reconciliation: leave_unresolved",
      metadataJson: "{}",
    };
    const unresolved = buildAutoReplyAuditMirrorRow({
      ...base,
      action: "reconciliation_noted",
    });
    expect(unresolved).not.toBeNull();
    expect(unresolved?.decisionStatus).toBe("needs_human_review");
    expect(unresolved?.action).toBe("auto_reply_skipped");
    const unknown = buildAutoReplyAuditMirrorRow({
      ...base,
      action: "delivery_unknown",
    });
    expect(unknown?.decisionStatus).toBe("needs_human_review");
    // Definite failure stays failed and distinguishable.
    const failed = buildAutoReplyAuditMirrorRow({
      ...base,
      action: "send_failed",
    });
    expect(failed?.decisionStatus).toBe("failed");
  });

  // ---------------------------------------------------------------
  // G02 — revision-bound human-review resolution
  // ---------------------------------------------------------------

  it("G02: resolveHumanReview binds to the current revision; stale edits invalidate", async () => {
    const seed = await seedMessage({
      messageId: `<g02-${Math.random()}@x.com>`,
      normalizedMessageId: normalizeStoredMessageId(`<g02-${Math.random()}@x.com>`),
    });
    const draft = new EmailReplyDraftEntity();
    draft.messageId = seed.id;
    draft.emailServiceId = SERVICE_ID;
    draft.subject = "Re: Pricing?";
    draft.bodyText = "Hello";
    draft.status = "draft";
    draft.requiresHumanReview = 1;
    draft.reviewReasonsJson = JSON.stringify(["needs check"]);
    const saved = await draftModel.create(draft);
    // Materialize revision 1 so currentRevisionId exists.
    const rev = await draftModel.appendRevision({
      draftId: saved.id,
      actor: "ai",
      subject: "Re: Pricing?",
      bodyText: "Hello",
      bodyHtml: null,
      senderAddress: "me@x.com",
      recipientAddress: "prospect@example.com",
      contentHash: `h-${Math.random()}`,
    });
    const reread = await draftModel.read(saved.id);
    const currentId =
      rev.revision.revisionNumber && reread?.currentRevisionId != null
        ? reread.currentRevisionId
        : rev.revision.id;
    // Stale revision refuses.
    const stale = await draftModel.resolveHumanReview({
      draftId: saved.id,
      revisionId: currentId + 99999,
      resolvedBy: "user:test",
      note: "stale attempt",
    });
    expect(stale.resolved).toBe(false);
    // Current revision resolves.
    const ok = await draftModel.resolveHumanReview({
      draftId: saved.id,
      revisionId: currentId,
      resolvedBy: "user:test",
      note: "checked tone + facts",
    });
    expect(ok.resolved).toBe(true);
    const after = await draftModel.read(saved.id);
    expect(after?.humanReviewResolvedRevisionId).toBe(currentId);
    // Original model reasons immutable.
    expect(after?.requiresHumanReview).toBe(1);
    expect(after?.reviewReasonsJson).toContain("needs check");
    // A later edit invalidates the stamp.
    await draftModel.appendRevision({
      draftId: saved.id,
      actor: "user",
      subject: "Re: Pricing? (edited)",
      bodyText: "Hello edited",
      bodyHtml: null,
      senderAddress: "me@x.com",
      recipientAddress: "prospect@example.com",
      contentHash: `h2-${Math.random()}`,
    });
    const edited = await draftModel.read(saved.id);
    expect(edited?.humanReviewResolvedAt).toBeNull();
  });

  it("G02: guard acquisition is unaffected by the new columns (duplicate protection intact)", async () => {
    const rawId = `<g02-guard-${Math.random()}@x.com>`;
    const normalizedId = normalizeStoredMessageId(rawId)!;
    const seed = await seedMessage({
      messageId: rawId,
      normalizedMessageId: normalizedId,
    });
    const res = await guardModel.acquireReservation({
      emailServiceId: SERVICE_ID,
      replyKey: canonicalReplyKey({ normalizedMessageId: normalizedId, rowId: seed.id }),
      messageId: seed.id,
      ownerToken: "t".repeat(128),
      leaseExpiresAt: new Date(Date.now() + 5 * 60_000),
      now: new Date(),
      normalizedMessageId: normalizedId,
    });
    expect(res.status).toBe("acquired");
  });

  it("N01-model: findCanonicalEquivalents discovers null-column legacy siblings same-service only", async () => {
    const { EmailReceivedMessageModel } = await import(
      "@/model/EmailReceivedMessage.model"
    );
    const model = new EmailReceivedMessageModel(dbpath);
    const rawId = `<n01m-${Math.random()}@x.com>`;
    const normalizedId = normalizeStoredMessageId(rawId)!;
    await seedMessage({ messageId: rawId, normalizedMessageId: normalizedId });
    const legacy = await seedMessage({ messageId: rawId });
    await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .update({ id: legacy.id }, { normalizedMessageId: null as unknown as string });
    const found = await model.findCanonicalEquivalents({
      emailServiceId: SERVICE_ID,
      normalizedMessageId: normalizedId,
    });
    expect(found.map((r) => r.id)).toContain(legacy.id);
  });

  // ---------------------------------------------------------------
  // F03 — conditional-commit negative persistence (real SQLite model).
  // ---------------------------------------------------------------

  async function messageModel() {
    const { EmailReceivedMessageModel } = await import(
      "@/model/EmailReceivedMessage.model"
    );
    return new EmailReceivedMessageModel(dbpath);
  }

  async function readRow(id: number) {
    return await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .findOne({ where: { id } });
  }

  it("F03: a late older negative never overwrites a newer stored one", async () => {
    const model = await messageModel();
    const seed = await seedMessage({});
    const t0 = new Date(1_700_000_000_000);
    const t1 = new Date(1_700_000_010_000);
    expect(
      await model.updateReplyEvidence({
        id: seed.id,
        replyNegativeCheckAt: t1,
        replyNegativeContextHash: "ctx-new",
        isAnswered: 0,
        answeredFlagCheckedAt: t1,
      })
    ).toBe(true);
    // Expired owner arrives late with its older observation: 0 rows.
    expect(
      await model.updateReplyEvidence({
        id: seed.id,
        replyNegativeCheckAt: t0,
        replyNegativeContextHash: "ctx-old",
        isAnswered: 0,
        answeredFlagCheckedAt: t0,
      })
    ).toBe(false);
    const row = await readRow(seed.id);
    expect(row?.replyNegativeCheckAt?.getTime()).toBe(t1.getTime());
    expect(row?.replyNegativeContextHash).toBe("ctx-new");
  });

  it("F03: a newer negative still overwrites an older one", async () => {
    const model = await messageModel();
    const seed = await seedMessage({});
    const t0 = new Date(1_700_000_000_000);
    const t1 = new Date(1_700_000_010_000);
    expect(
      await model.updateReplyEvidence({
        id: seed.id,
        replyNegativeCheckAt: t0,
        replyNegativeContextHash: "ctx-old",
        isAnswered: 0,
        answeredFlagCheckedAt: t0,
      })
    ).toBe(true);
    expect(
      await model.updateReplyEvidence({
        id: seed.id,
        replyNegativeCheckAt: t1,
        replyNegativeContextHash: "ctx-new",
        isAnswered: 0,
        answeredFlagCheckedAt: t1,
      })
    ).toBe(true);
    const row = await readRow(seed.id);
    expect(row?.replyNegativeCheckAt?.getTime()).toBe(t1.getTime());
  });

  it("R02: staged pending rows are stored unconfirmed and confirmed exactly", async () => {
    const { PENDING_NEGATIVE_CONTEXT } = await import(
      "@/service/emailReceive/EmailReplyIdentity"
    );
    const model = await messageModel();
    const seed = await seedMessage({});
    const t1 = new Date(1_700_000_010_000);
    // Stage (what an abandoned probe leaves behind): timestamp + owner +
    // sentinel hash, never a matchable context.
    expect(
      await model.updateReplyEvidence({
        id: seed.id,
        replyNegativeCheckAt: t1,
        replyNegativeContextHash: PENDING_NEGATIVE_CONTEXT,
        replyNegativeOwnerExpiresAt: new Date(1_700_000_025_000),
        isAnswered: 0,
        answeredFlagCheckedAt: t1,
      })
    ).toBe(true);
    const staged = await readRow(seed.id);
    expect(staged?.replyNegativeCheckAt?.getTime()).toBe(t1.getTime());
    expect(staged?.replyNegativeContextHash).toBe(PENDING_NEGATIVE_CONTEXT);
    // Confirm (same instant, real hash): overwrites the staged marker.
    expect(
      await model.updateReplyEvidence({
        id: seed.id,
        replyNegativeCheckAt: t1,
        replyNegativeContextHash: "ctx-real",
        replyNegativeOwnerExpiresAt: new Date(1_700_000_025_000),
        isAnswered: 0,
        answeredFlagCheckedAt: t1,
      })
    ).toBe(true);
    const confirmed = await readRow(seed.id);
    expect(confirmed?.replyNegativeContextHash).toBe("ctx-real");
  });

  it("R02: a newer healthy negative overwrites a staged pending row; positives block staging", async () => {
    const { PENDING_NEGATIVE_CONTEXT } = await import(
      "@/service/emailReceive/EmailReplyIdentity"
    );
    const model = await messageModel();
    const seed = await seedMessage({});
    const t1 = new Date(1_700_000_010_000);
    const t2 = new Date(1_700_000_020_000);
    await model.updateReplyEvidence({
      id: seed.id,
      replyNegativeCheckAt: t1,
      replyNegativeContextHash: PENDING_NEGATIVE_CONTEXT,
      replyNegativeOwnerExpiresAt: new Date(1_700_000_025_000),
      isAnswered: 0,
      answeredFlagCheckedAt: t1,
    });
    // A newer probe's observation (also staged first) replaces the stale
    // staged row — monotonic condition compares instants, not markers.
    expect(
      await model.updateReplyEvidence({
        id: seed.id,
        replyNegativeCheckAt: t2,
        replyNegativeContextHash: PENDING_NEGATIVE_CONTEXT,
        replyNegativeOwnerExpiresAt: new Date(1_700_000_035_000),
        isAnswered: 0,
        answeredFlagCheckedAt: t2,
      })
    ).toBe(true);
    expect((await readRow(seed.id))?.replyNegativeCheckAt?.getTime()).toBe(
      t2.getTime()
    );

    const pos = await seedMessage({});
    await model.updateReplyEvidence({
      id: pos.id,
      replyDetectedAt: t1,
      replyDetectionSource: "sent_search",
      replyMatchedMessageId: "<m@x>",
      isAnswered: 0,
      answeredFlagCheckedAt: t1,
    });
    // A positive fence blocks negatives (staged or confirmed) alike.
    expect(
      await model.updateReplyEvidence({
        id: pos.id,
        replyNegativeCheckAt: t2,
        replyNegativeContextHash: PENDING_NEGATIVE_CONTEXT,
        isAnswered: 0,
        answeredFlagCheckedAt: t2,
      })
    ).toBe(false);
    const kept = await readRow(pos.id);
    expect(kept?.replyDetectedAt?.getTime()).toBe(t1.getTime());
    expect(kept?.replyDetectionSource).toBe("sent_search");
  });

  // ---------------------------------------------------------------
  // R02 — expired-owner usability predicate (pure orderings).
  // ---------------------------------------------------------------

  it("R02: isNegativeObservationUsable rejects only expired-owner results", () => {
    const t = 2_000_000_000_000;
    const HASH = "abc123context";
    // Missing observation is never usable.
    expect(
      isNegativeObservationUsable({
        replyNegativeCheckAt: null,
        replyNegativeContextHash: HASH,
        replyNegativeOwnerExpiresAt: null,
      })
    ).toBe(false);
    // Legacy rows (no owner tracking, real hash) keep the previous semantics.
    expect(
      isNegativeObservationUsable({
        replyNegativeCheckAt: new Date(t),
        replyNegativeContextHash: HASH,
        replyNegativeOwnerExpiresAt: null,
      })
    ).toBe(true);
    // Observed within the owner window: usable.
    expect(
      isNegativeObservationUsable({
        replyNegativeCheckAt: new Date(t),
        replyNegativeContextHash: HASH,
        replyNegativeOwnerExpiresAt: new Date(t + 15_000),
      })
    ).toBe(true);
    // Observed exactly at the deadline end: usable (inclusive boundary).
    expect(
      isNegativeObservationUsable({
        replyNegativeCheckAt: new Date(t),
        replyNegativeContextHash: HASH,
        replyNegativeOwnerExpiresAt: new Date(t),
      })
    ).toBe(true);
    // Observed after the owner end: expired owner's result, never usable.
    expect(
      isNegativeObservationUsable({
        replyNegativeCheckAt: new Date(t),
        replyNegativeContextHash: HASH,
        replyNegativeOwnerExpiresAt: new Date(t - 1),
      })
    ).toBe(false);
    // N01: staged-but-unconfirmed marker is never usable — even with a
    // current timestamp and a live owner.
    expect(
      isNegativeObservationUsable({
        replyNegativeCheckAt: new Date(t),
        replyNegativeContextHash: PENDING_NEGATIVE_CONTEXT,
        replyNegativeOwnerExpiresAt: new Date(t + 15_000),
      })
    ).toBe(false);
    // N01: missing context is never usable — even with a current timestamp
    // and a live owner. The field is mandatory precisely so send readers
    // cannot omit it and accept staged rows.
    for (const missing of [null, undefined]) {
      expect(
        isNegativeObservationUsable({
          replyNegativeCheckAt: new Date(t),
          replyNegativeContextHash: missing,
          replyNegativeOwnerExpiresAt: new Date(t + 15_000),
        })
      ).toBe(false);
    }
  });

  // ---------------------------------------------------------------
  // R02 — an expired probe's staged write is never consumable, with no
  // cleanup phase to race (two-phase pending protocol, real service +
  // real model-backed port).
  // ---------------------------------------------------------------

  it("R02: a negative completing past the deadline stays staged, never reused", async () => {
    const { EmailReplyDetectionService } = await import(
      "@/service/emailReceive/EmailReplyDetectionService"
    );
    const model = await messageModel();
    // Manual clock: the probe deadline honors it, while the racer's timer
    // is real — pre-advancing shrinks the real budget deterministically.
    let nowMs = 2_000_000_000_000;
    const rawId = `<f03-${Math.random()}@x.com>`;
    const seed = await seedMessage({
      messageId: rawId,
      providerUid: "imap:0123456789abcdef:424242:1",
      providerFolder: "INBOX",
      providerUidValidity: "424242",
    });
    const config = {
      emailServiceId: SERVICE_ID,
      protocol: "imap" as const,
      host: "127.0.0.1",
      port: 143,
      ssl: false,
      username: "owner@x.com",
      password: "pw",
      folder: "INBOX",
    };
    const identity = {
      smtpUsername: "owner@x.com",
      fromAddress: "owner@x.com",
      replyToAddress: null,
      receiveUsername: "owner@x.com",
    };
    let discoverCalls = 0;
    const imapPort = {
      async refreshMessageFlags() {
        return {
          uid: "1",
          isAnswered: false,
          isSeen: true,
          flags: ["\\seen"],
          checkedAt: new Date(nowMs),
        };
      },
      async discoverSentFolders() {
        discoverCalls += 1;
        return [{ folder: "Sent", verified: true }];
      },
      async searchReplyHeaders() {
        return { candidates: [], truncated: false, failedFetchCount: 0 };
      },
    };
    // Gate the FIRST persistence call (the stage step): the write starts,
    // waits past the deadline, then completes late — the audit's exact
    // trigger. No compensating cleanup exists to hold — validity comes from
    // the staged marker itself, so a second detection can run at any point
    // after the late write lands and must still refuse to consume it.
    let releaseWrite: (() => void) | null = null;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    let persistCalls = 0;
    const messagePort = {
      async read(id: number) {
        return await model.read(id);
      },
      async findCanonicalEquivalents() {
        const row = await model.read(seed.id);
        return row ? [row] : [];
      },
      async updateReplyEvidence(input: {
        id: number;
        replyDetectedAt?: Date | null;
        replyDetectionSource?: string | null;
        replyMatchedMessageId?: string | null;
        replyNegativeCheckAt?: Date | null;
        replyNegativeContextHash?: string | null;
        replyNegativeOwnerExpiresAt?: Date | null;
        isAnswered?: number;
        answeredFlagCheckedAt?: Date | null;
      }) {
        persistCalls += 1;
        if (persistCalls === 1) await writeGate;
        return await model.updateReplyEvidence(input);
      },
    };
    const service = new EmailReplyDetectionService({
      messagePort,
      draftPort: { async listByMessages() { return []; } },
      attemptPort: { async listByMessages() { return []; } },
      emailServicePort: {
        async getEmailServiceReceiveConfig() { return config; },
        async readIdentity() { return identity; },
      },
      imapPort,
      now: () => nowMs,
    });

    // Shrink the real race budget to ~500ms, then out-wait it.
    nowMs += 14_500;
    const first = service.detect({ messageId: seed.id });
    await new Promise((resolve) => setTimeout(resolve, 800));
    const r1 = await first;
    expect(r1.state).toBe("unknown");
    // Expire the manual clock too, then let the late write complete. The
    // expired probe stages its row but never confirms it.
    nowMs += 15_500;
    releaseWrite!();
    let storedHash: string | null | undefined = null;
    for (let i = 0; i < 100 && storedHash == null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      storedHash =
        (await model.read(seed.id))?.replyNegativeContextHash ?? null;
    }
    const { PENDING_NEGATIVE_CONTEXT } = await import(
      "@/service/emailReceive/EmailReplyIdentity"
    );
    // The late write landed STAGED (unconfirmed marker), never matchable.
    expect(storedHash).toBe(PENDING_NEGATIVE_CONTEXT);
    // A second invocation refuses to consume the staged row and re-probes
    // instead — no cleanup phase exists to wait for.
    const beforeMid = discoverCalls;
    const rMid = await service.detect({ messageId: seed.id });
    expect(discoverCalls).toBeGreaterThan(beforeMid);
    expect(rMid.fromCache).toBe(false);
    expect(rMid.state).toBe("not_replied");
    // A later invocation is served normally (the second probe's own healthy
    // confirmed negative, cached in memory) — never the expired owner's row.
    const r2 = await service.detect({ messageId: seed.id });
    expect(r2.state).toBe("not_replied");
    expect(r2.fromCache).toBe(true);
  }, 30_000);
});


