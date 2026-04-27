import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { ShellAuditEntity } from "@/entity/ShellAudit.entity";

/**
 * Data access layer for the shell execution audit log.
 *
 * Provides append-only write and filtered read operations.
 * Extends BaseDb for database connection management.
 */
export class ShellAuditModel extends BaseDb {
  private repository: Repository<ShellAuditEntity> | null = null;

  constructor(filepath: string) {
    super(filepath);
  }

  private async getRepository(): Promise<Repository<ShellAuditEntity>> {
    if (!this.repository) {
      await this.ensureConnection();
      this.repository =
        this.sqliteDb.connection.getRepository(ShellAuditEntity);
    }
    return this.repository;
  }

  /**
   * Append a new audit entry. This is the only write operation —
   * audit records are never updated or deleted.
   */
  async createEntry(
    data: Partial<ShellAuditEntity>
  ): Promise<number> {
    const repo = await this.getRepository();
    const entity = repo.create(data);
    const saved = await repo.save(entity);
    return saved.id;
  }

  /** Query audit entries by conversation ID, newest first. */
  async getByConversationId(
    conversationId: string
  ): Promise<ShellAuditEntity[]> {
    const repo = await this.getRepository();
    return repo.find({
      where: { conversation_id: conversationId },
      order: { createdAt: "DESC" },
    });
  }
}
