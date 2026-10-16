import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { SqliteDb } from "@/config/SqliteDb";
import { EmailReplySendRecoveryService } from "@/service/emailReply/EmailReplySendRecoveryService";
import { EmailReplySendAttemptModule } from "@/modules/EmailReplySendAttemptModule";
import { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";
import { EmailReplyGuardModel } from "@/model/EmailReplyGuard.model";
import { EmailReplyDraftModel } from "@/model/EmailReplyDraft.model";
import { EmailReplyGuardEntity } from "@/entity/EmailReplyGuard.entity";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";

// The recovery service constructs its own EmailReplySendAttemptModule
// internally, which resolves its dbpath via Token.getValue(USERSDBPATH) ->
// BaseModule fallback to the shared `aifetchly-test` path. Under parallel
// vitest workers, two workers running TypeORM synchronize() DDL against that
// shared file throw SQLITE_BUSY. Mock Token so USERSDBPATH points at an
// isolated per-run temp path, then reset the SqliteDb singleton onto it so
// both the seeding module and the service-internal module see one private
// connection. Mirrors the Token-mock isolation in ai-chat-v2-ipc.test.ts.
const mockTokenStore = vi.hoisted(() => new Map<string, string>());
vi.mock("@/modules/token", () => ({
  Token: class {
    constructor() {
      return {
    getValue: vi
      .fn()
      .mockImplementation((key: string) => mockTokenStore.get(key) ?? ""),
    setValue: vi
      .fn()
      .mockImplementation((key: string, value: string) =>
        mockTokenStore.set(key, value)
      ),
    deleteValue: vi
      .fn()
      .mockImplementation((key: string) => mockTokenStore.delete(key)),
    hasValue: vi
      .fn()
      .mockImplementation(
        (key: string) =>
          mockTokenStore.has(key) && (mockTokenStore.get(key)?.length ?? 0) > 0
      ),
  };
    }
  },
}));

/**
 * P0.6/G6: the bounded recovery sweep marks stale in-flight attempts
 * (`claimed`/`submitted` older than the threshold) as `delivery_unknown` —
 * NEVER failed — and leaves fresh in-flight + finalized attempts untouched.
 * It never re-submits SMTP.
 */
describe("EmailReplySendRecoveryService sweep", () => {
  let dbpath: string;
  let attemptModule: EmailReplySendAttemptModule;

  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-reply-recovery-${Date.now()}`);
    fs.mkdirSync(dbpath, { recursive: true });
    // Point the mocked Token store at the isolated path so the service's
    // internal Token-fallback modules resolve it (not aifetchly-test).
    mockTokenStore.set("USERSDBPATH", dbpath);
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    // Construct AFTER reset so BaseModule captures the isolated dbpath.
    attemptModule = new EmailReplySendAttemptModule();
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    try {
      fs.rmSync(dbpath, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  async function seedAttempt(
    status: "claimed" | "submitted" | "sent" | "failed",
    claimedAt: Date
  ): Promise<number> {
    const attempt = new EmailReplySendAttemptEntity();
    attempt.idempotencyKey = `rec-${status}-${claimedAt.getTime()}-${Math.random()}`;
    attempt.draftId = 1;
    attempt.revisionId = 1;
    attempt.approvalId = 1;
    attempt.messageId = 1;
    attempt.conversationId = null;
    attempt.emailServiceId = 7;
    attempt.senderAddress = "me@x.com";
    attempt.recipientAddress = "p@x.com";
    attempt.status = status;
    attempt.claimedAt = claimedAt;
    const saved = await attemptModule.create(attempt);
    return saved.id;
  }

  it("marks stale claimed/submitted as delivery_unknown, never failed; skips fresh + terminal", async () => {
    const old = new Date(Date.now() - 10 * 60 * 1000);
    const fresh = new Date();
    const staleClaimed = await seedAttempt("claimed", old);
    const staleSubmitted = await seedAttempt("submitted", old);
    const freshClaimed = await seedAttempt("claimed", fresh);
    const sentAttempt = await seedAttempt("sent", old);

    const result =
      await new EmailReplySendRecoveryService().recoverStaleAttempts(
        5 * 60 * 1000
      );

    expect(result.recovered).toBe(2);
    expect(result.needsAttention).toBe(true);

    expect((await attemptModule.read(staleClaimed))?.status).toBe(
      "delivery_unknown"
    );
    expect((await attemptModule.read(staleSubmitted))?.status).toBe(
      "delivery_unknown"
    );
    // Fresh in-flight + finalized attempts untouched.
    expect((await attemptModule.read(freshClaimed))?.status).toBe("claimed");
    expect((await attemptModule.read(sentAttempt))?.status).toBe("sent");
  });

  it("reports zero when nothing is stale", async () => {
    const result =
      await new EmailReplySendRecoveryService().recoverStaleAttempts(
        60 * 60 * 1000
      );
    expect(result.recovered).toBe(0);
    expect(result.needsAttention).toBe(false);
  });
});

/**
 * T07/FR-035 (§8.2) — the reservation sweep reclaims expired generation
 * reservations AFTER reconciling against actual draft/attempt records: a
 * committed draft survives the crash (guard → `draft_ready`), a sent attempt
 * keeps terminal protection (→ `sent`), and a clean cluster reclaims to
 * `idle`. A fresh (unexpired) lease is never touched. The service drives the
 * guard module through its own Token-fallback modules, so this runs through
 * the SAME isolated Token-mocked dbpath as the attempt sweep above.
 */
describe("EmailReplySendRecoveryService reservation sweep (T07)", () => {
  let dbpath: string;
  let guardModel: EmailReplyGuardModel;
  let draftModel: EmailReplyDraftModel;

  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-reply-recovery-${Date.now()}`);
    fs.mkdirSync(dbpath, { recursive: true });
    mockTokenStore.set("USERSDBPATH", dbpath);
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    // Construct AFTER reset so BaseModule captures the isolated dbpath.
    guardModel = new EmailReplyGuardModel(dbpath);
    draftModel = new EmailReplyDraftModel(dbpath);
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

  /** Seed a received-message row as the canonical cluster seed. */
  async function seedMessage(): Promise<EmailReceivedMessageEntity> {
    const message = new EmailReceivedMessageEntity();
    message.emailServiceId = SERVICE_ID;
    message.providerUid = `uid-${Math.random()}`;
    message.fromAddress = "prospect@example.com";
    message.toAddressesJson = '["me@x.com"]';
    message.subject = "Pricing?";
    message.receivedAt = new Date();
    return await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .save(message);
  }

  /**
   * Seed a stale reservation guard row the way the generation service would
   * have left it after a crash: `phase = generating`, expired lease, owner
   * token set.
   */
  async function seedStaleGuard(
    message: EmailReceivedMessageEntity
  ): Promise<EmailReplyGuardEntity> {
    const guard = new EmailReplyGuardEntity();
    guard.emailServiceId = SERVICE_ID;
    guard.replyKey = `row:${message.id}`;
    guard.messageId = message.id;
    guard.phase = "generating";
    guard.ownerToken = "crashed-owner".padEnd(128, "0");
    guard.leaseExpiresAt = new Date(Date.now() - 10 * 60 * 1000);
    guard.activeDraftId = null;
    guard.activeAttemptId = null;
    return await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReplyGuardEntity)
      .save(guard);
  }

  /** Seed a committed live draft on a message row. */
  async function seedDraft(
    messageId: number,
    status: EmailReplyDraftEntity["status"]
  ): Promise<EmailReplyDraftEntity> {
    const draft = new EmailReplyDraftEntity();
    draft.messageId = messageId;
    draft.emailServiceId = SERVICE_ID;
    draft.subject = "Re: Pricing?";
    draft.bodyText = "Here is our pricing.";
    draft.bodyHtml = null;
    draft.status = status;
    draft.generationSource = "ai";
    return await draftModel.create(draft);
  }

  it("returns zero when no reservation is stale", async () => {
    const msg = await seedMessage();
    const guard = await seedStaleGuard(msg);
    // Make the lease unexpired — the sweep must leave it alone.
    await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReplyGuardEntity)
      .update({ id: guard.id }, { leaseExpiresAt: new Date(Date.now() + 5 * 60_000) });

    const reclaimed =
      await new EmailReplySendRecoveryService().recoverStaleReservations();

    expect(reclaimed).toBe(0);
    const row = await guardModel.read(guard.id);
    expect(row?.phase).toBe("generating");
    expect(row?.ownerToken).not.toBeNull();
  });

  it("reclaims a stale generating reservation to idle on a clean cluster", async () => {
    const msg = await seedMessage();
    const guard = await seedStaleGuard(msg);

    const reclaimed =
      await new EmailReplySendRecoveryService().recoverStaleReservations();

    expect(reclaimed).toBe(1);
    const row = await guardModel.read(guard.id);
    expect(row?.phase).toBe("idle");
    expect(row?.ownerToken).toBeNull();
    expect(row?.leaseExpiresAt).toBeNull();
  });

  it("reclaims a stale generating reservation to draft_ready when a committed draft survived", async () => {
    const msg = await seedMessage();
    const guard = await seedStaleGuard(msg);
    const draft = await seedDraft(msg.id, "draft");

    const reclaimed =
      await new EmailReplySendRecoveryService().recoverStaleReservations();

    expect(reclaimed).toBe(1);
    const row = await guardModel.read(guard.id);
    expect(row?.phase).toBe("draft_ready");
    expect(row?.activeDraftId).toBe(draft.id);
    expect(row?.ownerToken).toBeNull();
  });

  it("reclaims a stale generating reservation to sent when a sent attempt exists", async () => {
    const msg = await seedMessage();
    const guard = await seedStaleGuard(msg);
    await seedDraft(msg.id, "draft");
    // A sent attempt on the same cluster outranks the live draft (FR-029).
    const attempt = new EmailReplySendAttemptEntity();
    attempt.idempotencyKey = `rec-reservation-sent-${Math.random()}`;
    attempt.draftId = 1;
    attempt.revisionId = 1;
    attempt.approvalId = 1;
    attempt.messageId = msg.id;
    attempt.conversationId = null;
    attempt.emailServiceId = SERVICE_ID;
    attempt.senderAddress = "me@x.com";
    attempt.recipientAddress = "prospect@example.com";
    attempt.status = "sent";
    attempt.claimedAt = new Date();
    const attemptModule = new EmailReplySendAttemptModule();
    const saved = await attemptModule.create(attempt);
    expect(saved.id).toBeGreaterThan(0);

    const reclaimed =
      await new EmailReplySendRecoveryService().recoverStaleReservations();

    expect(reclaimed).toBe(1);
    const row = await guardModel.read(guard.id);
    expect(row?.phase).toBe("sent");
  });
});

