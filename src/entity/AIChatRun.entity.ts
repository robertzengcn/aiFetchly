import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

/**
 * Durable common run envelope for interactive, scheduled, goal, and agent
 * chat work (technical-design §8.3).
 *
 * Existing scheduled-loop, goal-run, and agent-task tables remain
 * authoritative for their domain data; this envelope is the shared lifecycle
 * record referenced through `owner` + `sourceId`. Transitions use
 * compare-and-set on `revision`; terminal states are immutable.
 */
@Entity("ai_chat_runs")
@Index("idx_aichatrun_runid", ["runId"], { unique: true })
@Index("idx_aichatrun_conv_created", ["conversationId", "createdAt"])
@Index("idx_aichatrun_status_updated", ["status", "updatedAt"])
export class AIChatRunEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 64, nullable: false })
  runId: string;

  @Order(2)
  @Column("varchar", { length: 100, nullable: false })
  conversationId: string;

  /** "interactive" | "scheduled" | "goal" | "agent". */
  @Order(3)
  @Column("varchar", { length: 20, nullable: false })
  owner: string;

  /** Domain id from the owning subsystem (schedule id, goal run id, ...). */
  @Order(4)
  @Column("varchar", { length: 64, nullable: true })
  sourceId: string | null;

  /** "general" | "browser" | "cpu" | "artifact_batch". */
  @Order(5)
  @Column("varchar", { length: 20, nullable: false, default: "general" })
  resourceClass: string;

  /** ChatRunStatus — see aiChatWorkspaceTypes. Terminal states immutable. */
  @Order(6)
  @Column("varchar", { length: 24, nullable: false, default: "queued" })
  status: string;

  @Order(7)
  @Column("datetime", { nullable: false })
  queuedAt: Date;

  @Order(8)
  @Column("datetime", { nullable: true })
  startedAt: Date | null;

  @Order(9)
  @Column("datetime", { nullable: true })
  waitingAt: Date | null;

  @Order(10)
  @Column("datetime", { nullable: true })
  finishedAt: Date | null;

  /** Assistant message row produced by this run, once persisted. */
  @Order(11)
  @Column("varchar", { length: 100, nullable: true })
  assistantMessageId: string | null;

  /** Stable machine error code. Never prompts or assistant bodies. */
  @Order(12)
  @Column("varchar", { length: 100, nullable: true })
  errorCode: string | null;

  /** Bounded safe error summary for UI display. */
  @Order(13)
  @Column("varchar", { length: 500, nullable: true })
  errorSummary: string | null;

  /** Compare-and-set token: incremented on every durable transition. */
  @Order(14)
  @Column("int", { nullable: false, default: 0 })
  revision: number;

}
