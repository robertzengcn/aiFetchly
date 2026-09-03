import { Token } from "@/modules/token";
import { USERSDBPATH } from "@/config/usersetting";
import { OutboundEmailRecoveryService } from "@/service/outboundEmail/OutboundEmailRecoveryService";

/**
 * Best-effort startup + interval runner for the outbound-email recovery
 * subsystem (technical design §21). Runs in the main process only and NEVER
 * throws to the caller — a recovery failure must not block app startup.
 *
 * The interval is bounded (default 10 minutes) and the recovery service never
 * re-submits SMTP or creates new send attempts (FR-019).
 */
const DEFAULT_RECOVERY_INTERVAL_MS = 10 * 60 * 1000;

export class OutboundEmailReliabilityStartup {
  private intervalHandle: NodeJS.Timeout | null = null;

  /** Resolve the DB path from the Token service (production). */
  private resolveDbpath(): string {
    return new Token().getValue(USERSDBPATH) ?? "";
  }

  /**
   * Run one recovery sweep immediately, then start the bounded interval. Safe
   * to call once at app startup after the DB is initialized.
   */
  async start(
    recoveryIntervalMs: number = DEFAULT_RECOVERY_INTERVAL_MS
  ): Promise<{ authorizationsExpired: number; attemptsRecovered: number }> {
    const initialized = await this.runRecoverySweep();
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
    }
    this.intervalHandle = setInterval(() => {
      this.runRecoverySweep().catch((error) => {
        console.error("[outbound-reliability] interval recovery failed:", error);
      });
    }, recoveryIntervalMs);
    // Don't keep the process alive just for the sweep.
    this.intervalHandle.unref?.();
    return initialized;
  }

  /** Stop the interval sweep (e.g. on shutdown). */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /** One-shot recovery sweep. Never throws. */
  async runRecoverySweep(): Promise<{
    authorizationsExpired: number;
    attemptsRecovered: number;
  }> {
    const empty = { authorizationsExpired: 0, attemptsRecovered: 0 };
    try {
      const recovery = new OutboundEmailRecoveryService(this.resolveDbpath());
      const result = await recovery.recover();
      if (result.attemptsRecovered > 0 || result.authorizationsExpired > 0) {
        console.warn(
          `[outbound-reliability] recovery: expired=${result.authorizationsExpired} attempts=${result.attemptsRecovered}`
        );
      }
      return result;
    } catch (error) {
      console.error("[outbound-reliability] recovery sweep failed:", error);
      return empty;
    }
  }
}