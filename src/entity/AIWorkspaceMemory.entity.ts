import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

@Entity("ai_workspace_memories")
// Portable-memory Phase A: memory identity is now scoped — the global unique
// index on memoryId was removed in favor of (scopeId, memoryId) so an
// intentional repository fork can keep copied record ids under a regenerated
// workspace identity (PRD §12.4 / FR-067).
@Index("idx_ai_workspace_memories_memory_id", ["memoryId"])
@Index("uq_ai_workspace_memories_scope_memory", ["scopeId", "memoryId"], {
  unique: true,
})
@Index("idx_ai_workspace_memories_scope", ["scopeId"])
@Index("idx_ai_workspace_memories_scope_status", ["scopeId", "status"])
@Index("idx_ai_workspace_memories_scope_type", ["scopeId", "type"])
@Index("idx_ai_workspace_memories_workspace", ["workspaceKey"])
@Index("idx_ai_workspace_memories_workspace_status", ["workspaceKey", "status"])
@Index("idx_ai_workspace_memories_workspace_type", ["workspaceKey", "type"])
@Index("idx_ai_workspace_memories_source_conversation", [
  "sourceConversationId",
])
@Index("idx_ai_workspace_memories_source_agent_task", ["sourceAgentTaskId"])
@Index("idx_ai_workspace_memories_last_used", ["lastUsedAt"])
@Index("idx_ai_workspace_memories_updated", ["updatedAt"])
export class AIWorkspaceMemoryEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  /**
   * Internal memory scope that owns this row (design D-01). Nullable only
   * for pre-portable rows pending the legacy-scope backfill; every new write
   * populates it and the backfill converges legacy rows to
   * `wscope-legacy-<workspaceKey>`.
   */
  @Order(0)
  @Column("varchar", { length: 100, nullable: true })
  scopeId?: string | null;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false })
  memoryId!: string;

  @Order(2)
  @Column("varchar", { length: 100, nullable: false })
  workspaceKey!: string;

  @Order(3)
  @Column("varchar", { length: 1024, nullable: false })
  workspaceRoot!: string;

  @Order(4)
  @Column("varchar", { length: 30, nullable: false })
  type!: string;

  @Order(5)
  @Column("varchar", { length: 200, nullable: false })
  title!: string;

  @Order(6)
  @Column("text", { nullable: false })
  content!: string;

  @Order(7)
  @Column("varchar", { length: 30, nullable: false, default: "active" })
  status!: string;

  @Order(8)
  @Column("int", { nullable: false, default: 100 })
  confidence!: number;

  @Order(9)
  @Column("varchar", { length: 30, nullable: true })
  sourceKind?: string | null;

  @Order(10)
  @Column("varchar", { length: 100, nullable: true })
  sourceConversationId?: string | null;

  @Order(11)
  @Column("varchar", { length: 100, nullable: true })
  sourceAgentTaskId?: string | null;

  @Order(12)
  @Column("simple-json", { nullable: true })
  sourceMessageIds?: string[] | null;

  @Order(13)
  @Column("datetime", { nullable: true })
  lastUsedAt?: Date | null;

  @Order(14)
  @Column("simple-json", { nullable: true })
  metadata?: Record<string, unknown> | null;
}
