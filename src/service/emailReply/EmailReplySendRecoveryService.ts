import { EmailReplySendAttemptModule } from "@/modules/EmailReplySendAttemptModule";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplyGuardModule } from "@/modules/EmailReplyGuardModule";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { canonicalReplyKey } from "@/service/emailReceive/EmailReplyIdentity";
import { REPLY_SEND_RECOVERY_THRESHOLD_MS } from "@/service/emailReply/replyReliabilityVersions";
import { incrementReplyMetric } from "@/service/emailReply/EmailReplyMetrics";
import { newRequestCorrelationId } from "@/service/emailReply/EmailReplyCorrelation";

/**
 * Recovers stale in-flight send attempts (technical design §15.6, §16, FR-019)
 * and stale generation reservations (T07/FR-035, §8.2).
 *
 * After possible SMTP acceptance, a process crash or post-SMTP write failure
 * can leave an attempt in `claimed`/`submitted`. This service marks such
 * attempts `delivery_unknown` after a configured timeout. It NEVER marks them
 * failed and NEVER re-submits SMTP (FR-019, NFR-001).
 *
 * T07: a process crash can also leave a generation-reservation guard row in
 * `generating`/`draft_ready` with an expired lease. The reservation sweep
 * reclaims each one AFTER reconciling against actual draft/attempt records
 * (the model's `reclaimExpiredReservation` never trusts `idle` while a related
 * sent/unknown/in-flight record exists).
 *
 * Runs in the main process only — never in a worker with database access.
 */
export class EmailReplySendRecoveryService {
  private readonly attemptModule = new EmailReplySendAttemptModule();
  private readonly draftModule = new EmailReplyDraftModule();
  private readonly guardModule = new EmailReplyGuardModule();
  private readonly messageModule = new EmailReceivedMessageModule();

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
        // T08: resolve the guard row for this attempt's replyKey so finalize
        // transitions the guard in the same transaction. The attempt entity has
        // no normalizedMessageId, so read the message row to derive it. A
        // missing guard row (legacy data) → null → finalize skips the guard
        // transition.
        const message = await this.messageModule.read(attempt.messageId);
        const guardId = message
          ? (
              await this.guardModule.findByReplyKey(
                attempt.emailServiceId,
                canonicalReplyKey({
                  normalizedMessageId: message.normalizedMessageId,
                  rowId: message.id,
                })
              )
            )?.id ?? null
          : null;
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
          guardId,
        });
        recovered += 1;
      } catch (error) {
        console.error(
          `Failed to recover stale send attempt ${attempt.id}:`,
          error
        );
      }
    }

    incrementReplyMetric("recovery_outcome", {
      outcome: recovered > 0 ? "recovered_unknown" : "none_stale",
    });
    // Each delivery_unknown is a high-visibility operational event (§15.5).
    return { recovered, needsAttention: recovered > 0 };
  }

  /**
   * T07/FR-035: sweep stale generation reservations (§8.2). A crash between
   * the reservation acquire and the commit (or between the commit and the
   * guard transition, before the atomic commit transaction) leaves a guard row
   * in `generating`/`draft_ready` with an expired lease that the in-memory
   * mutex cannot clean up — it died with the process. For each stale row,
   * `reclaimExpiredReservation` re-reads the canonical cluster and transitions
   * to `draft_ready` (committed draft survived) / `sent` / `delivery_unknown`
   * / `sending` (related evidence exists) / `idle` (clean cluster).
   *
   * @returns the number of reservations reclaimed.
   */
  async recoverStaleReservations(now: Date = new Date()): Promise<number> {
    const stale = await this.guardModule.listStaleReservations(now);
    if (stale.length === 0) {
      return 0;
    }

    let reclaimed = 0;
    for (const reservation of stale) {
      try {
        const didReclaim = await this.guardModule.reclaimExpiredReservation({
          guardId: reservation.id,
          now,
        });
        if (didReclaim) {
          reclaimed += 1;
          incrementReplyMetric("reservation_reclaimed", {
            phase: reservation.phase,
          });
        }
      } catch (error) {
        console.error(
          `Failed to reclaim stale generation reservation ${reservation.id}:`,
          error
        );
      }
    }

    incrementReplyMetric("reservation_recovered", {
      outcome: reclaimed > 0 ? "reclaimed" : "none_stale",
    });
    return reclaimed;
  }

  /**
   * Manual reconciliation of one ambiguous attempt (P0.6, FR-019, technical
   * design §16). The operator supplies the verified outcome and evidence:
   *   - confirm_sent:     mark sent (mailbox verified).
   *   - confirm_not_sent: mark failed + return the draft to 'draft' so a fresh
   *     revision/approval/send can follow.
   *   - leave_unresolved: audit only.
   */
  async reconcileAttempt(input: {
    attemptId: number;
    action: "confirm_sent" | "confirm_not_sent" | "leave_unresolved";
    evidence?: string | null;
    providerMessageId?: string | null;
  }): Promise<{ reconciled: boolean }> {
    const attempt = await this.attemptModule.read(input.attemptId);
    if (!attempt) {
      throw new Error(
        `Cannot reconcile: send attempt ${input.attemptId} not found`
      );
    }
    // T08: resolve the guard row for this attempt's replyKey so the guard
    // transitions alongside the reconciliation (confirm_sent → sent,
    // confirm_not_sent → draft_ready). The in-flight refusal for
    // confirm_not_sent lives in reconcileDelivery itself.
    const message = await this.messageModule.read(attempt.messageId);
    const guardId = message
      ? (
          await this.guardModule.findByReplyKey(
            attempt.emailServiceId,
            canonicalReplyKey({
              normalizedMessageId: message.normalizedMessageId,
              rowId: message.id,
            })
          )
        )?.id ?? null
      : null;
    // R20: mint a fresh per-invocation id at the reconcile entry boundary so
    // the reconciliation audit joins THIS operator request (distinct from the
    // original send invocation and from any other reconcile attempt).
    const requestCorrelationId = newRequestCorrelationId();
    await this.draftModule.reconcileDelivery({
      attemptId: attempt.id,
      draftId: attempt.draftId,
      messageId: attempt.messageId,
      emailServiceId: attempt.emailServiceId,
      action: input.action,
      evidence: input.evidence ?? null,
      providerMessageId: input.providerMessageId ?? null,
      guardId,
      requestCorrelationId,
    });
    return { reconciled: input.action !== "leave_unresolved" };
  }
}
