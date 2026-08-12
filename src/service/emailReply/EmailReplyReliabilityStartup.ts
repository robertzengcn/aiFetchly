import { EmailReplyDraftBackfillService } from "@/service/emailReply/EmailReplyDraftBackfillService";
import { EmailReplySendRecoveryService } from "@/service/emailReply/EmailReplySendRecoveryService";

/**
 * Best-effort startup + interval runner for the reply-reliability subsystem
 * (technical design §16, §22.1; P0.5/P0.6).
 *
 * Backfill lifts legacy drafts onto immutable revisions; recovery sweeps stale
 * in-flight send attempts to `delivery_unknown`. Both run in the main process,
 * never in a worker, and NEVER throw to the caller — a migration/recovery
 * failure must not block app startup.
 *
 * The interval is bounded (default 10 minutes) and the recovery service itself
 * never re-submits SMTP.
 */
const DEFAULT_RECOVERY_INTERVAL_MS = 10 * 60 * 1000;

export class EmailReplyReliabilityStartup {
  private intervalHandle: NodeJS.Timeout | null = null;

  /**
   * Run backfill + one recovery sweep immediately, then start the bounded
   * interval. Safe to call once at app startup after the DB is initialized.
   */
  async start(
    recoveryIntervalMs: number = DEFAULT_RECOVERY_INTERVAL_MS
  ): Promise<{ backfill: { processed: number; skipped: number; failed: number }; recovered: number }> {
    const backfill = await this.runBackfill();
    const recovered = await this.runRecoverySweep();
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
    }
    this.intervalHandle = setInterval(() => {
      this.runRecoverySweep().catch((error) => {
        console.error("Reply reliability interval recovery failed:", error);
      });
    }, recoveryIntervalMs);
    // Don't keep the process alive just for the sweep.
    this.intervalHandle.unref?.();
    return { backfill, recovered };
  }

  /** Stop the interval sweep (e.g. on shutdown). */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /** One-shot backfill. Never throws. */
  async runBackfill(): Promise<{ processed: number; skipped: number; failed: number }> {
    try {
      const result = await new EmailReplyDraftBackfillService().backfillLegacyDrafts();
      if (result.processed > 0 || result.failed > 0) {
        console.log(
          `[reply-reliability] backfill: processed=${result.processed} skipped=${result.skipped} failed=${result.failed}`
        );
      }
      return result;
    } catch (error) {
      console.error("[reply-reliability] backfill failed:", error);
      return { processed: 0, skipped: 0, failed: 0 };
    }
  }

  /** One-shot stale-attempt recovery. Never throws. */
  async runRecoverySweep(): Promise<number> {
    try {
      const result = await new EmailReplySendRecoveryService().recoverStaleAttempts();
      if (result.needsAttention) {
        // High-visibility operational signal (FR-019, §15.5).
        console.warn(
          `[reply-reliability] recovered ${result.recovered} stale in-flight send attempt(s) to delivery_unknown — manual mailbox verification required`
        );
      }
      return result.recovered;
    } catch (error) {
      console.error("[reply-reliability] recovery sweep failed:", error);
      return 0;
    }
  }
}
