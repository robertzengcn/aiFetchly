import { BaseModule } from "@/modules/baseModule";
import { EmailReplyKnowledgeScopeModel } from "@/model/EmailReplyKnowledgeScope.model";
import { EmailReplyKnowledgeScopeEntity } from "@/entity/EmailReplyKnowledgeScope.entity";

/** Business-logic facade over {@link EmailReplyKnowledgeScopeModel}. */
export class EmailReplyKnowledgeScopeModule extends BaseModule {
  private scopeModel: EmailReplyKnowledgeScopeModel;

  constructor() {
    super();
    this.scopeModel = new EmailReplyKnowledgeScopeModel(this.dbpath);
  }

  async getByEmailServiceId(
    emailServiceId: number
  ): Promise<EmailReplyKnowledgeScopeEntity | null> {
    try {
      await this.ensureConnection();
      return await this.scopeModel.getByEmailServiceId(emailServiceId);
    } catch (error) {
      console.error("Error reading knowledge scope:", error);
      throw error;
    }
  }

  async upsert(input: {
    emailServiceId: number;
    documentIds: readonly number[];
    tags: readonly string[];
    allowAllDocuments: boolean;
    excludeInactiveDocuments: boolean;
  }): Promise<EmailReplyKnowledgeScopeEntity> {
    try {
      await this.ensureConnection();
      return await this.scopeModel.upsert(input);
    } catch (error) {
      console.error("Error upserting knowledge scope:", error);
      throw error;
    }
  }
}
