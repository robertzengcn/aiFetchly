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
 * A single bounded, resumable compaction run. The coordinator claims a run
 * with a lease + fence; sections are staged under the run; a generation is
 * published compare-and-swap on completion. The snapshot boundary (end
 * timestamp/rowId) and retained suffix start (start timestamp/rowId) make
 * the run's source coverage immutable regardless of concurrent writes.
 *
 * `state`: queued | running | paused | cancelled | failed | completed.
 */
@Entity("ai_chat_compaction_runs")
@Unique("uq_compaction_runs_runid", ["runId"])
@Index("idx_compaction_runs_conv_state", [
  "conversationId",
  "epoch",
  "state",
])
export class AIChatCompactionRunEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false, unique: true })
  runId: string;

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
  @Column("varchar", { length: 30, nullable: false })
  trigger: string;

  @Order(6)
  @Column("varchar", { length: 20, nullable: false, default: "queued" })
  state: string;

  @Order(7)
  @Column("bigint", { nullable: false, default: 0 })
  snapshotEndTimestampMs: number;

  @Order(8)
  @Column("int", { nullable: false, default: 0 })
  snapshotEndRowId: number;

  @Order(9)
  @Column("bigint", { nullable: false, default: 0 })
  retainedStartTimestampMs: number;

  @Order(10)
  @Column("int", { nullable: false, default: 0 })
  retainedStartRowId: number;

  @Order(11)
  @Column("varchar", { length: 100, nullable: true })
  baseGenerationId?: string;

  @Order(12)
  @Column("text", { nullable: true })
  stagedCursorJson?: string;

  @Order(13)
  @Column("text", { nullable: true })
  publishedCursorJson?: string;

  @Order(14)
  @Column("text", { nullable: true })
  workingOverviewJson?: string;

  @Order(15)
  @Column("text", { nullable: true })
  continuationStateJson?: string;

  @Order(16)
  @Column("int", { nullable: false, default: 0 })
  mergedThroughOrdinal: number;

  @Order(17)
  @Column("int", { nullable: false, default: 0 })
  fence: number;

  @Order(18)
  @Column("varchar", { length: 100, nullable: true })
  leaseOwner?: string;

  @Order(19)
  @Column("bigint", { nullable: true })
  leaseUntilMs?: number;

  @Order(20)
  @Column("varchar", { length: 100, nullable: true })
  model?: string;

  @Order(21)
  @Column("int", { nullable: false, default: 0 })
  attemptCount: number;

  @Order(22)
  @Column("int", { nullable: false, default: 0 })
  contextReductionCount: number;

  @Order(23)
  @Column("varchar", { length: 50, nullable: true })
  lastFailureCode?: string;

  @Order(24)
  @Column("int", { nullable: false, default: 1 })
  schemaVersion: number;
}
