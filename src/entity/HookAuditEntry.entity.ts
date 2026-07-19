import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from "typeorm";

/**
 * One row per hook fire. Written by HookAuditModule.recordEntry,
 * read by the System Settings audit panel via hooks:listAudit.
 *
 * Mirrors the HookAuditEntry interface in entityTypes/hookTypes.ts.
 * Free-text fields (reason) are already secret-redacted by
 * HookAuditService before reaching this layer.
 */
@Entity("hook_audit_entry")
@Index(["timestamp"])
@Index(["hookId", "timestamp"])
export class HookAuditEntryEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "hook_run_id", type: "text" })
  hookRunId: string;

  @Column({ name: "hook_id", type: "text" })
  hookId: string;

  @Column({ name: "event_name", type: "text" })
  eventName: string;

  @Column({ type: "text" })
  source: string;

  /** "callback" | "command" */
  @Column({ type: "text" })
  type: string;

  @Column({ name: "match_query", type: "text", nullable: true })
  matchQuery: string | null;

  /** "started" | "success" | "blocked" | "failed" | "timeout" */
  @Column({ type: "text" })
  status: string;

  @Column({ name: "duration_ms", type: "integer", nullable: true })
  durationMs: number | null;

  @Column({ type: "text", nullable: true })
  reason: string | null;

  @Column({ type: "datetime" })
  timestamp: Date;
}
