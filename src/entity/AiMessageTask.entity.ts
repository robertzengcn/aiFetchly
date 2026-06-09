import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  Index,
} from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type { AiMessageTaskStatus } from "@/entityTypes/aiMessageTaskTypes";

@Entity("ai_message_task")
@Index(["status"])
export class AiMessageTaskEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("varchar", { length: 255 })
  name: string;

  @Column("text", { nullable: true })
  description: string;

  @Column("text")
  message: string;

  @Column("text", { nullable: true })
  system_prompt: string;

  @Column("varchar", { length: 100, nullable: true })
  model: string;

  @Column("varchar", { length: 255, nullable: true })
  conversation_id: string;

  @Column("text", { default: "[]" })
  allowed_tools_json: string;

  @Column("boolean", { default: false })
  auto_approve_tools: boolean;

  @Column("integer", { default: 10 })
  max_tool_calls: number;

  @Column("integer", { default: 300000 })
  max_runtime_ms: number;

  @Column("integer", { default: 10 })
  max_continue_calls: number;

  @Column("varchar", {
    length: 20,
    default: "active",
    comment: "Task status: active, inactive, deleted",
  })
  status: AiMessageTaskStatus;

  @Column("datetime", { nullable: true })
  last_run_time: Date;

  @Column("text", { nullable: true })
  last_result_summary: string;

  @Column("text", { nullable: true })
  last_error_message: string;
}
