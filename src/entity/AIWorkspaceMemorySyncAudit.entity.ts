import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";

/**
 * Sanitized, content-free audit trail for portable memory operations
 * (design D-07 / §8.5 / PRD FR-060).
 *
 * Stores hashes and stable diagnostic codes — never memory titles, bodies,
 * or secrets. Retention: newest 5,000 events or 90 days per installation.
 */
@Entity("ai_workspace_memory_sync_audits")
@Index("uq_ai_workspace_memory_audit_event", ["eventId"], { unique: true })
@Index("idx_ai_workspace_memory_audit_scope", ["scopeId"])
@Index("idx_ai_workspace_memory_audit_memory", ["memoryId"])
@Index("idx_ai_workspace_memory_audit_created", ["createdAt"])
export class AIWorkspaceMemorySyncAuditEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  /** `pmem-event-<uuid>`. */
  @Column("varchar", { length: 100 })
  eventId!: string;

  @Column("varchar", { length: 100 })
  scopeId!: string;

  /** Absent when the file's memory id could not be trusted. */
  @Column("varchar", { length: 100, nullable: true })
  memoryId?: string | null;

  @Column("varchar", { length: 1024, nullable: true })
  relativePath?: string | null;

  @Column("varchar", { length: 40 })
  action!: string;

  @Column("varchar", { length: 30 })
  actor!: string;

  @Column("varchar", { length: 30 })
  outcome!: string;

  @Column("varchar", { length: 64, nullable: true })
  previousHash?: string | null;

  @Column("varchar", { length: 64, nullable: true })
  nextHash?: string | null;

  @Column("varchar", { length: 80, nullable: true })
  diagnosticCode?: string | null;

  @Column("varchar", { length: 1000, nullable: true })
  message?: string | null;
}
