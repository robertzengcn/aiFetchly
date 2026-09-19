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
 * A bounded summary section: covers exactly one contiguous source range
 * [sourceStart..sourceEnd] (by timestamp + rowId) and stores the structured
 * SectionSummaryV1 JSON. `(conversationId, epoch, workKey)` is unique so a
 * resumed run reuses the same section instead of re-summarizing. Sections
 * start `staged`, become `published` when a generation is published, or
 * `invalidated` when the epoch/revision moves under them.
 */
@Entity("ai_chat_compaction_sections")
@Unique("uq_compaction_sections_workkey", [
  "conversationId",
  "epoch",
  "workKey",
])
@Index("idx_compaction_sections_ordinal", [
  "conversationId",
  "epoch",
  "ordinal",
])
export class AIChatCompactionSectionEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false, unique: true })
  sectionId: string;

  @Order(2)
  @Column("varchar", { length: 100, nullable: false })
  conversationId: string;

  @Order(3)
  @Column("varchar", { length: 64, nullable: false })
  epoch: string;

  @Order(4)
  @Column("int", { nullable: false })
  revision: number;

  @Order(5)
  @Column("int", { nullable: false })
  ordinal: number;

  @Order(6)
  @Column("varchar", { length: 128, nullable: false })
  workKey: string;

  @Order(7)
  @Column("bigint", { nullable: false, default: 0 })
  sourceStartTimestampMs: number;

  @Order(8)
  @Column("int", { nullable: false, default: 0 })
  sourceStartRowId: number;

  @Order(9)
  @Column("bigint", { nullable: false, default: 0 })
  sourceEndTimestampMs: number;

  @Order(10)
  @Column("int", { nullable: false, default: 0 })
  sourceEndRowId: number;

  @Order(11)
  @Column("text", { nullable: false })
  sourceManifestJson: string;

  @Order(12)
  @Column("text", { nullable: false })
  summaryJson: string;

  @Order(13)
  @Column("int", { nullable: true })
  inputTokenEstimate?: number;

  @Order(14)
  @Column("int", { nullable: true })
  outputTokenEstimate?: number;

  @Order(15)
  @Column("varchar", { length: 100, nullable: true })
  model?: string;

  @Order(16)
  @Column("varchar", { length: 20, nullable: false, default: "staged" })
  status: string;

  @Order(17)
  @Column("varchar", { length: 64, nullable: true })
  sourceHash?: string;

  @Order(18)
  @Column("varchar", { length: 20, nullable: false, default: "v1" })
  promptSchemaVersion: string;
}
