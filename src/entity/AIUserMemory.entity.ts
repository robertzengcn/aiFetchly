import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

@Entity("ai_user_memories")
@Index("idx_ai_user_memories_memory_id", ["memoryId"], { unique: true })
@Index("idx_ai_user_memories_type", ["type"])
@Index("idx_ai_user_memories_status", ["status"])
@Index("idx_ai_user_memories_source_kind", ["sourceKind"])
@Index("idx_ai_user_memories_source_conversation", ["sourceConversationId"])
@Index("idx_ai_user_memories_source_agent_task", ["sourceAgentTaskId"])
@Index("idx_ai_user_memories_last_used", ["lastUsedAt"])
@Index("idx_ai_user_memories_updated", ["updatedAt"])
export class AIUserMemoryEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false, unique: true })
  memoryId: string;

  @Order(2)
  @Column("varchar", { length: 30, nullable: false })
  type: string;

  @Order(3)
  @Column("varchar", { length: 200, nullable: false })
  title: string;

  @Order(4)
  @Column("text", { nullable: false })
  content: string;

  @Order(5)
  @Column("varchar", { length: 30, nullable: false, default: "active" })
  status: string;

  @Order(6)
  @Column("int", { nullable: false, default: 100 })
  confidence: number;

  @Order(7)
  @Column("varchar", { length: 30, nullable: true })
  sourceKind?: string | null;

  @Order(8)
  @Column("varchar", { length: 100, nullable: true })
  sourceConversationId?: string | null;

  @Order(9)
  @Column("varchar", { length: 100, nullable: true })
  sourceAgentTaskId?: string | null;

  @Order(10)
  @Column("simple-json", { nullable: true })
  sourceMessageIds?: string[] | null;

  @Order(11)
  @Column("datetime", { nullable: true })
  lastUsedAt?: Date | null;

  @Order(12)
  @Column("simple-json", { nullable: true })
  metadata?: Record<string, unknown> | null;
}
