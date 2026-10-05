import { Entity, Column, PrimaryGeneratedColumn, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type {
  AiTaskExecutionStatus,
  TaskExecutionOrigin,
  TaskExecutionRoute,
  TaskOutcome,
} from "@/entityTypes/aiTaskExecutionTypes";

/**
 * Generic AI task execution row (technical-design §6.1).
 *
 * One row per accepted manual/scheduled submission that enrolls in the
 * completion-policy path. Holds the CAS version, contract/policy snapshots,
 * outcome/reason/summary, and the final-event identity
 * `execution-result:<executionId>`. The linked ledger (not this row) is the
 * authoritative budget authority.
 */
@Entity("ai_task_execution")
@Index(["execution_id"], { unique: true })
@Index(["conversation_id"])
// AC-26 / §4A.1: scoped submission uniqueness. A transport retry reuses the
// same (conversation_id, submission_id); a partial unique index enforces this
// only when submission_id IS NOT NULL. SQLite treats NULLs as distinct in a
// unique index, so scheduled-origin rows (submission_id = null) coexist — the
// dedup key is the occurrence_key lineage, not the submission_id. The `where`
// predicate must use quoted identifiers so TypeORM synchronize emits it as raw
// SQL on the partial index without re-quoting.
@Index("idx_execution_submission_unique", ["conversation_id", "submission_id"], {
  unique: true,
  where: '"submission_id" IS NOT NULL',
})
@Index(["submission_id"])
@Index(["schedule_id"])
@Index(["ledger_id"])
@Index(["lineage_ledger_id"])
@Index(["parent_execution_id"])
@Index(["finalized"])
export class AiTaskExecutionEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** Opaque execution identity, e.g. `exec-<uuid>`. Stable across retries. */
  @Column("varchar", { length: 100 })
  execution_id: string;

  @Column("varchar", { length: 255, nullable: true })
  conversation_id: string;

  @Column("varchar", { length: 100, nullable: true })
  source_user_message_id: string;

  /** Stable renderer-generated submission ID for transport retry dedup. */
  @Column("varchar", { length: 100, nullable: true })
  submission_id: string | null;

  @Column("varchar", { length: 100, nullable: true })
  assistant_result_message_id: string | null;

  /** Canonical hash of the validated request payload (§6.1 submission dedup). */
  @Column("varchar", { length: 128, nullable: true })
  request_hash: string;

  /** Discriminator for TaskExecutionOrigin: "manual" | "scheduled". */
  @Column("varchar", { length: 20 })
  origin_type: TaskExecutionOrigin["type"];

  @Column("varchar", { length: 32 })
  route: TaskExecutionRoute;

  /** "standalone" (explicit controller) | "goal" (goal-owned adapter). */
  @Column("varchar", { length: 32 })
  completion_owner: "standalone" | "goal";

  /** Generic execution checkpoint state (§6.1). */
  @Column("varchar", { length: 32, default: "resolving" })
  stage: AiTaskExecutionStatus;

  @Column("integer", { nullable: true })
  schedule_id: number | null;

  @Column("integer", { nullable: true })
  run_id: number | null;

  /** Stable occurrence key for scheduled origin (§9.4). */
  @Column("varchar", { length: 160, nullable: true })
  occurrence_key: string | null;

  /** Active budget/checkpoint ledger for this execution. */
  @Column("varchar", { length: 100 })
  ledger_id: string;

  /** Shared lineage ledger for Continue successors (§6.2). */
  @Column("varchar", { length: 100 })
  lineage_ledger_id: string;

  /** Parent execution ID for a Continue/Retry successor; null for the first. */
  @Column("varchar", { length: 100, nullable: true })
  parent_execution_id: string | null;

  /** Frozen contract snapshot JSON (TaskCompletionContract). */
  @Column("text", { nullable: true })
  contract_snapshot_json: string | null;

  /** Frozen execution-policy snapshot JSON. */
  @Column("text", { nullable: true })
  policy_snapshot_json: string | null;

  /** Runtime checkpoint state (§6.1) — bounded JSON, merged at finalization. */
  @Column("text", { nullable: true })
  execution_state_json: string | null;

  /** Stable hash over the canonicalized contract (FR-19). */
  @Column("varchar", { length: 128, nullable: true })
  contract_hash: string | null;

  /** CAS version — model updates only when this matches the loaded value. */
  @Column("integer", { default: 0 })
  execution_state_version: number;

  @Column("boolean", { default: false })
  finalized: boolean;

  @Column("datetime", { nullable: true })
  finalized_at: Date | null;

  @Column("varchar", { length: 32, nullable: true })
  task_outcome: TaskOutcome | null;

  @Column("varchar", { length: 64, nullable: true })
  outcome_reason_code: string | null;

  @Column("text", { nullable: true })
  outcome_summary: string | null;

  /** `execution-result:<executionId>` — dedup identity for terminal event. */
  @Column("varchar", { length: 160, nullable: true })
  final_event_identity: string | null;

  @Column("varchar", { length: 32, nullable: true })
  delivery_state: string | null;
}
