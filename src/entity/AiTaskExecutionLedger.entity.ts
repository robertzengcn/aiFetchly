import { Entity, Column, PrimaryGeneratedColumn, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type { AiTaskExecutionLedgerStatus } from "@/entityTypes/aiTaskExecutionTypes";

/**
 * Budget/checkpoint ledger for a task execution lineage (technical-design
 * §6.1/§6.2).
 *
 * Continue successors SHARE this ledger row (its spent allowance persists);
 * an explicit new attempt gets a new ledger. The active execution ID + fenced
 * owner generation identify who may reserve against it. CAS version guards
 * concurrent reservation/finalization.
 */
@Entity("ai_task_execution_ledger")
@Index(["ledger_id"], { unique: true })
@Index(["active_execution_id"])
@Index(["status"])
export class AiTaskExecutionLedgerEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** Opaque ledger identity, e.g. `ledger-<uuid>`. */
  @Column("varchar", { length: 100 })
  ledger_id: string;

  /** Immutable frozen policy limits JSON (BudgetLimits). */
  @Column("text", { default: "{}" })
  policy_limits_json: string;

  /** CAS version — reservation/finalization must match the loaded value. */
  @Column("integer", { default: 0 })
  execution_state_version: number;

  @Column("integer", { default: 0 })
  consumed_continuations: number;

  @Column("integer", { default: 0 })
  consumed_provider_attempts: number;

  @Column("integer", { default: 0 })
  consumed_tool_executions: number;

  @Column("integer", { default: 0 })
  consumed_checker_attempts: number;

  @Column("integer", { default: 0 })
  consumed_tokens: number;

  @Column("integer", { default: 0 })
  consumed_active_ms: number;

  @Column("integer", { default: 0 })
  consumed_wait_ms: number;

  @Column("integer", { default: 0 })
  no_progress_streak: number;

  /** Currently-active execution ID that may reserve against this ledger. */
  @Column("varchar", { length: 100, nullable: true })
  active_execution_id: string | null;

  /** Fenced owner generation — prevents stale ancestor reservations. */
  @Column("integer", { default: 0 })
  owner_generation: number;

  @Column("varchar", { length: 20, default: "active" })
  status: AiTaskExecutionLedgerStatus;
}
