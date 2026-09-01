import { BaseModule } from "@/modules/baseModule";
import { OutboundEmailIntentModel } from "@/model/OutboundEmailIntent.model";
import { OutboundEmailIntentEntity } from "@/entity/OutboundEmailIntent.entity";

/** Business-logic facade over {@link OutboundEmailIntentModel}. */
export class OutboundEmailIntentModule extends BaseModule {
  private intentModel: OutboundEmailIntentModel;

  constructor() {
    super();
    this.intentModel = new OutboundEmailIntentModel(this.dbpath);
  }

  async create(
    entity: OutboundEmailIntentEntity
  ): Promise<OutboundEmailIntentEntity> {
    try {
      await this.ensureConnection();
      return await this.intentModel.create(entity);
    } catch (error) {
      console.error("Error creating outbound email intent:", error);
      throw error;
    }
  }

  async read(id: number): Promise<OutboundEmailIntentEntity | null> {
    try {
      await this.ensureConnection();
      return await this.intentModel.read(id);
    } catch (error) {
      console.error("Error reading outbound email intent:", error);
      throw error;
    }
  }

  /** Load the persisted decision for a user message (idempotent across retries). */
  async findBySource(
    conversationId: string,
    sourceUserMessageId: string
  ): Promise<OutboundEmailIntentEntity | null> {
    try {
      await this.ensureConnection();
      return await this.intentModel.findBySource(
        conversationId,
        sourceUserMessageId
      );
    } catch (error) {
      console.error("Error finding outbound email intent by source:", error);
      throw error;
    }
  }
}
