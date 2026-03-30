import { BaseDb } from "@/model/Basedb";
import { AIChatAttachmentEntity } from "@/entity/AIChatAttachment.entity";
import { Repository } from "typeorm";
import crypto from "crypto";

export type UploadedFileForPersistence = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentBase64: string;
};

export class AIChatAttachmentModel extends BaseDb {
  public repository: Repository<AIChatAttachmentEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      AIChatAttachmentEntity
    );
  }

  /**
   * Persist uploaded files as SQLite BLOBs.
   */
  async saveUploadedFiles(
    conversationId: string,
    messageId: string,
    files: UploadedFileForPersistence[]
  ): Promise<void> {
    const entities: AIChatAttachmentEntity[] = [];

    for (const file of files) {
      // Decode base64 into raw bytes.
      const buffer = Buffer.from(file.contentBase64, "base64");

      // Compute SHA256 to optionally help with future deduplication/debugging.
      const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

      const entity = new AIChatAttachmentEntity();
      entity.conversationId = conversationId;
      entity.messageId = messageId;
      entity.fileName = file.fileName;
      entity.mimeType = file.mimeType;
      entity.sizeBytes = file.sizeBytes;
      entity.contentBlob = buffer;
      entity.sha256 = sha256;

      entities.push(entity);
    }

    if (entities.length > 0) {
      await this.repository.save(entities);
    }
  }

  async deleteByConversation(conversationId: string): Promise<number> {
    const result = await this.repository.delete({ conversationId });
    return result.affected || 0;
  }

  async deleteAll(): Promise<void> {
    await this.repository.clear();
  }
}
