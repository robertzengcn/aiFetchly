import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

@Entity("agent_definitions")
@Index(["agentId"], { unique: true })
@Index(["status"])
@Index(["source"])
@Index(["pluginName", "status"])
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

  @Order(14)
  @Column("varchar", { length: 32, nullable: false, default: "built-in" })
  source: string;

  @Order(15)
  @Column("varchar", { length: 100, nullable: true })
  pluginName?: string | null;

  @Order(16)
  @Column("text", { nullable: true })
  pluginComponentPath?: string | null;

  @Order(17)
  @Column("text", { nullable: true })
  manifestJson?: string | null;

  @Order(18)
  @Column("varchar", { length: 32, nullable: false, default: "healthy" })
  health: string;

  @Order(19)
  @Column("text", { nullable: true })
  lastError?: string | null;
}
