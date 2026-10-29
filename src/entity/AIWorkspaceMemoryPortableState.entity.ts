import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";

/**
 * One-to-one portable storage state for a memory row (design D-03 / §8.4).
 *
 * The core memory row keeps title/content/type/status/confidence and local
 * operational fields; this table tracks file metadata, portable frontmatter
 * values, content hashes, and the synchronization state machine. Only
 * records that have been promoted to portable storage have a row here.
 */
@Entity("ai_workspace_memory_portable_states")
@Index("uq_ai_workspace_portable_state_record", ["scopeId", "memoryId"], {
  unique: true,
})
@Index("idx_ai_workspace_portable_state_sync", ["scopeId", "syncState"])
@Index("uq_ai_workspace_portable_state_path", ["scopeId", "relativePath"], {
  unique: true,
})
export class AIWorkspaceMemoryPortableStateEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column("varchar", { length: 100 })
  scopeId!: string;

  @Column("varchar", { length: 100 })
  memoryId!: string;

  /** POSIX-style path relative to the workspace root. */
  @Column("varchar", { length: 1024 })
  relativePath!: string;

  @Column("varchar", { length: 20 })
  visibility!: string;

  @Column("varchar", { length: 30 })
  createdBy!: string;

  @Column("datetime")
  portableCreatedAt!: Date;

  @Column("datetime")
  portableUpdatedAt!: Date;

  @Column("simple-json", { nullable: true })
  supersedes?: string[] | null;

  @Column("simple-json", { nullable: true })
  tags?: string[] | null;

  @Column("datetime", { nullable: true })
  reviewedAt?: Date | null;

  @Column("varchar", { length: 100, nullable: true })
  reviewedBy?: string | null;

  /** Hash of the last VALID imported/written file content. */
  @Column("varchar", { length: 64, nullable: true })
  lastValidHash?: string | null;

  /** Hash of the most recently observed file bytes (may be invalid). */
  @Column("varchar", { length: 64, nullable: true })
  observedHash?: string | null;

  @Column("varchar", { length: 30 })
  syncState!: string;

  @Column("varchar", { length: 80, nullable: true })
  diagnosticCode?: string | null;

  @Column("varchar", { length: 1000, nullable: true })
  diagnosticMessage?: string | null;

  @Column("datetime", { nullable: true })
  lastImportedAt?: Date | null;

  @Column("varchar", { length: 100, nullable: true })
  lastScanId?: string | null;
}
