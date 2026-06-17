import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

@Entity("agent_task_messages")
@Index(["agentTaskId"])
@Index(["createdAt"])
export class AgentTaskMessageEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false })
  agentTaskId: string;

  @Order(2)
  @Column("varchar", { length: 32, nullable: false })
  role: string;

  @Order(3)
  @Column("text", { nullable: false })
  content: string;

  @Order(4)
  @Column("varchar", { length: 100, nullable: true })
  toolCallId?: string | null;

  @Order(5)
  @Column("simple-json", { nullable: true })
  metadata?: Record<string, unknown> | null;
}
