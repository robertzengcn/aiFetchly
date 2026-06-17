import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";
import type { AIChatPlanQuestionStatus } from "@/entityTypes/aiChatPlanTypes";

@Entity("ai_chat_plan_questions")
@Index(["conversationId"])
@Index(["planId", "status"])
export class AIChatPlanQuestionEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false, unique: true })
  questionId: string;

  @Order(2)
  @Column("varchar", { length: 100, nullable: false })
  planId: string;

  @Order(3)
  @Column("varchar", { length: 100, nullable: false })
  conversationId: string;

  @Order(4)
  @Column("varchar", { length: 20, nullable: false })
  status: AIChatPlanQuestionStatus;

  @Order(5)
  @Column("text", { nullable: false })
  questionsJson: string;

  @Order(6)
  @Column("text", { nullable: true })
  answersJson?: string;

  @Order(7)
  @Column("datetime", { nullable: true })
  answeredAt?: Date;
}
