import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { OutboundEmailIntentEntity } from "@/entity/OutboundEmailIntent.entity";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { outboundEmailIntentWriteSchema } from "@/schemas/entity/outboundEmailIntent";
import { rejectDatabaseAccessFromWorker } from "@/model/_workerBoundaryGuard";

export class OutboundEmailIntentModel extends BaseDb {
  private repository: Repository<OutboundEmailIntentEntity>;

  constructor(filepath: string) {
    super(filepath);
    rejectDatabaseAccessFromWorker("OutboundEmailIntentModel");
    this.repository = this.sqliteDb.connection.getRepository(
      OutboundEmailIntentEntity
    );
  }

  async create(
    entity: OutboundEmailIntentEntity
  ): Promise<OutboundEmailIntentEntity> {
    const stripped = parseAndStrip(
      entity,
      outboundEmailIntentWriteSchema()
    ) as unknown as OutboundEmailIntentEntity;
    const created = this.repository.create(stripped);
    return await this.repository.save(created);
  }

  async read(id: number): Promise<OutboundEmailIntentEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  /**
   * Load the persisted decision for a user message. The unique index on
   * (conversationId, sourceUserMessageId) guarantees at most one row, so a
   * stream retry / restart reuses the existing decision instead of re-deciding.
   */
  async findBySource(
    conversationId: string,
    sourceUserMessageId: string
  ): Promise<OutboundEmailIntentEntity | null> {
    return await this.repository.findOne({
      where: { conversationId, sourceUserMessageId },
    });
  }
}
