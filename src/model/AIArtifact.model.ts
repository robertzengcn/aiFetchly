import { BaseDb } from "@/model/Basedb";
import { AIArtifactEntity } from "@/entity/AIArtifact.entity";
import { Repository } from "typeorm";

/**
 * Data-access layer for AI artifacts.
 *
 * Follows the repo's three-layer architecture: raw TypeORM access lives
 * here; business rules live in {@link AIArtifactModule}; IPC handlers
 * call the module and never touch repositories directly.
 */
export class AIArtifactModel extends BaseDb {
  public repository: Repository<AIArtifactEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(AIArtifactEntity);
  }

  /** Insert or update an artifact row. */
  async saveArtifact(entity: AIArtifactEntity): Promise<AIArtifactEntity> {
    return this.repository.save(entity);
  }

  /** Fetch a single artifact by its stable public id. */
  async getByArtifactId(artifactId: string): Promise<AIArtifactEntity | null> {
    return this.repository.findOne({ where: { artifactId } });
  }

  /** List every artifact version in a conversation, newest first. */
  async listByConversation(conversationId: string): Promise<AIArtifactEntity[]> {
    return this.repository.find({
      where: { conversationId },
      order: { id: "DESC" },
    });
  }

  /**
   * Highest existing version number for the given conversation and title
   * (matched case-insensitively). Returns 0 when none exists so the caller
   * can increment to version 1 for a new artifact.
   */
  async getLatestVersion(conversationId: string, title: string): Promise<number> {
    const normalized = title.trim().toLowerCase();
    const row = await this.repository
      .createQueryBuilder("a")
      .select("MAX(a.version)", "maxVersion")
      .where("a.conversationId = :conversationId", { conversationId })
      .andWhere("LOWER(a.title) = :title", { title: normalized })
      .getRawOne<{ maxVersion: number | null }>();
    return row?.maxVersion ?? 0;
  }

  /** Delete all artifacts belonging to a conversation. Returns rows removed. */
  async deleteByConversation(conversationId: string): Promise<number> {
    const result = await this.repository.delete({ conversationId });
    return result.affected || 0;
  }

  /** Clear the table (test helper). */
  async deleteAll(): Promise<void> {
    await this.repository.clear();
  }
}
