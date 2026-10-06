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
