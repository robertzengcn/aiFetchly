import { BaseDb } from "@/model/Basedb";
import { Repository, In } from "typeorm";
import { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { emailReplySendAttemptWriteSchema } from "@/schemas/entity/emailReplySendAttempt";
import { rejectDatabaseAccessFromWorker } from "@/model/_workerBoundaryGuard";
import type { EmailReplySendAttemptStatus } from "@/entityTypes/emailReplyReliabilityTypes";

export class EmailReplySendAttemptModel extends BaseDb {
  /** Resolved per access — BaseDb rebinds the live singleton before every
   * guarded async call; a construction-time repository could stay bound to a
   * replaced DataSource (test describe-scope module construction). */
  private get repository(): Repository<EmailReplySendAttemptEntity> {
    return this.sqliteDb.connection.getRepository(EmailReplySendAttemptEntity);
  }

  constructor(filepath: string) {
    super(filepath);
    rejectDatabaseAccessFromWorker("EmailReplySendAttemptModel");

  }

  async create(
    entity: EmailReplySendAttemptEntity
  ): Promise<EmailReplySendAttemptEntity> {
    const stripped = parseAndStrip(
      entity,
      emailReplySendAttemptWriteSchema()
    ) as unknown as EmailReplySendAttemptEntity;
    const created = this.repository.create(stripped);
    return await this.repository.save(created);
  }

  async read(id: number): Promise<EmailReplySendAttemptEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  async findByIdempotencyKey(
    key: string
  ): Promise<EmailReplySendAttemptEntity | null> {
    return await this.repository.findOne({ where: { idempotencyKey: key } });
  }

  async listByDraft(draftId: number): Promise<EmailReplySendAttemptEntity[]> {
    return await this.repository.find({
      where: { draftId },
      order: { id: "DESC" },
    });
  }

  /**
   * All send attempts for an inbound message id (FR-029/B02). The message-level
   * guard inspects this to find authoritative delivery evidence — sent,
   * unresolved (`delivery_unknown`), or in-flight (`claimed`/`submitted`) —
   * even when the linked draft row is missing/stale and the message
   * `replyStatus` projection still looks unanswered. Ordered newest-first so
   * the guard's precedence scan sees the most recent attempt first.
   */
  async listByMessage(
    messageId: number
  ): Promise<EmailReplySendAttemptEntity[]> {
    return await this.repository.find({
      where: { messageId },
      order: { id: "DESC" },
    });
  }

  /** Batched {@link listByMessage} for a cluster of message ids (one query). */
  async listByMessageIds(
    messageIds: number[]
  ): Promise<EmailReplySendAttemptEntity[]> {
    if (messageIds.length === 0) return [];
    return await this.repository.find({
      where: { messageId: In(messageIds) },
      order: { id: "DESC" },
    });
  }

  /**
   * In-flight attempts older than the threshold — candidates for recovery
   * (§15.6, §16). Returns `claimed`/`submitted` rows that may represent an
   * ambiguous delivery after a crash or post-SMTP write failure.
   */
  async listStaleInFlight(
    threshold: Date
  ): Promise<EmailReplySendAttemptEntity[]> {
    const qb = this.repository
      .createQueryBuilder("attempt")
      .where("attempt.status IN (:...statuses)", {
        statuses: ["claimed", "submitted"] as EmailReplySendAttemptStatus[],
      })
      .andWhere("attempt.claimedAt < :threshold", { threshold })
      .orderBy("attempt.claimedAt", "ASC");
    return await qb.getMany();
  }

  /**
   * Mark an in-flight attempt `submitted` at the SMTP handoff boundary (P0.6).
   * Conditional on status IN (claimed, submitted) so it's idempotent and can't
   * revive a finalized attempt.
   */
  async markSubmitted(id: number, at: Date): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update()
      .set({ status: "submitted", submittedAt: at })
      .where("id = :id AND status IN (:...statuses)", {
        id,
        statuses: ["claimed", "submitted"] as EmailReplySendAttemptStatus[],
      })
      .execute();
  }

  /** Lightweight status update used by the recovery service. */
  async markOutcome(
    id: number,
    status: EmailReplySendAttemptStatus,
    fields: {
      completedAt?: Date;
      providerMessageId?: string | null;
      failureCode?: string | null;
      sanitizedError?: string | null;
    }
  ): Promise<void> {
    await this.repository.update({ id }, { status, ...fields });
  }

  /** Count successful sends for a mailbox since {@link since} (daily-limit input). */
  async countSentByServiceSince(
    emailServiceId: number,
    since: Date
  ): Promise<number> {
    return await this.repository
      .createQueryBuilder("attempt")
      .where("attempt.emailServiceId = :emailServiceId", { emailServiceId })
      .andWhere("attempt.status = :status", { status: "sent" })
      .andWhere("attempt.claimedAt >= :since", { since })
      .getCount();
  }

  /**
   * Count SENT attempts for a source message (per-thread-limit proxy, R13).
   *
   * A failed attempt delivered no email (definite SMTP rejection), so an
   * explicit re-approval + retry of the same draft must not consume the
   * per-thread limit. Mirrors the sent-only daily-limit proxy
   * {@link countSentByServiceSince}. `delivery_unknown` (ambiguous — might
   * have delivered) and `claimed`/`submitted` (in-flight) are excluded: an
   * ambiguous prior send blocks retry through the cluster fence, not here;
   * an in-flight attempt blocks through the send-claim sibling check.
   */
  async countAttemptsForMessage(messageId: number): Promise<number> {
    return await this.repository
      .createQueryBuilder("attempt")
      .where("attempt.messageId = :messageId", { messageId })
      .andWhere("attempt.status = :status", { status: "sent" })
      .getCount();
  }
}
