import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

@Entity("ai_chat_compact_summaries")
@Index("idx_compact_summaries_conv", ["conversationId"])
@Index("idx_compact_summaries_conv_status", ["conversationId", "status"])
@Index("idx_compact_summaries_through", ["throughTimestamp"])
export class AIChatCompactSummaryEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false, unique: true })
  compactId: string;

  @Order(2)
  @Column("varchar", { length: 100, nullable: false })
  conversationId: string;

  @Order(3)
  @Column("text", { nullable: false })
  summary: string;

  @Order(4)
  @Column("varchar", { length: 100, nullable: true })
  fromMessageId?: string;

  @Order(5)
  @Column("varchar", { length: 100, nullable: false })
  throughMessageId: string;

  @Order(6)
  @Column("datetime", { nullable: false })
  throughTimestamp: Date;

  @Order(7)
  @Column("int", { nullable: false, default: 0 })
  sourceMessageCount: number;

  @Order(8)
  @Column("int", { nullable: true })
  inputTokenEstimate?: number;

  @Order(9)
  @Column("int", { nullable: true })
  outputTokenEstimate?: number;

  @Order(10)
  @Column("varchar", { length: 100, nullable: true })
  model?: string;

  @Order(11)
  @Column("varchar", { length: 30, nullable: false, default: "active" })
  status: string; // 'active' | 'superseded' | 'failed'
}
