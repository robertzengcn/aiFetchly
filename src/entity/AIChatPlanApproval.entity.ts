import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";
import type { AIChatPlanApprovalDecision } from "@/entityTypes/aiChatPlanTypes";

@Entity("ai_chat_plan_approvals")
@Index(["planId", "version"])
export class AIChatPlanApprovalEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false })
  planId: string;

  @Order(2)
  @Column("int", { nullable: false })
  version: number;

  @Order(3)
  @Column("varchar", { length: 32, nullable: false })
  decision: AIChatPlanApprovalDecision;

  @Order(4)
  @Column("text", { nullable: true })
  feedback?: string;

  @Order(5)
  @Column("text", { nullable: true })
  metadata?: string;
}
