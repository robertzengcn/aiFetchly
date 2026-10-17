import { Entity, Column, PrimaryGeneratedColumn, Index } from "typeorm";
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

  /** Absolute directory the scheduled run may use as its approved workspace. */
  @Column("varchar", { length: 1024, nullable: true })
  workspace_path: string | null;

  @Column("text", { default: "[]" })
  allowed_tools_json: string;

  @Column("boolean", { default: false })
  auto_approve_tools: boolean;

  @Column("boolean", { default: false })
  allow_skills: boolean;

  @Column("boolean", { default: false })
  allow_mcp: boolean;

  @Column("boolean", { default: false })
  allow_subagents: boolean;

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

  /** Origin of this task. `chat_scheduled_loop` tasks are bound to a v2-*
   * conversation and route through AIChatQueryEngine; null means legacy
   * standalone schedule-page behavior (technical-design §9.3). */
  @Column("varchar", { length: 32, nullable: true })
  source_type?: "schedule_ui" | "chat_scheduled_loop";

  // ----- Task-completion-policy V1 additive columns (technical-design §6.1) -----
  // All nullable/default-0 so existing rows remain valid under synchronize.
  // Slice 1 writes are feature-flagged (ai_task_completion_policy_v1_enabled);
  // when the flag is OFF, behavior is byte-identical to legacy.

  /** Frozen TaskCompletionContract JSON (§5.1). Null = legacy task (no contract). */
  @Column("text", { nullable: true })
  completion_contract_json: string | null;

  /** Frozen execution-policy snapshot JSON. Null = legacy task. */
  @Column("text", { nullable: true })
  execution_policy_json: string | null;

  /** Schema version for the policy snapshot. 0 = legacy (no policy). */
  @Column("integer", { default: 0 })
  execution_policy_version: number;
}
