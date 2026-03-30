import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

/**
 * Stores original user-uploaded file bytes for AI chat (SQLite BLOB).
 * Rows are tied to the conversation and the specific user messageId.
 */
@Entity("ai_chat_attachments")
@Index(["conversationId", "messageId"])
@Index(["conversationId"])
export class AIChatAttachmentEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false })
  messageId: string;

  @Order(2)
  @Column("varchar", { length: 100, default: "default", nullable: false })
  conversationId: string;

  @Order(3)
  @Column("varchar", { length: 255, nullable: false })
  fileName: string;

  @Order(4)
  @Column("varchar", { length: 120, nullable: false })
  mimeType: string;

  @Order(5)
  @Column("int", { nullable: false })
  sizeBytes: number;

  @Order(6)
  @Column({
    type: "blob",
    nullable: false,
  })
  contentBlob: Buffer;

  @Order(7)
  @Column("varchar", { length: 64, nullable: true })
  sha256?: string;
}

