import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

/**
 * Persisted user-configured command hook.
 *
 * Only `source = "user"` rows are created through the UI. Built-in
 * callback hooks remain code-registered; their `enabled` state is
 * toggled via the USER_HOOKS_BUILTIN_OVERRIDES Token map, not this
 * table.
 *
 * Worker processes MUST NOT use this entity directly — they must
 * route through IPC to the main process (see Hook.model.ts guard).
 */
@Entity("hook_config")
@Index(["source"])
@Index(["eventName"])
@Index(["enabled", "trusted"])
export class HookConfigEntity {
  @PrimaryColumn({ type: "text" })
  id: string;

  @Column({ name: "event_name", type: "text" })
  eventName: string;

  @Column({ name: "matcher", type: "text", nullable: true })
  matcher: string | null;

  /** "command" for UI-created rows. "callback" reserved for future schema reuse. */
  @Column({ name: "hook_type", type: "text" })
  hookType: string;

  @Column({ type: "text" })
  command: string;

  @Column({ name: "cwd", type: "text", nullable: true })
  cwd: string | null;

  @Column({ name: "timeout_ms", type: "integer", default: 5000 })
  timeoutMs: number;

  /** "warn" | "block" */
  @Column({ name: "failure_mode", type: "text", default: "warn" })
  failureMode: string;

  @Column({ name: "status_message", type: "text", nullable: true })
  statusMessage: string | null;

  /** JSON-serialized string[] of env var names. */
  @Column({ name: "env_allowlist", type: "text", nullable: true })
  envAllowlist: string | null;

  /** Always "user" for rows created via UI. */
  @Column({ type: "text", default: "user" })
  source: string;

  @Column({ type: "boolean", default: false })
  enabled: boolean;

  @Column({ type: "boolean", default: false })
  trusted: boolean;

  @Column({ name: "last_run_at", type: "datetime", nullable: true })
  lastRunAt: Date | null;

  @Column({ name: "last_run_status", type: "text", nullable: true })
  lastRunStatus: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
