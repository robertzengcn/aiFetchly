import { Entity, Column, PrimaryGeneratedColumn, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

export enum TaskType {
  SEARCH = "search",
  EMAIL_EXTRACT = "email_extract",
  BUCK_EMAIL = "buck_email",
  YELLOW_PAGES = "yellow_pages",
  GOOGLE_MAPS = "google_maps",
  YANDEX_MAPS = "yandex_maps",
  AI_MESSAGE = "ai_message",
}

export enum ScheduleStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
  PAUSED = "paused",
  // Durable terminal states for scheduled loops (technical-design §9.1).
  // Terminal statuses always set is_active = false.
  EXPIRED = "expired",
  FAILED = "failed",
  STOPPED = "stopped",
}

export enum TriggerType {
  CRON = "cron",
  DEPENDENCY = "dependency",
  MANUAL = "manual",
  // Fixed elapsed-interval trigger for AI Chat V2 scheduled loops.
  INTERVAL = "interval",
}

export enum DependencyCondition {
  ON_SUCCESS = "on_success",
  ON_COMPLETION = "on_completion",
  ON_FAILURE = "on_failure",
}

@Entity("schedule_task")
@Index(["task_type", "task_id"])
@Index(["is_active", "next_run_time"])
@Index(["trigger_type", "parent_schedule_id"])
// Scheduled-loop claim + ownership indexes (technical-design §9.2).
@Index(["trigger_type", "is_active", "next_run_time"])
@Index(["source_conversation_id", "task_type", "is_active"])
export class ScheduleTaskEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("varchar", { length: 255 })
  name: string;

  @Column("text", { nullable: true })
  description: string;

  @Column("varchar", {
    length: 50,
    comment:
      "Type of task to be executed: search, email_extract, buck_email, yellow_pages, google_maps, yandex_maps, ai_message",
  })
  task_type: string;

  @Column("integer", { comment: "Foreign key to the actual task table" })
  task_id: number;

  @Column("varchar", {
    length: 100,
    nullable: true,
    comment:
      "Cron expression for scheduling; nullable for interval/manual triggers",
  })
  cron_expression: string;

  @Column("boolean", {
    default: true,
    comment: "Whether the schedule is active",
  })
  is_active: boolean;

  @Column("datetime", {
    nullable: true,
    comment: "Last time the task was executed",
  })
  last_run_time: Date;

  @Column("datetime", {
    nullable: true,
    comment: "Next scheduled execution time",
  })
  next_run_time: Date;

  @Column("varchar", {
    length: 20,
    default: ScheduleStatus.ACTIVE,
    comment: "Current status of the schedule: active, inactive, paused",
  })
  status: string;

  @Column("varchar", {
    length: 20,
    default: TriggerType.CRON,
    comment: "How the job is triggered: cron, dependency, manual",
  })
  trigger_type: string;

  @Column("integer", {
    nullable: true,
    comment: "Foreign key to parent schedule (for dependency triggers)",
  })
  parent_schedule_id: number | null;

  @Column("varchar", {
    length: 20,
    nullable: true,
    comment: "Dependency condition: on_success, on_completion, on_failure",
  })
  dependency_condition: string | null;

  @Column("integer", {
    default: 0,
    comment: "Delay in minutes after parent job completes",
  })
  delay_minutes: number;

  @Column("integer", {
    default: 0,
    comment: "Number of times the task has been executed",
  })
  execution_count: number;

  @Column("integer", { default: 0, comment: "Number of failed executions" })
  failure_count: number;

  @Column("text", { nullable: true, comment: "Last error message if any" })
  last_error_message: string;

  @Column("datetime", {
    nullable: true,
    comment: "When the schedule was last modified",
  })
  last_modified: Date;

  // ----- AI Chat V2 scheduled-loop fields (technical-design §9.2) -----
  // All nullable/defaulted so existing cron/dependency/manual rows remain valid.

  @Column("integer", { nullable: true, comment: "Fixed elapsed cadence in ms" })
  interval_ms: number | null;

  @Column("datetime", {
    nullable: true,
    comment:
      "Stable cadence origin (anchor); first run is due at anchor + interval",
  })
  interval_anchor_at: Date | null;

  @Column("integer", {
    nullable: true,
    comment: "Maximum claimed occurrences for this schedule",
  })
  max_execution_count: number | null;

  @Column("datetime", {
    nullable: true,
    comment: "Absolute schedule lifetime bound",
  })
  expires_at: Date | null;

  @Column("varchar", {
    length: 20,
    nullable: true,
    comment: "Misfire policy: skip or run_once",
  })
  misfire_policy: string | null;

  @Column("varchar", {
    length: 20,
    nullable: true,
    comment: "Overlap policy: coalesce",
  })
  overlap_policy: string | null;

  @Column("varchar", {
    length: 100,
    nullable: true,
    comment: "Originating v2-* conversation for chat-created scheduled loops",
  })
  source_conversation_id: string | null;

  @Column("integer", {
    default: 0,
    comment: "Claimed occurrences including failures",
  })
  claimed_execution_count: number;

  @Column("integer", {
    default: 0,
    comment: "Consecutive failures; automatic pause/fail threshold",
  })
  consecutive_failure_count: number;

  @Column("integer", {
    default: 0,
    comment: "Monotonic last-claimed occurrence number",
  })
  last_claimed_occurrence: number;

  @Column("integer", {
    default: 0,
    comment: "Missed/overlapped occurrence diagnostic count",
  })
  coalesced_occurrence_count: number;

  @Column("varchar", {
    length: 64,
    nullable: true,
    comment: "Stable stop/expiry/failure reason code",
  })
  terminal_reason: string | null;
}
