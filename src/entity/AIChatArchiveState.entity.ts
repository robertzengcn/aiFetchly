import "reflect-metadata";
import { Entity, Column, PrimaryColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

/**
 * Per-conversation archive state: the epoch (invalidated on tombstone/restore),
 * source revision counter, high-water mark for backfill, active generation +
 * active run pointers, and the lease/fence used by the compaction coordinator.
 *
 * One row per conversation (conversationId is the primary key). A tombstoned
 * conversation (deletedAt set) must NOT be resurrected — see archive Module.
 */
@Entity("ai_chat_archive_state")
export class AIChatArchiveStateEntity extends AuditableEntity {
  @PrimaryColumn("varchar", { length: 100 })
  @Order(1)
  conversationId: string;

  @Order(2)
  @Column("varchar", { length: 64, nullable: false })
  epoch: string;

  @Order(3)
  @Column("int", { nullable: false, default: 0 })
  sourceRevision: number;

  @Order(4)
  @Column("bigint", { nullable: false, default: 0 })
  highWaterTimestampMs: number;

  @Order(5)
  @Column("int", { nullable: false, default: 0 })
  highWaterRowId: number;

  @Order(6)
  @Column("varchar", { length: 100, nullable: true })
  activeGenerationId?: string;

  @Order(7)
  @Column("varchar", { length: 100, nullable: true })
  activeRunId?: string;

  @Order(8)
  @Column("varchar", { length: 100, nullable: true })
  leaseOwner?: string;

  @Order(9)
  @Column("bigint", { nullable: true })
  leaseUntilMs?: number;

  @Order(10)
  @Column("int", { nullable: false, default: 0 })
  fence: number;

  @Order(11)
  @Column("text", { nullable: true })
  indexCursorJson?: string;

  @Order(12)
  @Column("varchar", { length: 20, nullable: false, default: "absent" })
  indexState: string;

  @Order(13)
  @Column("int", { nullable: false, default: 1 })
  schemaVersion: number;

  @Order(14)
  @Column("datetime", { nullable: true })
  deletedAt?: Date;
}
