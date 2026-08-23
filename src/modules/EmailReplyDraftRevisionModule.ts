import { BaseModule } from "@/modules/baseModule";
import { EmailReplyDraftRevisionModel } from "@/model/EmailReplyDraftRevision.model";
import { EmailReplyDraftRevisionEntity } from "@/entity/EmailReplyDraftRevision.entity";

/** Business-logic facade over {@link EmailReplyDraftRevisionModel}. */
export class EmailReplyDraftRevisionModule extends BaseModule {
  private revisionModel: EmailReplyDraftRevisionModel;

  constructor() {
    super();
    this.revisionModel = new EmailReplyDraftRevisionModel(this.dbpath);
  }

  async create(
    entity: EmailReplyDraftRevisionEntity
  ): Promise<EmailReplyDraftRevisionEntity> {
    try {
      await this.ensureConnection();
      return await this.revisionModel.create(entity);
    } catch (error) {
      console.error("Error creating reply draft revision:", error);
      throw error;
    }
  }

  async read(id: number): Promise<EmailReplyDraftRevisionEntity | null> {
    try {
      await this.ensureConnection();
      return await this.revisionModel.read(id);
    } catch (error) {
      console.error("Error reading reply draft revision:", error);
      throw error;
    }
  }

  async readCurrent(
    draftId: number
  ): Promise<EmailReplyDraftRevisionEntity | null> {
    try {
      await this.ensureConnection();
      return await this.revisionModel.readCurrent(draftId);
    } catch (error) {
      console.error("Error reading current reply draft revision:", error);
      throw error;
    }
  }

  async listByDraft(
    draftId: number
  ): Promise<EmailReplyDraftRevisionEntity[]> {
    try {
      await this.ensureConnection();
      return await this.revisionModel.listByDraft(draftId);
    } catch (error) {
      console.error("Error listing reply draft revisions:", error);
      throw error;
    }
  }
}
