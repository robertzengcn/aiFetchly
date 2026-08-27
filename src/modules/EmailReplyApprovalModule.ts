import { BaseModule } from "@/modules/baseModule";
import { EmailReplyApprovalModel } from "@/model/EmailReplyApproval.model";
import { EmailReplyApprovalEntity } from "@/entity/EmailReplyApproval.entity";

/** Business-logic facade over {@link EmailReplyApprovalModel}. */
export class EmailReplyApprovalModule extends BaseModule {
  private approvalModel: EmailReplyApprovalModel;

  constructor() {
    super();
    this.approvalModel = new EmailReplyApprovalModel(this.dbpath);
  }

  async create(
    entity: EmailReplyApprovalEntity
  ): Promise<EmailReplyApprovalEntity> {
    try {
      await this.ensureConnection();
      return await this.approvalModel.create(entity);
    } catch (error) {
      console.error("Error creating reply approval:", error);
      throw error;
    }
  }

  async read(id: number): Promise<EmailReplyApprovalEntity | null> {
    try {
      await this.ensureConnection();
      return await this.approvalModel.read(id);
    } catch (error) {
      console.error("Error reading reply approval:", error);
      throw error;
    }
  }

  /** Active approval for a one-time token hash (delivery preflight lookup). */
  async findActiveByTokenHash(
    tokenHash: string
  ): Promise<EmailReplyApprovalEntity | null> {
    try {
      await this.ensureConnection();
      return await this.approvalModel.findActiveByTokenHash(tokenHash);
    } catch (error) {
      console.error("Error finding active reply approval by token:", error);
      throw error;
    }
  }

  async findActiveByDraft(
    draftId: number,
    revisionId: number
  ): Promise<EmailReplyApprovalEntity | null> {
    try {
      await this.ensureConnection();
      return await this.approvalModel.findActiveByDraft(draftId, revisionId);
    } catch (error) {
      console.error("Error finding active reply approval by draft:", error);
      throw error;
    }
  }

  async invalidate(id: number, reason: string, at: Date): Promise<void> {
    try {
      await this.ensureConnection();
      await this.approvalModel.invalidate(id, reason, at);
    } catch (error) {
      console.error("Error invalidating reply approval:", error);
      throw error;
    }
  }
}
