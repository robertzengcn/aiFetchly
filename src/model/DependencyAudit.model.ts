import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { DependencyInstallAuditEntity } from "@/entity/DependencyInstallAudit";

/**
 * Data access layer for the dependency install audit log.
 *
 * Provides append-only write and filtered read operations.
 * Extends BaseDb for database connection management.
 */
export class DependencyAuditModel extends BaseDb {
  private repository: Repository<DependencyInstallAuditEntity> | null = null;

  constructor(filepath: string) {
    super(filepath);
  }

  private async getRepository(): Promise<Repository<DependencyInstallAuditEntity>> {
    if (!this.repository) {
      await this.ensureConnection();
      this.repository =
        this.sqliteDb.connection.getRepository(DependencyInstallAuditEntity);
    }
    return this.repository;
  }

  /**
   * Append a new audit entry. This is the only write operation —
   * audit records are never updated or deleted.
   */
  async createEntry(
    data: Partial<DependencyInstallAuditEntity>
  ): Promise<number> {
    const repo = await this.getRepository();
    const entity = repo.create(data);
    const saved = await repo.save(entity);
    return saved.id;
  }

  /** Query audit entries by conversation ID, newest first. */
  async getByConversationId(
    conversationId: string
  ): Promise<DependencyInstallAuditEntity[]> {
    const repo = await this.getRepository();
    return repo.find({
      where: { conversation_id: conversationId },
      order: { createdAt: "DESC" },
    });
  }

  /** Query audit entries by dependency ID, newest first. */
  async getByDependencyId(
    dependencyId: string
  ): Promise<DependencyInstallAuditEntity[]> {
    const repo = await this.getRepository();
    return repo.find({
      where: { dependency_id: dependencyId },
      order: { createdAt: "DESC" },
    });
  }

  /** Paginated query with optional filters. */
  async getPaginated(params: {
    conversation_id?: string;
    dependency_id?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ entries: DependencyInstallAuditEntity[]; total: number }> {
    const repo = await this.getRepository();
    const where: Record<string, string> = {};
    if (params.conversation_id) {
      where.conversation_id = params.conversation_id;
    }
    if (params.dependency_id) {
      where.dependency_id = params.dependency_id;
    }

    const [entries, total] = await repo.findAndCount({
      where: Object.keys(where).length > 0 ? where : undefined,
      order: { createdAt: "DESC" },
      take: params.limit ?? 50,
      skip: params.offset ?? 0,
    });

    return { entries, total };
  }
}
