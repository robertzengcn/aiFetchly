import { Entity, Column, PrimaryGeneratedColumn, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

/**
 * Append-only audit log for shell command executions.
 *
 * Records every shell execution with redacted command text, metadata,
 * and outcome for compliance and debugging purposes.
 */
@Entity("shell_audit")
@Index("idx_shell_audit_conversation", ["conversation_id"])
@Index("idx_shell_audit_tool_call", ["tool_call_id"])
@Index("idx_shell_audit_created_at", ["createdAt"])
export class ShellAuditEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("varchar", { length: 255 })
  conversation_id: string;

  @Column("varchar", { length: 255 })
  tool_call_id: string;

  /** Command text with sensitive tokens redacted. */
  @Column("text")
  command_redacted: string;

  @Column("varchar", { length: 512 })
  cwd: string;

  @Column("varchar", { length: 50 })
  shell: string;

  @Column("boolean", { default: false })
  success: boolean;

  @Column("integer", { nullable: true })
  exit_code: number | null;

  @Column("boolean", { default: false })
  timed_out: boolean;

  @Column("integer")
  duration_ms: number;
}
