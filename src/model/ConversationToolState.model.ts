import { BaseDb } from "@/model/Basedb";
import { ConversationToolStateEntity } from "@/entity/ConversationToolState.entity";
import { Repository } from "typeorm";

/**
 * Data access for persisted per-conversation deferred-tool-catalog state
 * (design §19.2). Extends BaseDb and uses the standard database path
 * resolution. Never accessed from worker processes.
 */
export class ConversationToolStateModel extends BaseDb {
  public repository: Repository<ConversationToolStateEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      ConversationToolStateEntity
    );
  }

  async findByConversationId(
    conversationId: string
  ): Promise<ConversationToolStateEntity | null> {
    return await this.repository.findOne({ where: { conversationId } });
  }

  async upsert(input: {
    readonly conversationId: string;
    readonly discoveredToolNamesJson: string;
    readonly announcedDeferredToolNamesJson: string;
    readonly catalogHash?: string;
  }): Promise<ConversationToolStateEntity> {
    const existing = await this.repository.findOne({
      where: { conversationId: input.conversationId },
    });
    if (existing) {
      existing.discoveredToolNamesJson = input.discoveredToolNamesJson;
      existing.announcedDeferredToolNamesJson =
        input.announcedDeferredToolNamesJson;
      existing.catalogHash = input.catalogHash;
      return await this.repository.save(existing);
    }
    const entity = new ConversationToolStateEntity();
    entity.conversationId = input.conversationId;
    entity.discoveredToolNamesJson = input.discoveredToolNamesJson;
    entity.announcedDeferredToolNamesJson = input.announcedDeferredToolNamesJson;
    entity.catalogHash = input.catalogHash;
    return await this.repository.save(entity);
  }

  async deleteByConversationId(conversationId: string): Promise<number> {
    const result = await this.repository.delete({ conversationId });
    return result.affected ?? 0;
  }
}
