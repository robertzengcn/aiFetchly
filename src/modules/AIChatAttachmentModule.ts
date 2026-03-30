import { BaseModule } from "@/modules/baseModule";
import {
  AIChatAttachmentModel,
  UploadedFileForPersistence,
} from "@/model/AIChatAttachment.model";

export class AIChatAttachmentModule extends BaseModule {
  private attachmentModel: AIChatAttachmentModel;

  constructor() {
    super();
    this.attachmentModel = new AIChatAttachmentModel(this.dbpath);
  }

  async saveUploadedFiles(
    conversationId: string,
    messageId: string,
    files: UploadedFileForPersistence[]
  ): Promise<void> {
    await this.ensureConnection();
    await this.attachmentModel.saveUploadedFiles(
      conversationId,
      messageId,
      files
    );
  }

  async deleteByConversation(conversationId: string): Promise<number> {
    await this.ensureConnection();
    return await this.attachmentModel.deleteByConversation(conversationId);
  }

  async deleteAll(): Promise<void> {
    await this.ensureConnection();
    await this.attachmentModel.deleteAll();
  }
}
