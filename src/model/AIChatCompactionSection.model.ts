import { BaseDb } from "@/model/Basedb";
import { AIChatCompactionSectionEntity } from "@/entity/AIChatCompactionSection.entity";
import type { Repository } from "typeorm";

/**
 * Data access for compaction sections (technical-design §9 / §11.4). A
 * section covers exactly one contiguous source range and stores the validated
 * SectionSummaryV1 JSON. Sections start `staged`, become `published` when a
 * generation is published, or `invalidated` when the epoch/revision moves.
 */
export class AIChatCompactionSectionModel extends BaseDb {
  public repository: Repository<AIChatCompactionSectionEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      AIChatCompactionSectionEntity
    );
  }

  protected onSqliteDbRebound(): void {
    this.repository = this.sqliteDb.connection.getRepository(
      AIChatCompactionSectionEntity
    );
  }

  /** List sections for a conversation in ordinal order (staged + published). */
  async listSections(
    conversationId: string,
    epoch: string
  ): Promise<AIChatCompactionSectionEntity[]> {
    return this.repository.find({
      where: { conversationId, epoch },
      order: { ordinal: "ASC" },
    });
  }

  /** Count sections staged but not yet published. */
  async countStaged(conversationId: string, epoch: string): Promise<number> {
    return this.repository.count({
      where: { conversationId, epoch, status: "staged" },
    });
  }

  /** Get the highest published ordinal (0 when none published). */
  async highestPublishedOrdinal(
    conversationId: string,
    epoch: string
  ): Promise<number> {
    const rows = await this.repository.find({
      where: { conversationId, epoch, status: "published" },
      order: { ordinal: "DESC" },
      take: 1,
    });
    return rows.length > 0 ? rows[0].ordinal : 0;
  }

  /** Invalidate all sections for a conversation (epoch moved under them). */
  async invalidateConversation(conversationId: string): Promise<void> {
    await this.repository.update(
      { conversationId },
      { status: "invalidated" }
    );
  }
}
