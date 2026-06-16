import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

@Entity("agent_definitions")
@Index(["agentId"], { unique: true })
@Index(["status"])
export class AgentDefinitionEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false, unique: true })
  agentId: string;

  @Order(2)
  @Column("varchar", { length: 120, nullable: false })
  name: string;

  @Order(3)
  @Column("text", { nullable: false })
  description: string;

  @Order(4)
  @Column("int", { nullable: false })
  version: number;

  @Order(5)
  @Column("text", { nullable: false })
  systemPrompt: string;

  @Order(6)
  @Column("simple-json", { nullable: false })
  allowedTools: string[];

  @Order(7)
  @Column("varchar", { length: 120, nullable: true })
  defaultModel?: string | null;

  @Order(8)
  @Column("varchar", { length: 32, nullable: false, default: "specialist" })
  mode: string;

  @Order(9)
  @Column("int", { nullable: false, default: 8 })
  maxToolCalls: number;

  @Order(10)
  @Column("int", { nullable: false, default: 300000 })
  maxRuntimeMs: number;

  @Order(11)
  @Column("int", { nullable: false, default: 8 })
  maxContinueCalls: number;

  @Order(12)
  @Column("simple-json", { nullable: false })
  outputSchema: Record<string, unknown>;

  @Order(13)
  @Column("varchar", { length: 32, nullable: false, default: "active" })
  status: string;
}
