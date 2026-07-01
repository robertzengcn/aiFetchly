import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

@Entity("ai_memory_consolidation_runs")
@Index("idx_memory_runs_run_id", ["runId"], { unique: true })
@Index("idx_memory_runs_status", ["status"])
@Index("idx_memory_runs_started", ["startedAt"])
@Index("idx_memory_runs_finished", ["finishedAt"])
export class AIMemoryConsolidationRunEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false, unique: true })
  runId: string;

  @Order(2)
  @Column("varchar", { length: 30, nullable: false })
  status: string;

  @Order(3)
  @Column("datetime", { nullable: false })
  startedAt: Date;

  @Order(4)
  @Column("datetime", { nullable: true })
  finishedAt?: Date | null;

  @Order(5)
  @Column("datetime", { nullable: true })
  reviewedSince?: Date | null;

  @Order(6)
  @Column("datetime", { nullable: true })
  reviewedThrough?: Date | null;

  @Order(7)
  @Column("int", { nullable: false, default: 0 })
  chatConversationsReviewed: number;

  @Order(8)
  @Column("int", { nullable: false, default: 0 })
  agentTasksReviewed: number;

  @Order(9)
  @Column("int", { nullable: false, default: 0 })
  memoriesCreated: number;

  @Order(10)
  @Column("int", { nullable: false, default: 0 })
  memoriesUpdated: number;

  @Order(11)
  @Column("int", { nullable: false, default: 0 })
  memoriesArchived: number;

  @Order(12)
  @Column("varchar", { length: 100, nullable: true })
  model?: string | null;

  @Order(13)
  @Column("text", { nullable: true })
  errorMessage?: string | null;
}
