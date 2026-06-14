import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";
import type { AIChatPlanStatus } from "@/entityTypes/aiChatPlanTypes";

@Entity("ai_chat_plans")
@Index(["conversationId"])
@Index(["status"])
export class AIChatPlanEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false, unique: true })
  planId: string;

  @Order(2)
  @Column("varchar", { length: 100, nullable: false })
  conversationId: string;

  @Order(3)
  @Column("varchar", { length: 32, nullable: false })
  status: AIChatPlanStatus;

  @Order(4)
  @Column("varchar", { length: 200, nullable: false })
  title: string;

  @Order(5)
  @Column("text", { nullable: false })
  objective: string;

  @Order(6)
  @Column("int", { nullable: false, default: 0 })
  currentVersion: number;

  @Order(7)
  @Column("datetime", { nullable: true })
  approvedAt?: Date;

  @Order(8)
  @Column("datetime", { nullable: true })
  rejectedAt?: Date;

  @Order(9)
  @Column("text", { nullable: true })
  metadata?: string;
}
