import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

@Entity("agent_tool_calls")
@Index(["agentTaskId"])
@Index(["toolName"])
@Index(["status"])
export class AgentToolCallEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false })
  agentTaskId: string;

  @Order(2)
  @Column("varchar", { length: 100, nullable: false })
  toolCallId: string;

  @Order(3)
  @Column("varchar", { length: 120, nullable: false })
  toolName: string;

  @Order(4)
  @Column("simple-json", { nullable: false })
  argumentsSummary: Record<string, unknown>;

  @Order(5)
  @Column("varchar", { length: 32, nullable: false })
  status: string;

  @Order(6)
  @Column("text", { nullable: true })
  resultSummary?: string | null;

  @Order(7)
  @Column("text", { nullable: true })
  errorMessage?: string | null;

  @Order(8)
  @Column("int", { nullable: true })
  durationMs?: number | null;
}
