import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";

/**
 * Internal memory scope — the stable database retrieval boundary for
 * workspace memory (design D-01).
 *
 * A scope owns every memory row for one project identity. It is created the
 * first time a legacy path-derived workspace key is observed
 * (`wscope-legacy-<key>`) and may later be bound to a portable workspace UUID
 * from `.aifetchly/workspace.json`. Multiple path keys (clones, worktrees)
 * map to one scope through AIWorkspaceMemoryScopePathEntity.
 */
@Entity("ai_workspace_memory_scopes")
@Index("uq_ai_workspace_memory_scope_id", ["scopeId"], { unique: true })
@Index("uq_ai_workspace_memory_portable_id", ["portableWorkspaceId"], {
  unique: true,
})
export class AIWorkspaceMemoryScopeEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  /** Stable internal id, e.g. `wscope-legacy-<hash>` or `wscope-<uuid>`. */
  @Column("varchar", { length: 100 })
  scopeId!: string;

  /** Portable workspace UUID once `.aifetchly/workspace.json` is bound. */
  @Column("varchar", { length: 100, nullable: true })
  portableWorkspaceId?: string | null;

  @Column("varchar", { length: 255 })
  displayName!: string;

  /** Whether portable file storage is enabled for this scope. */
  @Column("boolean", { default: false })
  portableEnabled!: boolean;

  /** Default storage mode for new memories (PRD §14.1). */
  @Column("varchar", { length: 30, default: "private-only" })
  defaultStorageMode!: string;

  /** External-change review policy (PRD §16.4). */
  @Column("varchar", { length: 30, default: "review-new" })
  importPolicy!: string;

  /** Timestamp of the last complete scan (operational metadata). */
  @Column("datetime", { nullable: true })
  lastCompleteScanAt?: Date | null;
}
