import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { emailReplySendAttemptWriteSchema } from "@/schemas/entity/emailReplySendAttempt";
import { rejectDatabaseAccessFromWorker } from "@/model/_workerBoundaryGuard";
import type { EmailReplySendAttemptStatus } from "@/entityTypes/emailReplyReliabilityTypes";

export class EmailReplySendAttemptModel extends BaseDb {
  private repository: Repository<EmailReplySendAttemptEntity>;

  constructor(filepath: string) {
    super(filepath);
    rejectDatabaseAccessFromWorker("EmailReplySendAttemptModel");
    this.repository = this.sqliteDb.connection.getRepository(
      EmailReplySendAttemptEntity
    );
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

  async listByDraft(
    draftId: number
  ): Promise<EmailReplySendAttemptEntity[]> {
    return await this.repository.find({
      where: { draftId },
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
}
