import { BaseModule } from "@/modules/baseModule";
import { EmailConversationModel } from "@/model/EmailConversation.model";
import { EmailConversationEntity } from "@/entity/EmailConversation.entity";
import type { EmailConversationContextConfidence } from "@/entityTypes/emailReplyReliabilityTypes";

/** Business-logic facade over {@link EmailConversationModel}. */
export class EmailConversationModule extends BaseModule {
  private conversationModel: EmailConversationModel;

  constructor() {
    super();
    this.conversationModel = new EmailConversationModel(this.dbpath);
  }

  async read(id: number): Promise<EmailConversationEntity | null> {
    try {
      await this.ensureConnection();
      return await this.conversationModel.read(id);
    } catch (error) {
      console.error("Error reading conversation:", error);
      throw error;
    }
  }

  async resolveOrCreate(input: {
    emailServiceId: number;
    rootKey: string;
    matchCandidates: readonly string[];
    confidence: EmailConversationContextConfidence;
    ambiguityReason: string | null;
    displaySubject: string | null;
    lastMessageAt: Date;
  }): Promise<EmailConversationEntity> {
    try {
      await this.ensureConnection();
      return await this.conversationModel.resolveOrCreate(input);
    } catch (error) {
      console.error("Error resolving conversation:", error);
      throw error;
    }
  }

  async mergeExactConversations(
    targetId: number,
    sourceId: number
  ): Promise<void> {
    try {
      await this.ensureConnection();
      await this.conversationModel.mergeExactConversations(targetId, sourceId);
    } catch (error) {
      console.error("Error merging conversations:", error);
      throw error;
    }
  }

  async listByEmailService(
    emailServiceId: number,
    limit = 50
  ): Promise<EmailConversationEntity[]> {
    try {
      await this.ensureConnection();
      return await this.conversationModel.listByEmailService(emailServiceId, limit);
    } catch (error) {
      console.error("Error listing conversations:", error);
      throw error;
    }
  }
}
