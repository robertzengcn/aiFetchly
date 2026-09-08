import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { SqliteDb } from "@/config/SqliteDb";
import { EmailReplySendRecoveryService } from "@/service/emailReply/EmailReplySendRecoveryService";
import { EmailReplySendAttemptModule } from "@/modules/EmailReplySendAttemptModule";
import { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";

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
  Token: vi.fn().mockImplementation(() => ({
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
  })),
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
