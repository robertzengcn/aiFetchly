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
 * A turn within a conversation: the [first..last] (timestamp, rowId) range
 * of the messages that compose it, plus a terminal status. Turns are the
 * unit of section packing — complete turns only — and the unit of the
 * retained recent suffix. `confidence` distinguishes native turn metadata
 * from inferred boundaries.
 */
@Entity("ai_chat_archive_turns")
@Unique("uq_archive_turns_conv_epoch_turn", [
  "conversationId",
  "epoch",
  "turnId",
])
@Index("idx_archive_turns_status", [
  "conversationId",
  "epoch",
  "status",
  "lastTimestampMs",
  "lastRowId",
])
export class AIChatArchiveTurnEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false })
  conversationId: string;

  @Order(2)
  @Column("varchar", { length: 64, nullable: false })
  epoch: string;

  @Order(3)
  @Column("varchar", { length: 100, nullable: false })
  turnId: string;

  @Order(4)
  @Column("bigint", { nullable: false, default: 0 })
  firstTimestampMs: number;

  @Order(5)
  @Column("int", { nullable: false, default: 0 })
  firstRowId: number;

  @Order(6)
  @Column("bigint", { nullable: false, default: 0 })
  lastTimestampMs: number;

  @Order(7)
  @Column("int", { nullable: false, default: 0 })
  lastRowId: number;

  @Order(8)
  @Column("varchar", { length: 20, nullable: false, default: "open" })
  status: string;

  @Order(9)
  @Column("datetime", { nullable: true })
  completedAt?: Date;

  @Order(10)
  @Column("varchar", { length: 20, nullable: false, default: "native" })
  confidence: string;
}
