import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";
import type { AIChatGoalStatus } from "@/entityTypes/aiChatGoalTypes";

/**
 * One durable active or terminal goal for a conversation.
 * Source: ai-chat-goal-loop-technical-design.md §4.2.
 */
@Entity("ai_chat_goals")
@Index(["conversationId"])
@Index(["conversationId", "status"])
export class AIChatGoalEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false, unique: true })
  goalId!: string;

  @Order(2)
  @Column("varchar", { length: 100, nullable: false })
  conversationId!: string;

  @Order(3)
  @Column("text", { nullable: false })
  objective!: string;

  /** Serialized AIChatGoalCriterion[]. */
  @Order(4)
  @Column("text", { nullable: false })
  criteria!: string;

  @Order(5)
  @Column("varchar", { length: 100, nullable: true })
  planId?: string;

  @Order(6)
  @Column("varchar", { length: 32, nullable: false })
  status!: AIChatGoalStatus;

  /** Serialized AIChatGoalLoopLimits (default bounds for /loop runs). */
  @Order(7)
  @Column("text", { nullable: true })
  loopLimits?: string;

  @Order(8)
  @Column("int", { nullable: false, default: 0 })
  iterationCount!: number;

  /** Deterministic fingerprint of goal-relevant source state. */
  @Order(9)
  @Column("varchar", { length: 128, nullable: true })
  sourceRevisionFingerprint?: string;

  @Order(10)
  @Column("varchar", { length: 32, nullable: true })
  latestVerdict?: string;

  @Order(11)
  @Column("text", { nullable: true })
  terminalReason?: string;
}
