import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";

/**
 * Maps legacy path-derived workspace keys (and their known roots) to the
 * internal memory scope that owns them (design §8.2).
 *
 * The unique key on `workspaceKey` guarantees one scope per path identity;
 * one scope may own several paths (clone + original share a portable
 * identity). No FK cascade in v1 — module layering enforces ownership
 * because TypeORM SQLite table rebuilds must be proven row-preserving
 * before adding constraints.
 */
@Entity("ai_workspace_memory_scope_paths")
@Index("uq_ai_workspace_scope_path_key", ["workspaceKey"], { unique: true })
@Index("idx_ai_workspace_scope_path_scope", ["scopeId"])
export class AIWorkspaceMemoryScopePathEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column("varchar", { length: 100 })
  scopeId!: string;

  @Column("varchar", { length: 100 })
  workspaceKey!: string;

  @Column("varchar", { length: 1024 })
  workspaceRoot!: string;

  @Column("datetime", { nullable: true })
  lastSeenAt?: Date | null;
}
