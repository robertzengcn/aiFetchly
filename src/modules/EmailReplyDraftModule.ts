import { BaseModule } from "@/modules/baseModule";
import {
  EmailReplyDraftModel,
  ReplyDraftListInput,
} from "@/model/EmailReplyDraft.model";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { EmailReplyDraftStatus } from "@/entityTypes/emailReceiveTypes";

/** Business-logic facade over {@link EmailReplyDraftModel}. */
export class EmailReplyDraftModule extends BaseModule {
  private draftModel: EmailReplyDraftModel;

  constructor() {
    super();
    this.draftModel = new EmailReplyDraftModel(this.dbpath);
  }

  async create(
    entity: EmailReplyDraftEntity
  ): Promise<EmailReplyDraftEntity> {
    try {
      await this.ensureConnection();
      return await this.draftModel.create(entity);
    } catch (error) {
      console.error("Error creating reply draft:", error);
      throw error;
    }
  }

  async read(id: number): Promise<EmailReplyDraftEntity | null> {
    try {
      await this.ensureConnection();
      return await this.draftModel.read(id);
    } catch (error) {
      console.error("Error reading reply draft:", error);
      throw error;
    }
  }

  async updateStatus(
    id: number,
    status: EmailReplyDraftStatus,
    error: string | null = null
  ): Promise<void> {
    try {
      await this.ensureConnection();
      await this.draftModel.updateStatus(id, status, error);
    } catch (e) {
      console.error("Error updating draft status:", e);
      throw e;
    }
  }

  async updateBody(
    id: number,
    bodyText: string,
    bodyHtml: string | null
  ): Promise<void> {
    try {
      await this.ensureConnection();
      await this.draftModel.updateBody(id, bodyText, bodyHtml);
    } catch (e) {
      console.error("Error updating draft body:", e);
      throw e;
    }
  }

  async markSent(id: number, sentAt: Date): Promise<void> {
    try {
      await this.ensureConnection();
      await this.draftModel.markSent(id, sentAt);
    } catch (e) {
      console.error("Error marking draft sent:", e);
      throw e;
    }
  }

  async listByMessage(
    messageId: number
  ): Promise<EmailReplyDraftEntity[]> {
    try {
      await this.ensureConnection();
      return await this.draftModel.listByMessage(messageId);
    } catch (error) {
      console.error("Error listing drafts by message:", error);
      throw error;
    }
  }

  async list(
    input: ReplyDraftListInput
  ): Promise<{ records: EmailReplyDraftEntity[]; total: number }> {
    try {
      await this.ensureConnection();
      const records = await this.draftModel.list(input);
      const total = await this.draftModel.count(input);
      return { records, total };
    } catch (error) {
      console.error("Error listing reply drafts:", error);
      throw error;
    }
  }
}
