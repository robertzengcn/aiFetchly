import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";
import type { AIChatPlanVersionAuthor } from "@/entityTypes/aiChatPlanTypes";

@Entity("ai_chat_plan_versions")
@Index(["planId", "version"], { unique: true })
export class AIChatPlanVersionEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false })
  planId: string;

  @Order(2)
  @Column("int", { nullable: false })
  version: number;

  @Order(3)
  @Column("text", { nullable: false })
  planMarkdown: string;

  @Order(4)
  @Column("text", { nullable: true })
  planJson?: string;

  @Order(5)
  @Column("text", { nullable: true })
  changeReason?: string;

  @Order(6)
  @Column("varchar", { length: 20, nullable: false })
  createdBy: AIChatPlanVersionAuthor;
}
