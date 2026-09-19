import "reflect-metadata";
import {
  Entity,
  Column,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

/**
 * Lightweight projection of a source message row into the archive index:
 * (conversationId, epoch, sourceRowId) is unique. Stores rowId/timestamp
 * ordering, the turn association, the message type + optional toolCallId +
 * paired tool row, and the code-point length of the source content (so the
 * packer can budget without re-reading full text). Does NOT store source
 * text — that lives only in ai_chat_messages (originals never rewritten).
 */
@Entity("ai_chat_archive_entries")
@Unique("uq_archive_entries_conv_epoch_row", [
  "conversationId",
  "epoch",
  "sourceRowId",
])
@Index("idx_archive_entries_turn", [
  "conversationId",
  "epoch",
  "turnId",
  "timestampMs",
  "sourceRowId",
])
@Index("idx_archive_entries_tool", [
  "conversationId",
  "epoch",
  "toolCallId",
  "messageType",
])
export class AIChatArchiveEntryEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false })
  conversationId: string;

  @Order(2)
  @Column("varchar", { length: 64, nullable: false })
  epoch: string;

  @Order(3)
  @Column("int", { nullable: false })
  sourceRowId: number;

  @Order(4)
  @Column("bigint", { nullable: false, default: 0 })
  timestampMs: number;

  @Order(5)
  @Column("int", { nullable: false, default: 0 })
  sourceRevision: number;

  @Order(6)
  @Column("varchar", { length: 100, nullable: true })
  turnId?: string;

  @Order(7)
  @Column("varchar", { length: 20, nullable: false })
  messageType: string;

  @Order(8)
  @Column("varchar", { length: 100, nullable: true })
  toolCallId?: string;

  @Order(9)
  @Column("int", { nullable: true })
  pairedSourceRowId?: number;

  @Order(10)
  @Column("int", { nullable: false, default: 0 })
  contentCodePointLength: number;

  @Order(11)
  @Column("varchar", { length: 100, nullable: false })
  messageId: string;
}
