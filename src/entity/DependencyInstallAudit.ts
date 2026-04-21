import { Entity, Column, PrimaryGeneratedColumn, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

/**
 * Append-only audit log for system dependency installation actions.
 *
 * Records every diagnosis, user decision, installation attempt, and outcome
 * for compliance and debugging purposes.
 */
@Entity("dependency_install_audit")
@Index("idx_audit_conversation", ["conversation_id"])
@Index("idx_audit_dependency", ["dependency_id"])
export class DependencyInstallAuditEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("varchar", { length: 255 })
  conversation_id: string;

  @Column("varchar", { length: 255 })
  skill_name: string;

  @Column("varchar", { length: 255 })
  dependency_id: string;

  @Column("varchar", { length: 255 })
  missing_binary: string;

  @Column("boolean", { default: false })
  suggested_by_ai: boolean;

  /** "approved" or "denied" */
  @Column("varchar", { length: 50 })
  user_decision: string;

  /** Package manager used (e.g. "brew"). Null if denied or not attempted. */
  @Column("varchar", { length: 100, nullable: true })
  installer_backend: string | null;

  /** Package name installed (e.g. "poppler"). Null if denied or not attempted. */
  @Column("varchar", { length: 255, nullable: true })
  package_name: string | null;

  /** InstallResultStatus value. Null if denied before execution. */
  @Column("varchar", { length: 50, nullable: true })
  execution_status: string | null;

  @Column("integer", { nullable: true })
  execution_duration_ms: number | null;

  /** Sanitized stderr from failed installs. */
  @Column("text", { nullable: true })
  stderr_sanitized: string | null;
}
