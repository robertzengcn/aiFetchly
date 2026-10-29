import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";
import type { GoalEvidenceSourceKind } from "@/entityTypes/aiChatGoalTypes";

/**
 * Evidence metadata and a bounded/redacted excerpt used to reproduce a
 * verification decision. Never stores unbounded stdout/stderr or raw log files.
 * Source: ai-chat-goal-loop-technical-design.md §4.2, §7.
 */
@Entity("ai_chat_goal_evidence")
@Index(["goalId", "runId"])
@Index(["criterionId"])
@Index(["createdAt"])
export class AIChatGoalEvidenceEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false, unique: true })
  evidenceId!: string;

  @Order(2)
  @Column("varchar", { length: 100, nullable: false })
  goalId!: string;

  @Order(3)
  @Column("varchar", { length: 100, nullable: true })
  runId?: string;

  @Order(4)
  @Column("int", { nullable: true })
  iteration?: number;

  @Order(5)
  @Column("varchar", { length: 100, nullable: true })
  criterionId?: string;

  @Order(6)
  @Column("varchar", { length: 32, nullable: false })
  sourceKind!: GoalEvidenceSourceKind;

  @Order(7)
  @Column("varchar", { length: 16, nullable: false })
  state!: "pass" | "fail" | "pending";

  @Order(8)
  @Column("varchar", { length: 128, nullable: true })
  sourceRevision?: string;

  @Order(9)
  @Column("varchar", { length: 128, nullable: true })
  contentHash?: string;

  /** Bounded structured result metadata, JSON-encoded. */
  @Order(10)
  @Column("text", { nullable: true })
  resultMetadata?: string;

  /** Bounded, redacted excerpt. */
  @Order(11)
  @Column("text", { nullable: true })
  excerpt?: string;

  @Order(12)
  @Column("datetime", { nullable: false })
  timestamp!: Date;
}
