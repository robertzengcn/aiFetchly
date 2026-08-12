import { EmailReplySendAttemptModule } from "@/modules/EmailReplySendAttemptModule";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { REPLY_SEND_RECOVERY_THRESHOLD_MS } from "@/service/emailReply/replyReliabilityVersions";

/**
 * Recovers stale in-flight send attempts (technical design §15.6, §16, FR-019).
 *
 * After possible SMTP acceptance, a process crash or post-SMTP write failure
 * can leave an attempt in `claimed`/`submitted`. This service marks such
 * attempts `delivery_unknown` after a configured timeout. It NEVER marks them
 * failed and NEVER re-submits SMTP (FR-019, NFR-001).
 *
 * Runs in the main process only — never in a worker with database access.
 */
export class EmailReplySendRecoveryService {
  private readonly attemptModule = new EmailReplySendAttemptModule();
  private readonly draftModule = new EmailReplyDraftModule();

  /**
   * Sweep stale in-flight attempts older than {@link ageMs} (default
   * {@link REPLY_SEND_RECOVERY_THRESHOLD_MS}) and finalize each as
   * `delivery_unknown`.
   *
   * @returns the number of attempts recovered and a high-visibility signal flag.
   */
  async recoverStaleAttempts(
    ageMs: number = REPLY_SEND_RECOVERY_THRESHOLD_MS
  ): Promise<{ recovered: number; needsAttention: boolean }> {
    const threshold = new Date(Date.now() - ageMs);
    const stale = await this.attemptModule.listStaleInFlight(threshold);
    if (stale.length === 0) {
      return { recovered: 0, needsAttention: false };
    }

    let recovered = 0;
    for (const attempt of stale) {
      try {
        await this.draftModule.finalizeSendOutcome({
          attemptId: attempt.id,
          draftId: attempt.draftId,
          approvalId: attempt.approvalId,
          emailServiceId: attempt.emailServiceId,
          messageId: attempt.messageId,
          outcome: "delivery_unknown",
          failureCode: "recovery_timeout",
          sanitizedError:
            "Recovered as delivery-unknown: in-flight attempt exceeded the recovery threshold",
        });
        recovered += 1;
      } catch (error) {
        console.error(
          `Failed to recover stale send attempt ${attempt.id}:`,
          error
        );
      }
    }

    // Each delivery_unknown is a high-visibility operational event (§15.5).
    return { recovered, needsAttention: recovered > 0 };
  }
}
