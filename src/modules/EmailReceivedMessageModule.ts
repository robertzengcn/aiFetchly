import { BaseModule } from "@/modules/baseModule";
import {
  EmailReceivedMessageModel,
  ReceivedMessageListInput,
} from "@/model/EmailReceivedMessage.model";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import {
  EmailMessageClassification,
  EmailReplyStatus,
} from "@/entityTypes/emailReceiveTypes";

/**
 * Business-logic facade over {@link EmailReceivedMessageModel}.
 * IPC handlers and AI tools call this — never the model or repository directly.
 */
export class EmailReceivedMessageModule extends BaseModule {
  private messageModel: EmailReceivedMessageModel;

  constructor() {
    super();
    this.messageModel = new EmailReceivedMessageModel(this.dbpath);
  }

  async upsertByProviderUid(
    entity: EmailReceivedMessageEntity
  ): Promise<EmailReceivedMessageEntity> {
    try {
      await this.ensureConnection();
      return await this.messageModel.upsertByProviderUid(entity);
    } catch (error) {
      console.error("Error upserting received message:", error);
      throw error;
    }
  }

  async read(id: number): Promise<EmailReceivedMessageEntity | null> {
    try {
      await this.ensureConnection();
      return await this.messageModel.read(id);
    } catch (error) {
      console.error("Error reading received message:", error);
      throw error;
    }
  }

  async updateReplyStatus(
    id: number,
    status: EmailReplyStatus,
    processedAt: Date | null = null
  ): Promise<void> {
    try {
      await this.ensureConnection();
      await this.messageModel.updateReplyStatus(id, status, processedAt);
    } catch (error) {
      console.error("Error updating reply status:", error);
      throw error;
    }
  }

  async updateClassification(
    id: number,
    classification: EmailMessageClassification | null,
    confidence: number | null
  ): Promise<void> {
    try {
      await this.ensureConnection();
      await this.messageModel.updateClassification(id, classification, confidence);
    } catch (error) {
      console.error("Error updating classification:", error);
      throw error;
    }
  }

  async markRead(id: number, isUnread: boolean): Promise<void> {
    try {
      await this.ensureConnection();
      await this.messageModel.markRead(id, isUnread);
    } catch (error) {
      console.error("Error marking message read:", error);
      throw error;
    }
  }

  async listByEmailService(
    input: ReceivedMessageListInput
  ): Promise<{ records: EmailReceivedMessageEntity[]; total: number }> {
    try {
      await this.ensureConnection();
      const records = await this.messageModel.listByEmailService(input);
      const total = await this.messageModel.countByEmailService(input);
      return { records, total };
    } catch (error) {
      console.error("Error listing received messages:", error);
      throw error;
    }
  }
}
