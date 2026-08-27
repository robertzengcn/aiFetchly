import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { EmailReplyKnowledgeScopeEntity } from "@/entity/EmailReplyKnowledgeScope.entity";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { emailReplyKnowledgeScopeWriteSchema } from "@/schemas/entity/emailReplyKnowledgeScope";
import { rejectDatabaseAccessFromWorker } from "@/model/_workerBoundaryGuard";

/**
 * Data access for mailbox-owned knowledge scopes (FR-008, §6.7). One row per
 * mailbox (unique emailServiceId).
 */
export class EmailReplyKnowledgeScopeModel extends BaseDb {
  private repository: Repository<EmailReplyKnowledgeScopeEntity>;

  constructor(filepath: string) {
    super(filepath);
    rejectDatabaseAccessFromWorker("EmailReplyKnowledgeScopeModel");
    this.repository = this.sqliteDb.connection.getRepository(
      EmailReplyKnowledgeScopeEntity
    );
  }

  async getByEmailServiceId(
    emailServiceId: number
  ): Promise<EmailReplyKnowledgeScopeEntity | null> {
    return await this.repository.findOne({ where: { emailServiceId } });
  }

  /** Upsert the scope for one mailbox; bumps version on every change (FR-008). */
  async upsert(input: {
    emailServiceId: number;
    documentIds: readonly number[];
    tags: readonly string[];
    allowAllDocuments: boolean;
    excludeInactiveDocuments: boolean;
  }): Promise<EmailReplyKnowledgeScopeEntity> {
    const existing = await this.getByEmailServiceId(input.emailServiceId);
    const entity = existing ?? new EmailReplyKnowledgeScopeEntity();
    entity.emailServiceId = input.emailServiceId;
    entity.documentIdsJson = JSON.stringify([...input.documentIds]);
    entity.tagsJson = JSON.stringify([...input.tags]);
    entity.allowAllDocuments = input.allowAllDocuments ? 1 : 0;
    entity.excludeInactiveDocuments = input.excludeInactiveDocuments ? 1 : 0;
    entity.version = (existing?.version ?? 0) + 1;
    const stripped = parseAndStrip(
      entity,
      emailReplyKnowledgeScopeWriteSchema()
    ) as unknown as EmailReplyKnowledgeScopeEntity;
    return await this.repository.save(this.repository.create(stripped));
  }
}
