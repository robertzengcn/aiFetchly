import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

@Entity("ai_chat_session_memories")
@Index("idx_session_memories_conv", ["conversationId"], { unique: true })
@Index("idx_session_memories_status", ["status"])
@Index("idx_session_memories_updated", ["updatedAt"])
export class AIChatSessionMemoryEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false })
  conversationId: string;

  @Order(2)
  @Column("text", { nullable: false })
  summary: string;

  @Order(3)
  @Column("varchar", { length: 100, nullable: true })
  coveredThroughMessageId?: string;

  @Order(4)
  @Column("datetime", { nullable: true })
  coveredThroughTimestamp?: Date;

  @Order(5)
  @Column("int", { nullable: false, default: 0 })
  sourceMessageCount: number;

  @Order(6)
  @Column("int", { nullable: true })
  tokenEstimate?: number;

  @Order(7)
  @Column("varchar", { length: 100, nullable: true })
  model?: string;

  @Order(8)
  @Column("int", { nullable: false, default: 0 })
  failureCount: number;

  @Order(9)
  @Column("text", { nullable: true })
  lastError?: string | null;

  @Order(10)
  @Column("varchar", { length: 30, nullable: false, default: "active" })
  status: string; // 'active' | 'updating' | 'failed' | 'disabled'
}
