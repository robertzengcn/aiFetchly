import { Entity, Column, PrimaryGeneratedColumn, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type { AiTaskOperationState } from "@/entityTypes/aiTaskExecutionTypes";

/**
 * Consequential-action operation record (technical-design §6.1/§10).
 *
 * Slice 1 creates the table + basic scaffolding so the schema is stable and
 * the worker guard is enforced. Full receipt reconciliation is Slice 3
 * (FR-11; AC-09/10/13/28). The unique operation_key dedups retries; the
 * canonical intent_hash prevents a changed target from reusing an operation.
 * claim_generation CAS prevents stale dispatch.
 */
@Entity("ai_task_operation")
@Index(["operation_key"], { unique: true })
@Index(["execution_id"])
@Index(["intent_hash"])
@Index(["operation_state"])
export class AiTaskOperationEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  /** Stable operation key for dedup across retries. */
  @Column("varchar", { length: 160 })
  operation_key!: string;

  @Column("varchar", { length: 100 })
  execution_id!: string;

  /** Trusted tool/domain identity, e.g. `send_email`. */
  @Column("varchar", { length: 100 })
  tool_identity!: string;

  /** Approved domain target, e.g. `campaign:5`; null for non-targeted ops. */
  @Column("varchar", { length: 255, nullable: true })
  domain_target!: string | null;

  /** Canonical hash of the approved intent. */
  @Column("varchar", { length: 128 })
  intent_hash!: string;

  @Column("varchar", { length: 20, default: "pending" })
  operation_state!: AiTaskOperationState;

  /** CAS generation for dispatch/settlement (§10). */
  @Column("integer", { default: 0 })
  claim_generation!: number;

  /** Native send/job receipt reference (Slice 3). */
  @Column("varchar", { length: 255, nullable: true })
  receipt_reference!: string | null;

  /** Safe failure code (never raw error text). */
  @Column("varchar", { length: 64, nullable: true })
  failure_code!: string | null;

  @Column("datetime", { nullable: true })
  claimed_at!: Date | null;

  @Column("datetime", { nullable: true })
  dispatched_at!: Date | null;

  @Column("datetime", { nullable: true })
  settled_at!: Date | null;
}
