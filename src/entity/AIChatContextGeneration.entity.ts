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
 * A published context generation: the rolling overview + continuation state
 * covering sections up to `representedSectionOrdinal`, with coverage through
 * `(coveredThroughTimestamp, coveredThroughRowId)`. Only one generation per
 * conversation is `active` at a time (CAS publication via archive state).
 * `parentGenerationId` traces the lineage; old generations are retained up
 * to the configured history limit then pruned.
 */
@Entity("ai_chat_context_generations")
@Unique("uq_context_generations_genid", ["generationId"])
@Index("idx_context_generations_conv", [
  "conversationId",
  "epoch",
  "status",
])
export class AIChatContextGenerationEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false, unique: true })
  generationId: string;

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
  @Column("varchar", { length: 100, nullable: true })
  parentGenerationId?: string;

  @Order(6)
  @Column("int", { nullable: false, default: 0 })
  representedSectionOrdinal: number;

  @Order(7)
  @Column("bigint", { nullable: false, default: 0 })
  coveredThroughTimestampMs: number;

  @Order(8)
  @Column("int", { nullable: false, default: 0 })
  coveredThroughRowId: number;

  @Order(9)
  @Column("text", { nullable: false })
  overviewJson: string;

  @Order(10)
  @Column("text", { nullable: true })
  continuationStateJson?: string;

  @Order(11)
  @Column("int", { nullable: true })
  tokenEstimate?: number;

  @Order(12)
  @Column("varchar", { length: 100, nullable: true })
  model?: string;

  @Order(13)
  @Column("varchar", { length: 20, nullable: true })
  schemaVersion?: string;

  @Order(14)
  @Column("varchar", { length: 20, nullable: false, default: "active" })
  status: string;
}
