import { BaseModule } from "@/modules/baseModule";
import { EmailAutoReplyRuleModel } from "@/model/EmailAutoReplyRule.model";
import { EmailAutoReplyRuleEntity } from "@/entity/EmailAutoReplyRule.entity";

/** Business-logic facade over {@link EmailAutoReplyRuleModel}. */
export class EmailAutoReplyRuleModule extends BaseModule {
  private ruleModel: EmailAutoReplyRuleModel;

  constructor() {
    super();
    this.ruleModel = new EmailAutoReplyRuleModel(this.dbpath);
  }

  async read(id: number): Promise<EmailAutoReplyRuleEntity | null> {
    try {
      await this.ensureConnection();
      return await this.ruleModel.read(id);
    } catch (error) {
      console.error("Error reading auto-reply rule:", error);
      throw error;
    }
  }

  async listByEmailService(
    emailServiceId: number
  ): Promise<EmailAutoReplyRuleEntity[]> {
    try {
      await this.ensureConnection();
      return await this.ruleModel.listByEmailService(emailServiceId);
    } catch (error) {
      console.error("Error listing auto-reply rules:", error);
      throw error;
    }
  }

  async getEffectiveRule(
    emailServiceId: number
  ): Promise<EmailAutoReplyRuleEntity | null> {
    try {
      await this.ensureConnection();
      return await this.ruleModel.getEffectiveRule(emailServiceId);
    } catch (error) {
      console.error("Error resolving effective auto-reply rule:", error);
      throw error;
    }
  }

  async create(entity: EmailAutoReplyRuleEntity): Promise<EmailAutoReplyRuleEntity> {
    try {
      await this.ensureConnection();
      return await this.ruleModel.create(entity);
    } catch (error) {
      console.error("Error creating auto-reply rule:", error);
      throw error;
    }
  }

  async update(id: number, entity: EmailAutoReplyRuleEntity): Promise<void> {
    try {
      await this.ensureConnection();
      await this.ruleModel.update(id, entity);
    } catch (error) {
      console.error("Error updating auto-reply rule:", error);
      throw error;
    }
  }
}
