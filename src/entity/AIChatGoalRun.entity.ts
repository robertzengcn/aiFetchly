import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";
import type { AIChatGoalStatus } from "@/entityTypes/aiChatGoalTypes";

/**
 * A bounded /loop invocation and its terminal reason. Limits are copied in so
 * changing a future default cannot alter an in-progress or historical run.
 * Source: ai-chat-goal-loop-technical-design.md §4.2.
 */
@Entity("ai_chat_goal_runs")
@Index(["goalId"])
@Index(["status"])
export class AIChatGoalRunEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false, unique: true })
  runId: string;

  @Order(2)
  @Column("varchar", { length: 100, nullable: false })
  goalId: string;

  @Order(3)
  @Column("varchar", { length: 100, nullable: false })
  conversationId: string;

  @Order(4)
  @Column("varchar", { length: 32, nullable: false })
  status: AIChatGoalStatus;

  @Order(5)
  @Column("int", { nullable: false })
  maxIterations: number;

  @Order(6)
  @Column("int", { nullable: false })
  maxRuntimeMs: number;

  @Order(7)
  @Column("int", { nullable: false })
  repeatedFailureThreshold: number;

  @Order(8)
  @Column("int", { nullable: false, default: 0 })
  iterationCount: number;

  @Order(9)
  @Column("boolean", { nullable: false, default: false })
  cancelled: boolean;

  @Order(10)
  @Column("datetime", { nullable: false })
  startedAt: Date;

  @Order(11)
  @Column("datetime", { nullable: true })
  endedAt?: Date;

  @Order(12)
  @Column("text", { nullable: true })
  terminalReason?: string;
}
