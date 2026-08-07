import { Entity, Column, PrimaryGeneratedColumn, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type { AiMessageTaskRunStatus } from "@/entityTypes/aiMessageTaskTypes";

@Entity("ai_message_task_run")
@Index(["task_id"])
@Index(["schedule_id"])
@Index(["status"])
@Index(["started_at"])
// Scheduled-loop occurrence identity + retry idempotency (technical-design §9.4).
// SQLite permits multiple NULLs, so standalone task runs without a schedule or
// occurrence remain valid under this unique composite index.
@Index(["schedule_id", "occurrence"], { unique: true })
export class AiMessageTaskRunEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("integer")
  task_id: number;

  @Column("integer", { nullable: true })
  schedule_id: number;

  @Column("varchar", { length: 255, nullable: true })
  conversation_id: string;

  @Column("varchar", {
    length: 20,
    default: "pending",
    comment:
      "Run status: pending, running, completed, failed, cancelled, blocked_by_policy, timeout",
  })
  status: AiMessageTaskRunStatus;

  @Column("datetime", { nullable: true })
  started_at: Date;

  @Column("datetime", { nullable: true })
  finished_at: Date;

  @Column("integer", { nullable: true })
  duration_ms: number;

  @Column("integer", { default: 0 })
  tool_calls_count: number;

  @Column("text", { nullable: true })
  blocked_tool_calls_json: string;

  @Column("text", { nullable: true })
  assistant_final_message: string;

  @Column("text", { nullable: true })
  error_message: string;

  @Column("text", { nullable: true })
  metadata_json: string;

  // ----- Scheduled-loop occurrence fields (technical-design §9.4) -----

  @Column("integer", {
    nullable: true,
    comment: "Stable schedule occurrence number",
  })
  occurrence: number | null;

  @Column("integer", {
    default: 1,
    comment: "Retry attempt number within one occurrence",
  })
  attempt: number;

  @Column("datetime", {
    nullable: true,
    comment: "Original scheduled slot time",
  })
  scheduled_for: Date | null;

  @Column("boolean", {
    default: false,
    comment: "Run created by misfire recovery",
  })
  catch_up: boolean;

  @Column("varchar", { length: 100, nullable: true })
  user_message_id: string | null;

  @Column("varchar", { length: 100, nullable: true })
  assistant_message_id: string | null;

  @Column("varchar", {
    length: 32,
    nullable: true,
    comment: "persisted | notified | notification_failed",
  })
  delivery_state: string | null;

  @Column("varchar", {
    length: 64,
    nullable: true,
    comment: "Stable machine-readable failure code",
  })
  error_code: string | null;

  @Index({ unique: true })
  @Column("varchar", {
    length: 160,
    nullable: true,
    comment:
      "scheduled-loop:<scheduleId>:<occurrence> retry/restart dedupe key",
  })
  idempotency_key: string | null;
}
