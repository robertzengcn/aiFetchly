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
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { canonicalReplyKey } from "@/service/emailReceive/EmailReplyIdentity";

// Guard-model tests construct models directly with an explicit dbpath (same
// pattern as EmailReplySendClaim.integration.test.ts), but the models extend
// BaseDb which resolves the singleton via SqliteDb.getInstance(filepath). A
// second vitest worker running synchronize() DDL against the shared
// `aifetchly-test` file throws SQLITE_BUSY, so reset the singleton onto an
// isolated per-run temp path — same Token-free isolation as the recovery test.
// No Token mock is needed because these tests construct models directly and
// never call BaseModule fallbacks.

/**
 * T07/FR-035 — DB integration proof of the generation-reservation acquire
 * (technical design §8.1) and its fences (§8.2). These cannot be asserted with
 * mocks: the entire point is the unique (emailServiceId, replyKey) index +
 * conditional owner/lease UPDATEs inside the shared reply write mutex.
 */
describe("EmailReplyGuardModel reservation (T07) — DB integration", () => {
  let dbpath: string;
  let guardModel: EmailReplyGuardModel;
  let draftModel: EmailReplyDraftModel;
  let attemptModel: EmailReplySendAttemptModel;

  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-reply-guard-${Date.now()}`);
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

  const SERVICE_ID = 7;

  function acquireInput(over: Partial<Parameters<EmailReplyGuardModel["acquireReservation"]>[0]> = {}) {
    const now = new Date();
    return {
      emailServiceId: SERVICE_ID,
      replyKey: "row:100",
      messageId: 100,
      ownerToken: "a".repeat(128),
      leaseExpiresAt: new Date(now.getTime() + 5 * 60_000),
      now,
      normalizedMessageId: null,
      ...over,
    };
  }

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

  /** Seed a draft row directly on a message row. */
  async function seedDraft(
    messageId: number,
    status: EmailReplyDraftEntity["status"],
    over: Partial<EmailReplyDraftEntity> = {}
  ): Promise<EmailReplyDraftEntity> {
    const draft = new EmailReplyDraftEntity();
    draft.messageId = messageId;
    draft.emailServiceId = SERVICE_ID;
    draft.subject = "Re: Pricing?";
    draft.bodyText = "Here is our pricing.";
    draft.bodyHtml = null;
    draft.status = status;
    draft.generationSource = "ai";
    Object.assign(draft, over);
    return await draftModel.create(draft);
  }

  /** Seed a send-attempt row directly on a message row. */
  async function seedAttempt(
    messageId: number,
    status: "claimed" | "submitted" | "sent" | "failed" | "delivery_unknown"
  ): Promise<EmailReplySendAttemptEntity> {
    const attempt = new EmailReplySendAttemptEntity();
    attempt.idempotencyKey = `guard-${status}-${Math.random()}`;
    attempt.draftId = 1;
    attempt.revisionId = 1;
    attempt.approvalId = 1;
    attempt.messageId = messageId;
    attempt.conversationId = null;
    attempt.emailServiceId = SERVICE_ID;
    attempt.senderAddress = "me@x.com";
    attempt.recipientAddress = "prospect@example.com";
    attempt.status = status;
    attempt.claimedAt = new Date();
    return await attemptModel.create(attempt);
  }

  it("acquires on a clean cluster (INSERT path)", async () => {
    const msg = await seedMessage();
    const result = await guardModel.acquireReservation(
      acquireInput({
        replyKey: canonicalReplyKey({
          normalizedMessageId: msg.normalizedMessageId,
          rowId: msg.id,
        }),
        messageId: msg.id,
      })
    );
    expect(result.status).toBe("acquired");
    if (result.status === "acquired") {
      const row = await guardModel.read(result.guardId);
      expect(row?.phase).toBe("generating");
      expect(row?.ownerToken).toBe("a".repeat(128));
    }
  });

  it("second concurrent acquire on the same key returns generation_in_progress", async () => {
    const msg = await seedMessage();
    const replyKey = canonicalReplyKey({
      normalizedMessageId: msg.normalizedMessageId,
      rowId: msg.id,
    });
    const first = await guardModel.acquireReservation(
      acquireInput({ replyKey, messageId: msg.id })
    );
    expect(first.status).toBe("acquired");

    const second = await guardModel.acquireReservation(
      acquireInput({
        replyKey,
        messageId: msg.id,
        ownerToken: "b".repeat(128),
      })
    );
    expect(second.status).toBe("generation_in_progress");
  });

  it("reuses an eligible existing draft instead of acquiring (B08 short-circuit)", async () => {
    const msg = await seedMessage();
    await seedDraft(msg.id, "draft");
    const result = await guardModel.acquireReservation(
      acquireInput({
        replyKey: canonicalReplyKey({
          normalizedMessageId: msg.normalizedMessageId,
          rowId: msg.id,
        }),
        messageId: msg.id,
      })
    );
    expect(result.status).toBe("reusable");
    if (result.status === "reusable") {
      expect(result.draftId).toBeGreaterThan(0);
    }
    // No guard row was created for this replyKey (reuse short-circuits before
    // the INSERT).
    const row = await guardModel.findByReplyKey(
      SERVICE_ID,
      canonicalReplyKey({
        normalizedMessageId: msg.normalizedMessageId,
        rowId: msg.id,
      })
    );
    expect(row).toBeNull();
  });

  it("blocks generation when a sent attempt exists (already_replied)", async () => {
    const msg = await seedMessage();
    await seedAttempt(msg.id, "sent");
    const result = await guardModel.acquireReservation(
      acquireInput({
        replyKey: canonicalReplyKey({
          normalizedMessageId: msg.normalizedMessageId,
          rowId: msg.id,
        }),
        messageId: msg.id,
      })
    );
    expect(result).toEqual({ status: "blocked", code: "already_replied" });
  });

  it("blocks generation when an attempt has an ambiguous delivery outcome", async () => {
    const msg = await seedMessage();
    await seedAttempt(msg.id, "delivery_unknown");
    const result = await guardModel.acquireReservation(
      acquireInput({
        replyKey: canonicalReplyKey({
          normalizedMessageId: msg.normalizedMessageId,
          rowId: msg.id,
        }),
        messageId: msg.id,
      })
    );
    expect(result).toEqual({ status: "blocked", code: "delivery_unknown" });
  });

  it("blocks generation while a send is in flight", async () => {
    const msg = await seedMessage();
    await seedAttempt(msg.id, "submitted");
    const result = await guardModel.acquireReservation(
      acquireInput({
        replyKey: canonicalReplyKey({
          normalizedMessageId: msg.normalizedMessageId,
          rowId: msg.id,
        }),
        messageId: msg.id,
      })
    );
    expect(result).toEqual({ status: "blocked", code: "reply_in_progress" });
  });

  it("reclaims an expired lease from a different owner", async () => {
    const msg = await seedMessage();
    const replyKey = canonicalReplyKey({
      normalizedMessageId: msg.normalizedMessageId,
      rowId: msg.id,
    });
    const first = await guardModel.acquireReservation(
      acquireInput({ replyKey, messageId: msg.id })
    );
    expect(first.status).toBe("acquired");

    // Expire owner A's lease, then owner B acquires.
    const later = new Date(Date.now() + 10 * 60_000);
    const second = await guardModel.acquireReservation(
      acquireInput({
        replyKey,
        messageId: msg.id,
        ownerToken: "b".repeat(128),
        now: later,
        leaseExpiresAt: new Date(later.getTime() + 5 * 60_000),
      })
    );
    expect(second.status).toBe("acquired");
  });

  it("release by a non-owner is a no-op (fence)", async () => {
    const msg = await seedMessage();
    const replyKey = canonicalReplyKey({
      normalizedMessageId: msg.normalizedMessageId,
      rowId: msg.id,
    });
    const first = await guardModel.acquireReservation(
      acquireInput({ replyKey, messageId: msg.id })
    );
    if (first.status !== "acquired") {
      throw new Error("expected acquire");
    }
    // Non-owner release must not clear the active owner.
    await guardModel.releaseReservation({
      guardId: first.guardId,
      ownerToken: "b".repeat(128),
      now: new Date(),
    });
    const row = await guardModel.read(first.guardId);
    expect(row?.phase).toBe("generating");
    expect(row?.ownerToken).toBe("a".repeat(128));

    // Owner release clears it.
    await guardModel.releaseReservation({
      guardId: first.guardId,
      ownerToken: "a".repeat(128),
      now: new Date(),
    });
    const released = await guardModel.read(first.guardId);
    expect(released?.phase).toBe("idle");
    expect(released?.ownerToken).toBeNull();
  });

  it("extendLease by a replaced owner returns false (fence)", async () => {
    const msg = await seedMessage();
    const replyKey = canonicalReplyKey({
      normalizedMessageId: msg.normalizedMessageId,
      rowId: msg.id,
    });
    const first = await guardModel.acquireReservation(
      acquireInput({ replyKey, messageId: msg.id })
    );
    if (first.status !== "acquired") {
      throw new Error("expected acquire");
    }
    // Owner A's lease expires; owner B reclaims.
    const later = new Date(Date.now() + 10 * 60_000);
    await guardModel.acquireReservation(
      acquireInput({
        replyKey,
        messageId: msg.id,
        ownerToken: "b".repeat(128),
        now: later,
        leaseExpiresAt: new Date(later.getTime() + 5 * 60_000),
      })
    );
    // Owner A's late extend fails — its token no longer matches.
    const extended = await guardModel.extendLease({
      guardId: first.guardId,
      ownerToken: "a".repeat(128),
      newExpiresAt: new Date(Date.now() + 60_000),
      now: new Date(),
    });
    expect(extended).toBe(false);
  });

  it("commit by an expired/replaced owner returns false (fenced late result)", async () => {
    const msg = await seedMessage();
    const replyKey = canonicalReplyKey({
      normalizedMessageId: msg.normalizedMessageId,
      rowId: msg.id,
    });
    const first = await guardModel.acquireReservation(
      acquireInput({ replyKey, messageId: msg.id })
    );
    if (first.status !== "acquired") {
      throw new Error("expected acquire");
    }
    // Owner A's lease expires; owner B reclaims.
    const later = new Date(Date.now() + 10 * 60_000);
    await guardModel.acquireReservation(
      acquireInput({
        replyKey,
        messageId: msg.id,
        ownerToken: "b".repeat(128),
        now: later,
        leaseExpiresAt: new Date(later.getTime() + 5 * 60_000),
      })
    );
    // Owner A's late commit fails — the late LLM output is discarded (§8.2).
    const committed = await guardModel.commitDraftToGuard({
      guardId: first.guardId,
      ownerToken: "a".repeat(128),
      now: new Date(),
      activeDraftId: 999,
    });
    expect(committed).toBe(false);
    const row = await guardModel.read(first.guardId);
    expect(row?.ownerToken).toBe("b".repeat(128));
    expect(row?.phase).toBe("generating");
  });

  it("reclaimExpiredReservation transitions to draft_ready when a committed draft survived the crash", async () => {
    const msg = await seedMessage();
    const replyKey = canonicalReplyKey({
      normalizedMessageId: msg.normalizedMessageId,
      rowId: msg.id,
    });
    const first = await guardModel.acquireReservation(
      acquireInput({ replyKey, messageId: msg.id })
    );
    if (first.status !== "acquired") {
      throw new Error("expected acquire");
    }
    // Simulate the crash: draft committed, guard left generating + expired.
    const draft = await seedDraft(msg.id, "draft");
    const later = new Date(Date.now() + 10 * 60_000);
    const reclaimed = await guardModel.reclaimExpiredReservation({
      guardId: first.guardId,
      now: later,
    });
    expect(reclaimed).toBe(true);
    const row = await guardModel.read(first.guardId);
    expect(row?.phase).toBe("draft_ready");
    expect(row?.activeDraftId).toBe(draft.id);
    expect(row?.ownerToken).toBeNull();
  });

  it("reclaimExpiredReservation transitions to sent when a sent attempt exists", async () => {
    const msg = await seedMessage();
    const replyKey = canonicalReplyKey({
      normalizedMessageId: msg.normalizedMessageId,
      rowId: msg.id,
    });
    const first = await guardModel.acquireReservation(
      acquireInput({ replyKey, messageId: msg.id })
    );
    if (first.status !== "acquired") {
      throw new Error("expected acquire");
    }
    await seedAttempt(msg.id, "sent");
    const later = new Date(Date.now() + 10 * 60_000);
    await guardModel.reclaimExpiredReservation({
      guardId: first.guardId,
      now: later,
    });
    const row = await guardModel.read(first.guardId);
    expect(row?.phase).toBe("sent");
  });

  it("reclaimExpiredReservation transitions to idle when the cluster is clean", async () => {
    const msg = await seedMessage();
    const replyKey = canonicalReplyKey({
      normalizedMessageId: msg.normalizedMessageId,
      rowId: msg.id,
    });
    const first = await guardModel.acquireReservation(
      acquireInput({ replyKey, messageId: msg.id })
    );
    if (first.status !== "acquired") {
      throw new Error("expected acquire");
    }
    const later = new Date(Date.now() + 10 * 60_000);
    await guardModel.reclaimExpiredReservation({
      guardId: first.guardId,
      now: later,
    });
    const row = await guardModel.read(first.guardId);
    expect(row?.phase).toBe("idle");
    expect(row?.ownerToken).toBeNull();
  });

  it("reclaimExpiredReservation leaves a fresh (unexpired) lease untouched", async () => {
    const msg = await seedMessage();
    const replyKey = canonicalReplyKey({
      normalizedMessageId: msg.normalizedMessageId,
      rowId: msg.id,
    });
    const first = await guardModel.acquireReservation(
      acquireInput({ replyKey, messageId: msg.id })
    );
    if (first.status !== "acquired") {
      throw new Error("expected acquire");
    }
    const reclaimed = await guardModel.reclaimExpiredReservation({
      guardId: first.guardId,
      now: new Date(), // lease is still valid
    });
    expect(reclaimed).toBe(false);
    const row = await guardModel.read(first.guardId);
    expect(row?.phase).toBe("generating");
    expect(row?.ownerToken).toBe("a".repeat(128));
  });

  it("listStaleReservations only reports expired generating/draft_ready rows", async () => {
    const msg = await seedMessage();
    const replyKey = canonicalReplyKey({
      normalizedMessageId: msg.normalizedMessageId,
      rowId: msg.id,
    });
    const first = await guardModel.acquireReservation(
      acquireInput({ replyKey, messageId: msg.id })
    );
    if (first.status !== "acquired") {
      throw new Error("expected acquire");
    }
    const before = await guardModel.listStaleReservations(new Date());
    expect(before.some((r) => r.id === first.guardId)).toBe(false);

    const later = new Date(Date.now() + 10 * 60_000);
    const stale = await guardModel.listStaleReservations(later);
    expect(stale.some((r) => r.id === first.guardId)).toBe(true);
  });

  it("same-owner re-entrant acquire extends the lease", async () => {
    const msg = await seedMessage();
    const replyKey = canonicalReplyKey({
      normalizedMessageId: msg.normalizedMessageId,
      rowId: msg.id,
    });
    const token = "c".repeat(128);
    const first = await guardModel.acquireReservation(
      acquireInput({ replyKey, messageId: msg.id, ownerToken: token })
    );
    expect(first.status).toBe("acquired");
    if (first.status !== "acquired") {
      throw new Error("expected acquire");
    }
    // Same owner re-acquires (e.g. retry after a transient failure) — lease
    // extends, still owned.
    const again = await guardModel.acquireReservation(
      acquireInput({
        replyKey,
        messageId: msg.id,
        ownerToken: token,
        leaseExpiresAt: new Date(Date.now() + 10 * 60_000),
      })
    );
    expect(again).toEqual({ status: "acquired", guardId: first.guardId });
  });

  // ---------------------------------------------------------------------------
  // D2 (review): the conditional-acquire INSERT path's bare `catch {}` was a
  // silent swallow. The catch now binds the error, rethrows non-unique-constraint
  // failures (R-2: never mask a persistent DB error as a transient retry
  // signal), and routes the recoverable unique-constraint collision through
  // console.error (the swallow stays — the reread below is the recovery). The
  // race window between `findOne` and `save` is not reliably reproducible in a
  // single-process test (the second acquire finds the row on the first reread
  // and never enters the INSERT path), so this is a source-contract guard that
  // fails at test time if the catch is reverted to a bare silent swallow —
  // mirrors EmailReplyD7Seams / EmailReplyPreDraftPolicy's structural gates.
  // ---------------------------------------------------------------------------
  it("conditional-acquire INSERT catch binds the error and logs (D2 source contract)", async () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../../../src/model/EmailReplyGuard.model.ts"),
      "utf8"
    );
    // The catch must bind the error (no bare `catch {}`) and route it through
    // console.error — the swallow is no longer silent.
    expect(src).toMatch(/catch\s*\(\s*error\s*\)\s*\{/);
    expect(src).toMatch(/console\.error/);
    // R-2: non-unique-constraint insert failures must propagate, never be
    // masked as a transient retry signal.
    expect(src).toMatch(/isUniqueConstraintInsertError/);
    expect(src).toMatch(/if\s*\(!isUniqueConstraintInsertError\(error\)\)\s*\{\s*\n\s*throw error/);
    // The recovery comment is preserved so the swallow's intent stays documented.
    expect(src).toMatch(/reread and fall through/i);
  });
});
