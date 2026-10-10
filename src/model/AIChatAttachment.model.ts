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

export type StoredAttachmentFile = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentBlob: Buffer;
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

  /**
   * Load all attachment rows stored under one messageId (message-queue
   * design §7.6): queued attachment bytes live under the deterministic
   * pending userMessageId, so dispatch reconstructs uploaded files from
   * these trusted BLOBs instead of renderer-supplied data.
   */
  async getByMessageId(messageId: string): Promise<StoredAttachmentFile[]> {
    const entities = await this.repository.find({
      where: { messageId },
      order: { id: "ASC" },
    });
    return entities.map((entity) => ({
      fileName: entity.fileName,
      mimeType: entity.mimeType,
      sizeBytes: entity.sizeBytes,
      contentBlob: entity.contentBlob,
    }));
  }

  /**
   * Delete attachment rows under one messageId. Used when a pending message
   * is cancelled so its staged bytes do not linger (PRD §7.8).
   */
  async deleteByMessageId(messageId: string): Promise<number> {
    const result = await this.repository.delete({ messageId });
    return result.affected || 0;
  }

  /**
   * Get the most recent uploaded file bytes by conversation + file name.
   */
  async getLatestAttachmentByName(
    conversationId: string,
    fileName: string
  ): Promise<StoredAttachmentFile | null> {
    const entity = await this.repository.findOne({
      where: { conversationId, fileName },
      order: { id: "DESC" },
    });

    if (!entity) {
      return null;
    }

    return {
      fileName: entity.fileName,
      mimeType: entity.mimeType,
      sizeBytes: entity.sizeBytes,
      contentBlob: entity.contentBlob,
    };
  }

  /**
   * Get the most recent uploaded file bytes by conversation + SHA256.
   */
  async getLatestAttachmentBySha256(
    conversationId: string,
    sha256: string
  ): Promise<StoredAttachmentFile | null> {
    const entity = await this.repository.findOne({
      where: { conversationId, sha256 },
      order: { id: "DESC" },
    });

    if (!entity) {
      return null;
    }

    return {
      fileName: entity.fileName,
      mimeType: entity.mimeType,
      sizeBytes: entity.sizeBytes,
      contentBlob: entity.contentBlob,
    };
  }

  async deleteAll(): Promise<void> {
    await this.repository.clear();
  }
}