/**
 * T08/FR-036 (§9) — finalize/discard/reconcile guard transitions. The recovery
 * sweep and manual reconciliation drive `finalizeSendOutcome` /
 * `reconcileDelivery`, which now transition the bound guard row in the same
 * transaction:
 *   - stale in-flight attempt → `delivery_unknown` (guard follows).
 *   - late `sent` after a recovery `delivery_unknown` → attempt + guard UPGRADE
 *     to `sent` (§9: late success outranks an earlier unknown).
 *   - late `failed` after `sent` → 0 rows, no downgrade (guard stays `sent`).
 *   - `confirm_sent` → guard `sent`; `confirm_not_sent` refused while a
 *     DIFFERENT attempt is in flight (§9).
 */
describe("EmailReplySendRecoveryService guard transitions (T08)", () => {
  let dbpath: string;
  let guardModel: EmailReplyGuardModel;
  let draftModel: EmailReplyDraftModel;
  let attemptModule: EmailReplySendAttemptModule;

  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-reply-recovery-${Date.now()}`);
    fs.mkdirSync(dbpath, { recursive: true });
    mockTokenStore.set("USERSDBPATH", dbpath);
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    // Construct AFTER reset so BaseModule captures the isolated dbpath.
    guardModel = new EmailReplyGuardModel(dbpath);
    draftModel = new EmailReplyDraftModel(dbpath);
    attemptModule = new EmailReplySendAttemptModule();
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

  async function seedMessage(): Promise<EmailReceivedMessageEntity> {
    const message = new EmailReceivedMessageEntity();
    message.emailServiceId = SERVICE_ID;
    message.providerUid = `uid-${Math.random()}`;
    message.fromAddress = "prospect@example.com";
    message.toAddressesJson = '["me@x.com"]';
    message.subject = "Pricing?";
    message.receivedAt = new Date();
    return await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .save(message);
  }

  /** Seed a guard row bound to a sending attempt (as the send claim leaves it). */
  async function seedSendingGuard(
    message: EmailReceivedMessageEntity,
    attemptId: number,
    phase: EmailReplyGuardEntity["phase"] = "sending",
    activeAttemptId: number | null = attemptId
  ): Promise<EmailReplyGuardEntity> {
    const guard = new EmailReplyGuardEntity();
    guard.emailServiceId = SERVICE_ID;
    guard.replyKey = `row:${message.id}`;
    guard.messageId = message.id;
    guard.phase = phase;
    guard.ownerToken = null;
    guard.leaseExpiresAt = null;
    guard.activeDraftId = null;
    guard.activeAttemptId = activeAttemptId;
    return await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReplyGuardEntity)
      .save(guard);
  }

  async function seedAttempt(
    message: EmailReceivedMessageEntity,
    draftId: number,
    status: "claimed" | "submitted" | "sent" | "failed" | "delivery_unknown",
    claimedAt: Date
  ): Promise<EmailReplySendAttemptEntity> {
    const attempt = new EmailReplySendAttemptEntity();
    attempt.idempotencyKey = `t08-guard-${status}-${Math.random()}`;
    attempt.draftId = draftId;
    attempt.revisionId = 1;
    attempt.approvalId = 1;
    attempt.messageId = message.id;
    attempt.conversationId = null;
    attempt.emailServiceId = SERVICE_ID;
    attempt.senderAddress = "me@x.com";
    attempt.recipientAddress = "prospect@example.com";
    attempt.status = status;
    attempt.claimedAt = claimedAt;
    return await attemptModule.create(attempt);
  }

  /** Seed a draft row on a message (mirrors the reservation-sweep seedDraft). */
  async function seedDraft(
    messageId: number,
    status: EmailReplyDraftEntity["status"]
  ): Promise<EmailReplyDraftEntity> {
    const draft = new EmailReplyDraftEntity();
    draft.messageId = messageId;
    draft.emailServiceId = SERVICE_ID;
    draft.subject = "Re: Pricing?";
    draft.bodyText = "Here is our pricing.";
    draft.bodyHtml = null;
    draft.status = status;
    draft.generationSource = "ai";
    return await draftModel.create(draft);
  }

  it("recovery sweep transitions a bound guard to delivery_unknown alongside the attempt", async () => {
    const msg = await seedMessage();
    const draft = await seedDraft(msg.id, "sending");
    const old = new Date(Date.now() - 10 * 60 * 1000);
    const attempt = await seedAttempt(msg, draft.id, "submitted", old);
    const guard = await seedSendingGuard(msg, attempt.id);

    const result =
      await new EmailReplySendRecoveryService().recoverStaleAttempts(
        5 * 60 * 1000
      );

    expect(result.recovered).toBe(1);
    expect((await attemptModule.read(attempt.id))?.status).toBe(
      "delivery_unknown"
    );
    const row = await guardModel.read(guard.id);
    expect(row?.phase).toBe("delivery_unknown");
    expect(row?.activeAttemptId).toBeNull();
  });

  it("a late sent finalization upgrades a recovery delivery_unknown (attempt + guard)", async () => {
    const msg = await seedMessage();
    const draft = await seedDraft(msg.id, "delivery_unknown");
    const old = new Date(Date.now() - 10 * 60 * 1000);
    const attempt = await seedAttempt(msg, draft.id, "delivery_unknown", old);
    const guard = await seedSendingGuard(msg, attempt.id, "delivery_unknown", null);

    // Late SMTP success: the delivery service finalizes outcome=sent. The
    // conditional fence must match `delivery_unknown` (§9 upgrade) for BOTH
    // the attempt and the guard.
    await draftModel.finalizeSendOutcome({
      attemptId: attempt.id,
      draftId: draft.id,
      approvalId: attempt.approvalId,
      emailServiceId: SERVICE_ID,
      messageId: msg.id,
      outcome: "sent",
      providerMessageId: "late-smtp-1",
      failureCode: null,
      sanitizedError: null,
      messageReplyStatus: "sent",
      guardId: guard.id,
    });

    expect((await attemptModule.read(attempt.id))?.status).toBe("sent");
    const row = await guardModel.read(guard.id);
    expect(row?.phase).toBe("sent");
    expect(row?.activeAttemptId).toBeNull();
  });

  it("a late failed finalization cannot downgrade a sent attempt or guard", async () => {
    const msg = await seedMessage();
    const draft = await seedDraft(msg.id, "sent");
    const old = new Date(Date.now() - 10 * 60 * 1000);
    const attempt = await seedAttempt(msg, draft.id, "sent", old);
    const guard = await seedSendingGuard(msg, attempt.id, "sent", null);

    // A late `failed` arrives after `sent` was authoritative — the strict
    // fence `status IN (claimed, submitted)` must NOT match, so nothing is
    // written (attempt, draft, guard all stay sent/terminal).
    await draftModel.finalizeSendOutcome({
      attemptId: attempt.id,
      draftId: draft.id,
      approvalId: attempt.approvalId,
      emailServiceId: SERVICE_ID,
      messageId: msg.id,
      outcome: "failed",
      failureCode: "unknown",
      sanitizedError: "late disconnect",
      guardId: guard.id,
    });

    expect((await attemptModule.read(attempt.id))?.status).toBe("sent");
    const row = await guardModel.read(guard.id);
    expect(row?.phase).toBe("sent");
  });

  it("finalizeSendOutcome skips the guard transition when no guardId is passed (legacy)", async () => {
    const msg = await seedMessage();
    const draft = await seedDraft(msg.id, "sending");
    const attempt = await seedAttempt(msg, draft.id, "submitted", new Date());
    // A pre-guard guard row in some unrelated phase — must be untouched.
    const guard = await seedSendingGuard(msg, attempt.id, "idle", null);

    await draftModel.finalizeSendOutcome({
      attemptId: attempt.id,
      draftId: draft.id,
      approvalId: attempt.approvalId,
      emailServiceId: SERVICE_ID,
      messageId: msg.id,
      outcome: "sent",
      messageReplyStatus: "sent",
      guardId: null,
    });

    expect((await attemptModule.read(attempt.id))?.status).toBe("sent");
    const row = await guardModel.read(guard.id);
    expect(row?.phase).toBe("idle");
  });

  it("confirm_sent reconciliation transitions the bound guard to sent", async () => {
    const msg = await seedMessage();
    const draft = await seedDraft(msg.id, "delivery_unknown");
    const old = new Date(Date.now() - 10 * 60 * 1000);
    const attempt = await seedAttempt(msg, draft.id, "delivery_unknown", old);
    const guard = await seedSendingGuard(msg, attempt.id, "delivery_unknown", null);

    const service = new EmailReplySendRecoveryService();
    await service.reconcileAttempt({
      attemptId: attempt.id,
      action: "confirm_sent",
      evidence: "mailbox verified",
    });

    expect((await attemptModule.read(attempt.id))?.status).toBe("sent");
    const row = await guardModel.read(guard.id);
    expect(row?.phase).toBe("sent");
    expect(row?.activeAttemptId).toBeNull();
  });

  it("confirm_not_sent is refused while a DIFFERENT attempt is in flight (§9)", async () => {
    const msg = await seedMessage();
    const draft = await seedDraft(msg.id, "delivery_unknown");
    const old = new Date(Date.now() - 10 * 60 * 1000);
    // The attempt being reconciled (delivery_unknown) + a DIFFERENT in-flight
    // attempt on the same message (a sibling send still running).
    const attempt = await seedAttempt(msg, draft.id, "delivery_unknown", old);
    const sibling = await seedAttempt(msg, draft.id, "claimed", new Date());
    const guard = await seedSendingGuard(msg, sibling.id, "sending", sibling.id);

    const service = new EmailReplySendRecoveryService();
    await expect(
      service.reconcileAttempt({
        attemptId: attempt.id,
        action: "confirm_not_sent",
        evidence: "operator checked the mailbox",
      })
    ).rejects.toThrow(/in flight/);

    // Nothing was written: the attempt stays delivery_unknown, the draft is
    // untouched, and the in-flight sibling's guard stays `sending`.
    expect((await attemptModule.read(attempt.id))?.status).toBe(
      "delivery_unknown"
    );
    expect((await attemptModule.read(sibling.id))?.status).toBe("claimed");
    const row = await guardModel.read(guard.id);
    expect(row?.phase).toBe("sending");
    expect(row?.activeAttemptId).toBe(sibling.id);
  });

  it("confirm_not_sent reopens the draft and guard when no sibling is in flight", async () => {
    const msg = await seedMessage();
    const draft = await seedDraft(msg.id, "delivery_unknown");
    const old = new Date(Date.now() - 10 * 60 * 1000);
    const attempt = await seedAttempt(msg, draft.id, "delivery_unknown", old);
    const guard = await seedSendingGuard(msg, attempt.id, "delivery_unknown", null);

    const service = new EmailReplySendRecoveryService();
    await service.reconcileAttempt({
      attemptId: attempt.id,
      action: "confirm_not_sent",
      evidence: "operator checked the mailbox",
    });

    expect((await attemptModule.read(attempt.id))?.status).toBe("failed");
    expect((await draftModel.read(draft.id))?.status).toBe("draft");
    const row = await guardModel.read(guard.id);
    expect(row?.phase).toBe("draft_ready");
    expect(row?.activeAttemptId).toBeNull();
  });

  // ---- R04 adversarial regressions ----

  it("R04: confirm_not_sent on a still-claimed attempt is refused; late success is still recorded", async () => {
    const msg = await seedMessage();
    const draft = await seedDraft(msg.id, "sending");
    // The original SMTP submitter is STILL RUNNING: attempt is `claimed`, not
    // yet recovered to `delivery_unknown`. Reconciliation must refuse — the
    // submitter may yet succeed and its success would be lost if the attempt
    // were downgraded to `failed` (finalize cannot match `failed`).
    const attempt = await seedAttempt(msg, draft.id, "claimed", new Date());
    const guard = await seedSendingGuard(msg, attempt.id, "sending", attempt.id);

    const service = new EmailReplySendRecoveryService();
    await expect(
      service.reconcileAttempt({
        attemptId: attempt.id,
        action: "confirm_not_sent",
        evidence: "operator checked the mailbox",
      })
    ).rejects.toThrow(/still claimed/);

    // Nothing was written: the attempt stays claimed, the draft stays sending,
    // the guard stays sending bound to the live attempt.
    expect((await attemptModule.read(attempt.id))?.status).toBe("claimed");
    expect((await draftModel.read(draft.id))?.status).toBe("sending");
    const row = await guardModel.read(guard.id);
    expect(row?.phase).toBe("sending");
    expect(row?.activeAttemptId).toBe(attempt.id);

    // The late success is NOT lost — finalize can still upgrade the live
    // attempt (it matches `claimed`).
    await draftModel.finalizeSendOutcome({
      attemptId: attempt.id,
      draftId: draft.id,
      approvalId: attempt.approvalId,
      emailServiceId: SERVICE_ID,
      messageId: msg.id,
      outcome: "sent",
      providerMessageId: "late-smtp-r04-a",
      failureCode: null,
      sanitizedError: null,
      messageReplyStatus: "sent",
      guardId: guard.id,
    });
    expect((await attemptModule.read(attempt.id))?.status).toBe("sent");
    const guardAfter = await guardModel.read(guard.id);
    expect(guardAfter?.phase).toBe("sent");
  });

  it("R04: confirm_not_sent on a sent attempt is refused; terminal accepted evidence is preserved", async () => {
    const msg = await seedMessage();
    const draft = await seedDraft(msg.id, "sent");
    const old = new Date(Date.now() - 10 * 60 * 1000);
    // The attempt already succeeded (`sent`). The operator must NOT be able to
    // downgrade it to `failed` — that would lose accepted evidence and could
    // permit a duplicate send.
    const attempt = await seedAttempt(msg, draft.id, "sent", old);
    const guard = await seedSendingGuard(msg, attempt.id, "sent", null);

    const service = new EmailReplySendRecoveryService();
    await expect(
      service.reconcileAttempt({
        attemptId: attempt.id,
        action: "confirm_not_sent",
        evidence: "operator mistakenly rechecked",
      })
    ).rejects.toThrow(/already sent/);

    // Terminal accepted evidence preserved: attempt, draft, guard all stay
    // sent.
    expect((await attemptModule.read(attempt.id))?.status).toBe("sent");
    expect((await draftModel.read(draft.id))?.status).toBe("sent");
    const row = await guardModel.read(guard.id);
    expect(row?.phase).toBe("sent");
  });

  it("R04: confirm_not_sent on a submitted attempt is refused (original submitter still running)", async () => {
    const msg = await seedMessage();
    const draft = await seedDraft(msg.id, "sending");
    // `submitted` = the SMTP transport was handed the message but no response
    // yet. The original submitter is still alive and may succeed.
    const attempt = await seedAttempt(msg, draft.id, "submitted", new Date());
    const guard = await seedSendingGuard(msg, attempt.id, "sending", attempt.id);

    const service = new EmailReplySendRecoveryService();
    await expect(
      service.reconcileAttempt({
        attemptId: attempt.id,
        action: "confirm_not_sent",
        evidence: "operator checked the mailbox",
      })
    ).rejects.toThrow(/still submitted/);

    expect((await attemptModule.read(attempt.id))?.status).toBe("submitted");
    const row = await guardModel.read(guard.id);
    expect(row?.phase).toBe("sending");
    expect(row?.activeAttemptId).toBe(attempt.id);
  });

  it("R04: confirm_not_sent refuses when the cluster already has a reply (sibling positive)", async () => {
    const msg = await seedMessage();
    const draft = await seedDraft(msg.id, "delivery_unknown");
    const old = new Date(Date.now() - 10 * 60 * 1000);
    const attempt = await seedAttempt(msg, draft.id, "delivery_unknown", old);
    const guard = await seedSendingGuard(msg, attempt.id, "delivery_unknown", null);
    // A sibling message in the same canonical cluster carries a sticky
    // positive `replyDetectedAt` — the canonical identity already has a reply.
    await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .update(msg.id, { replyDetectedAt: new Date() });

    const service = new EmailReplySendRecoveryService();
    await expect(
      service.reconcileAttempt({
        attemptId: attempt.id,
        action: "confirm_not_sent",
        evidence: "operator checked the mailbox",
      })
    ).rejects.toThrow(/already has a reply/);

    // Nothing was written: the attempt stays delivery_unknown, the guard stays
    // delivery_unknown.
    expect((await attemptModule.read(attempt.id))?.status).toBe(
      "delivery_unknown"
    );
    const row = await guardModel.read(guard.id);
    expect(row?.phase).toBe("delivery_unknown");
  });

  it("R04: confirm_not_sent on a delivery_unknown target with no sibling proceeds (happy path retained)", async () => {
    const msg = await seedMessage();
    const draft = await seedDraft(msg.id, "delivery_unknown");
    const old = new Date(Date.now() - 10 * 60 * 1000);
    const attempt = await seedAttempt(msg, draft.id, "delivery_unknown", old);
    const guard = await seedSendingGuard(msg, attempt.id, "delivery_unknown", null);

    const service = new EmailReplySendRecoveryService();
    await service.reconcileAttempt({
      attemptId: attempt.id,
      action: "confirm_not_sent",
      evidence: "operator checked the mailbox, no reply found",
    });

    // The eligible delivery_unknown target IS downgraded and the guard reopened.
    expect((await attemptModule.read(attempt.id))?.status).toBe("failed");
    expect((await draftModel.read(draft.id))?.status).toBe("draft");
    const row = await guardModel.read(guard.id);
    expect(row?.phase).toBe("draft_ready");
  });

  it("R04/N02: recover→reconcile negative→late success preserves accepted evidence (terminal upgrade)", async () => {
    // The exact todo regression: "hold original SMTP, recover/reconcile
    // negatively, then deliver late success." Late ACTUAL acceptance is
    // terminal evidence and must not be lost: the `sent` outcome upgrades
    // the prematurely downgraded attempt (and its guard/message), so the
    // accepted reply is protected. No SECOND submission ever occurs — the
    // upgrade is a ledger transition on the same attempt row.
    const msg = await seedMessage();
    const draft = await seedDraft(msg.id, "sending");
    const old = new Date(Date.now() - 10 * 60 * 1000);
    // Original SMTP submitter handed off (submitted) but unresponsive; recovery
    // will mark it delivery_unknown. The transport is still alive.
    const attempt = await seedAttempt(msg, draft.id, "submitted", old);
    const guard = await seedSendingGuard(msg, attempt.id, "sending", attempt.id);

    const recovery = new EmailReplySendRecoveryService();

    // 1. Recovery sweep marks the stale in-flight attempt delivery_unknown
    //    (FR-019: never failed, never re-submits). Guard follows.
    const sweep = await recovery.recoverStaleAttempts(5 * 60 * 1000);
    expect(sweep.recovered).toBe(1);
    expect(sweep.needsAttention).toBe(true);
    expect((await attemptModule.read(attempt.id))?.status).toBe(
      "delivery_unknown"
    );
    const guardAfterRecovery = await guardModel.read(guard.id);
    expect(guardAfterRecovery?.phase).toBe("delivery_unknown");
    expect(guardAfterRecovery?.activeAttemptId).toBeNull();

    // 2. Operator negatively reconciles the now-eligible delivery_unknown
    //    target (no sibling in flight, no live submitter held in this test —
    //    the seeded transport is a row, not a running promise). The guard
    //    reopens to draft_ready so a fresh approval + send can follow.
    await recovery.reconcileAttempt({
      attemptId: attempt.id,
      action: "confirm_not_sent",
      evidence: "operator verified the mailbox — no reply was sent",
    });
    expect((await attemptModule.read(attempt.id))?.status).toBe("failed");
    expect((await draftModel.read(draft.id))?.status).toBe("draft");
    const guardAfterReconcile = await guardModel.read(guard.id);
    expect(guardAfterReconcile?.phase).toBe("draft_ready");

    // 3. The ORIGINAL submitter's late SMTP success arrives. Actual
    //    acceptance upgrades the premature downgrade: attempt → sent with
    //    the provider id, draft → sent, message → sent, guard → sent.
    await draftModel.finalizeSendOutcome({
      attemptId: attempt.id,
      draftId: draft.id,
      approvalId: attempt.approvalId,
      emailServiceId: SERVICE_ID,
      messageId: msg.id,
      outcome: "sent",
      providerMessageId: "late-smtp-after-reconcile",
      failureCode: null,
      sanitizedError: null,
      messageReplyStatus: "sent",
      guardId: guard.id,
    });

    const attemptAfterLate = await attemptModule.read(attempt.id);
    expect(attemptAfterLate?.status).toBe("sent");
    expect(attemptAfterLate?.providerMessageId).toBe(
      "late-smtp-after-reconcile"
    );
    expect((await draftModel.read(draft.id))?.status).toBe("sent");
    const guardAfterLate = await guardModel.read(guard.id);
    expect(guardAfterLate?.phase).toBe("sent");
    expect(guardAfterLate?.activeAttemptId).toBeNull();
  });

  it("N02/F02: negative reconciliation refuses while the original submitter is still running", async () => {
    // A REAL held submitter (not just a stale row): the tracker marks the
    // original transport alive past the recovery threshold. Recovery still
    // marks the row unknown (it cannot see liveness), but the negative
    // reconciliation must refuse until quiescence is proven. Clearing the
    // mark (process death/restart semantics) reopens the downgrade.
    const {
      markSubmitterRunning,
      markSubmitterSettled,
      clearSubmitterTrackerForTests,
    } = await import("@/service/emailReply/EmailReplySubmitterTracker");
    clearSubmitterTrackerForTests();
    try {
      const msg = await seedMessage();
      const draft = await seedDraft(msg.id, "sending");
      const old = new Date(Date.now() - 10 * 60 * 1000);
      const attempt = await seedAttempt(msg, draft.id, "submitted", old);
      await seedSendingGuard(msg, attempt.id, "sending", attempt.id);

      const recovery = new EmailReplySendRecoveryService();
      const sweep = await recovery.recoverStaleAttempts(5 * 60 * 1000);
      expect(sweep.recovered).toBe(1);

      // The original transport is STILL RUNNING past the threshold.
      markSubmitterRunning(attempt.id);
      await expect(
        recovery.reconcileAttempt({
          attemptId: attempt.id,
          action: "confirm_not_sent",
          evidence: "operator guess without quiescence",
        })
      ).rejects.toThrow(/quiescence not proven/);
      // Refused: the row stays unknown, nothing reopened.
      expect((await attemptModule.read(attempt.id))?.status).toBe(
        "delivery_unknown"
      );

      // The process dies (restart semantics: empty registry = quiescence) —
      // the downgrade now proceeds.
      markSubmitterSettled(attempt.id);
      await recovery.reconcileAttempt({
        attemptId: attempt.id,
        action: "confirm_not_sent",
        evidence: "operator verified after submitter death",
      });
      expect((await attemptModule.read(attempt.id))?.status).toBe("failed");
    } finally {
      clearSubmitterTrackerForTests();
    }
  });
});
