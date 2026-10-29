import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { EmailReplyDraftRevisionEntity } from "@/entity/EmailReplyDraftRevision.entity";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { emailReplyDraftRevisionWriteSchema } from "@/schemas/entity/emailReplyDraftRevision";
import { rejectDatabaseAccessFromWorker } from "@/model/_workerBoundaryGuard";

export class EmailReplyDraftRevisionModel extends BaseDb {
  /** Resolved per access — BaseDb rebinds the live singleton before every
   * guarded async call; a construction-time repository could stay bound to a
   * replaced DataSource (test describe-scope module construction). */
  private get repository(): Repository<EmailReplyDraftRevisionEntity> {
    return this.sqliteDb.connection.getRepository(EmailReplyDraftRevisionEntity);
  }

  constructor(filepath: string) {
    super(filepath);
    rejectDatabaseAccessFromWorker("EmailReplyDraftRevisionModel");

  }

  /** Persist an immutable revision. `actor` must be "ai" | "user". */
  async create(
    entity: EmailReplyDraftRevisionEntity
  ): Promise<EmailReplyDraftRevisionEntity> {
    const stripped = parseAndStrip(
      entity,
      emailReplyDraftRevisionWriteSchema()
    ) as unknown as EmailReplyDraftRevisionEntity;
    const created = this.repository.create(stripped);
    return await this.repository.save(created);
  }

  async read(id: number): Promise<EmailReplyDraftRevisionEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  async readByDraftAndNumber(
    draftId: number,
    revisionNumber: number
  ): Promise<EmailReplyDraftRevisionEntity | null> {
    return await this.repository.findOne({
      where: { draftId, revisionNumber },
    });
  }

  /** Current (highest-numbered) revision for a draft. */
  async readCurrent(
    draftId: number
  ): Promise<EmailReplyDraftRevisionEntity | null> {
    return await this.repository.findOne({
      where: { draftId },
      order: { revisionNumber: "DESC" },
    });
  }

  async listByDraft(
    draftId: number
  ): Promise<EmailReplyDraftRevisionEntity[]> {
    return await this.repository.find({
      where: { draftId },
      order: { revisionNumber: "ASC" },
    });
  }
}
