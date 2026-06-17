import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

@Entity("agent_tasks")
@Index(["agentTaskId"], { unique: true })
@Index(["workflowRunId"])
@Index(["agentId"])
@Index(["status"])
export class AgentTaskEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false, unique: true })
  agentTaskId: string;

  @Order(2)
  @Column("varchar", { length: 100, nullable: true })
  workflowRunId?: string | null;

  @Order(3)
  @Column("varchar", { length: 100, nullable: true })
  parentTaskId?: string | null;

  @Order(4)
  @Column("varchar", { length: 100, nullable: true })
  parentConversationId?: string | null;

  @Order(5)
  @Column("varchar", { length: 100, nullable: false })
  agentConversationId: string;

  @Order(6)
  @Column("varchar", { length: 100, nullable: false })
  agentId: string;

  @Order(7)
  @Column("int", { nullable: false })
  agentVersion: number;

  @Order(8)
  @Column("varchar", { length: 32, nullable: false })
  status: string;

  @Order(9)
  @Column("text", { nullable: false })
  prompt: string;

  @Order(10)
  @Column("simple-json", { nullable: false })
  taskPacket: Record<string, unknown>;

  @Order(11)
  @Column("simple-json", { nullable: true })
  result?: Record<string, unknown> | null;

  @Order(12)
  @Column("text", { nullable: true })
  errorMessage?: string | null;

  @Order(13)
  @Column("int", { nullable: false, default: 0 })
  toolCallsCount: number;

  @Order(14)
  @Column("datetime", { nullable: true })
  startedAt?: Date | null;

  @Order(15)
  @Column("datetime", { nullable: true })
  finishedAt?: Date | null;
}
