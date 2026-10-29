import { BaseDb } from "@/model/Basedb";
import { IsNull, Repository, EntityManager } from "typeorm";
import { EmailReplyApprovalEntity } from "@/entity/EmailReplyApproval.entity";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { emailReplyApprovalWriteSchema } from "@/schemas/entity/emailReplyApproval";
import { rejectDatabaseAccessFromWorker } from "@/model/_workerBoundaryGuard";

export class EmailReplyApprovalModel extends BaseDb {
  /** Resolved per access — BaseDb rebinds the live singleton before every
   * guarded async call; a construction-time repository could stay bound to a
   * replaced DataSource (test describe-scope module construction). */
  private get repository(): Repository<EmailReplyApprovalEntity> {
    return this.sqliteDb.connection.getRepository(EmailReplyApprovalEntity);
  }

  constructor(filepath: string) {
    super(filepath);
    rejectDatabaseAccessFromWorker("EmailReplyApprovalModel");

  }

  async create(
    entity: EmailReplyApprovalEntity
  ): Promise<EmailReplyApprovalEntity> {
    const stripped = parseAndStrip(
      entity,
      emailReplyApprovalWriteSchema()
    ) as unknown as EmailReplyApprovalEntity;
    const created = this.repository.create(stripped);
    return await this.repository.save(created);
  }

  async read(id: number): Promise<EmailReplyApprovalEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  /**
   * Active approval for a one-time token hash. "Active" = not invalidated and
   * not past its TTL expiry. This is the lookup the delivery preflight uses to
   * turn the opaque approval token into a trusted approval record.
   */
  async findActiveByTokenHash(
    tokenHash: string
  ): Promise<EmailReplyApprovalEntity | null> {
    const approval = await this.findByTokenHash(tokenHash);
    if (!approval) return null;
    if (approval.invalidatedAt) return null;
    if (approval.expiresAt && approval.expiresAt.getTime() < Date.now()) {
      return null;
    }
    return approval;
  }

  /**
   * Approval record for a one-time token hash REGARDLESS of consumption state
   * (R14): `finalizeSendOutcome` consumes the approval for every terminal
   * outcome, so a replay of a finalized sent/delivery_unknown attempt must
   * still resolve the record to reach the B04 idempotency lookup. Callers must
   * gate NEW work on the returned record's `invalidatedAt`/`expiresAt` — this
   * resolver only proves the token existed, never that it is spendable.
   */
  async findByTokenHash(
    tokenHash: string
  ): Promise<EmailReplyApprovalEntity | null> {
    return await this.repository.findOne({
      where: { approvalTokenHash: tokenHash },
      order: { id: "DESC" },
    });
  }

  /** Most recent active approval bound to a draft's current revision. */
  async findActiveByDraft(
    draftId: number,
    revisionId: number
  ): Promise<EmailReplyApprovalEntity | null> {
    const approval = await this.repository.findOne({
      where: { draftId, revisionId },
      order: { id: "DESC" },
    });
    if (!approval) return null;
    if (approval.invalidatedAt) return null;
    if (approval.expiresAt && approval.expiresAt.getTime() < Date.now()) {
      return null;
    }
    return approval;
  }

  /** Mark a single approval consumed/invalidated. No-op if already invalidated. */
  async invalidate(
    id: number,
    reason: string,
    at: Date,
    manager?: EntityManager
  ): Promise<void> {
    const repo =
      manager?.getRepository(EmailReplyApprovalEntity) ?? this.repository;
    await repo.update(
      // IsNull() — a bare `null` in the criteria renders `invalidatedAt = NULL`
      // (never matches), silently turning invalidation into a no-op.
      { id, invalidatedAt: IsNull() },
      { invalidatedAt: at, invalidationReason: reason }
    );
  }

  /**
   * Invalidate every active approval for a draft (used when an edit creates a
   * new revision — FR-014). Optionally scoped to a transaction manager so the
   * edit + invalidation commit atomically.
   */
  async invalidateAllForDraft(
    draftId: number,
    reason: string,
    at: Date,
    manager?: EntityManager
  ): Promise<number> {
    const repo =
      manager?.getRepository(EmailReplyApprovalEntity) ?? this.repository;
    const result = await repo.update(
      // IsNull() — a bare `null` criterion never matches (renders `= NULL`).
      { draftId, invalidatedAt: IsNull() },
      { invalidatedAt: at, invalidationReason: reason }
    );
    return result.affected ?? 0;
  }
}
