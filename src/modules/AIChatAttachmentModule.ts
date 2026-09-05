import { BaseModule } from "@/modules/baseModule";
import {
  AIChatAttachmentModel,
  StoredAttachmentFile,
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

  /** Load queued attachment bytes stored under a pending message's
   * deterministic userMessageId (message-queue design §7.6). */
  async getByMessageId(messageId: string): Promise<StoredAttachmentFile[]> {
    await this.ensureConnection();
    return await this.attachmentModel.getByMessageId(messageId);
  }

  /** Delete attachment rows for one message (pending-message cleanup). */
  async deleteByMessageId(messageId: string): Promise<number> {
    await this.ensureConnection();
    return await this.attachmentModel.deleteByMessageId(messageId);
  }

  async deleteAll(): Promise<void> {
    await this.ensureConnection();
    await this.attachmentModel.deleteAll();
  }

  async getLatestAttachmentByName(
    conversationId: string,
    fileName: string
  ): Promise<StoredAttachmentFile | null> {
    await this.ensureConnection();
    return await this.attachmentModel.getLatestAttachmentByName(
      conversationId,
      fileName
    );
  }

  async getLatestAttachmentBySha256(
    conversationId: string,
    sha256: string
  ): Promise<StoredAttachmentFile | null> {
    await this.ensureConnection();
    return await this.attachmentModel.getLatestAttachmentBySha256(
      conversationId,
      sha256
    );
  }
}
