import { describe, it, expect } from "vitest";

import { EmailReplySendRecoveryService } from "@/service/emailReply/EmailReplySendRecoveryService";
import { EmailReplySendAttemptModule } from "@/modules/EmailReplySendAttemptModule";
import { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";

/**
 * P0.6/G6: the bounded recovery sweep marks stale in-flight attempts
 * (`claimed`/`submitted` older than the threshold) as `delivery_unknown` —
 * NEVER failed — and leaves fresh in-flight + finalized attempts untouched.
 * It never re-submits SMTP.
 */
describe("EmailReplySendRecoveryService sweep", () => {
  // The recovery service reads through Token-fallback Modules; seed through
  // the same fallback DB so both sides see one connection.
  const attemptModule = new EmailReplySendAttemptModule();

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

    const result = await new EmailReplySendRecoveryService().recoverStaleAttempts(
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
    const result = await new EmailReplySendRecoveryService().recoverStaleAttempts(
      60 * 60 * 1000
    );
    expect(result.recovered).toBe(0);
    expect(result.needsAttention).toBe(false);
  });
});
