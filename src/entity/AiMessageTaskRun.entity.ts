import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  Index,
} from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type { AiMessageTaskRunStatus } from "@/entityTypes/aiMessageTaskTypes";

@Entity("ai_message_task_run")
@Index(["task_id"])
@Index(["schedule_id"])
@Index(["status"])
@Index(["started_at"])
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
    comment: "Run status: pending, running, completed, failed, cancelled, blocked_by_policy, timeout",
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
}
