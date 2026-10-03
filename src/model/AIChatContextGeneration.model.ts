import { BaseDb } from "@/model/Basedb";
import { AIChatContextGenerationEntity } from "@/entity/AIChatContextGeneration.entity";
import type { Repository } from "typeorm";
import { AI_CHAT_RECOVERABLE_DEFAULTS } from "@/service/AIChatRecoverableDefaults";

/**
 * Data access for published context generations (technical-design §11.5).
 * Only one generation per conversation is `active` at a time (CAS publication
 * lives in the run model, which updates archive state's
 * activeGenerationId). Old generations are retained up to the configured
 * history limit then pruned.
 */
export class AIChatContextGenerationModel extends BaseDb {
  public repository: Repository<AIChatContextGenerationEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      AIChatContextGenerationEntity
    );
  }

  protected onSqliteDbRebound(): void {
    this.repository = this.sqliteDb.connection.getRepository(
      AIChatContextGenerationEntity
    );
  }

  /** Get the active generation for a conversation (null when none published). */
  async getActiveGeneration(
    conversationId: string,
    epoch: string
  ): Promise<AIChatContextGenerationEntity | null> {
    const rows = await this.repository.find({
      where: { conversationId, epoch, status: "active" },
      take: 1,
    });
    return rows.length > 0 ? rows[0] : null;
  }

  /** List generations for a conversation newest-first (for retention prune). */
  async listGenerations(
    conversationId: string,
    epoch: string
  ): Promise<AIChatContextGenerationEntity[]> {
    return this.repository.find({
      where: { conversationId, epoch },
      order: { id: "DESC" },
    });
  }

  /**
   * Prune old generations beyond the configured retention limit (§8 / §11.5).
   * Never prunes the active generation. Returns the count pruned.
   */
  async pruneOldGenerations(
    conversationId: string,
    epoch: string
  ): Promise<number> {
    const all = await this.listGenerations(conversationId, epoch);
    const limit = AI_CHAT_RECOVERABLE_DEFAULTS.retainedGenerationHistoryCount;
    if (all.length <= limit) return 0;
    const active = all.find((g) => g.status === "active");
    const toPrune = all
      .filter((g) => g.id !== active?.id && g.status !== "active")
      .slice(limit);
    for (const g of toPrune) {
      g.status = "invalidated";
      await this.repository.save(g);
    }
    return toPrune.length;
  }

  /** Invalidate all generations for a conversation (epoch moved). */
  async invalidateConversation(conversationId: string): Promise<void> {
    await this.repository.update(
      { conversationId },
      { status: "invalidated" }
    );
  }
}
