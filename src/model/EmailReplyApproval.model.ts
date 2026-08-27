import { BaseDb } from "@/model/Basedb";
import { Repository, EntityManager } from "typeorm";
import { EmailReplyApprovalEntity } from "@/entity/EmailReplyApproval.entity";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { emailReplyApprovalWriteSchema } from "@/schemas/entity/emailReplyApproval";
import { rejectDatabaseAccessFromWorker } from "@/model/_workerBoundaryGuard";

export class EmailReplyApprovalModel extends BaseDb {
  private repository: Repository<EmailReplyApprovalEntity>;

  constructor(filepath: string) {
    super(filepath);
    rejectDatabaseAccessFromWorker("EmailReplyApprovalModel");
    this.repository = this.sqliteDb.connection.getRepository(
      EmailReplyApprovalEntity
    );
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
    const approval = await this.repository.findOne({
      where: { approvalTokenHash: tokenHash },
      order: { id: "DESC" },
    });
    if (!approval) return null;
    if (approval.invalidatedAt) return null;
    if (approval.expiresAt && approval.expiresAt.getTime() < Date.now()) {
      return null;
    }
    return approval;
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
      { id, invalidatedAt: null as unknown as Date },
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
      { draftId, invalidatedAt: null as unknown as Date },
      { invalidatedAt: at, invalidationReason: reason }
    );
    return result.affected ?? 0;
  }
}
