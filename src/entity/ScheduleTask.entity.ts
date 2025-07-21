import { Entity, Column, PrimaryGeneratedColumn, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

export enum TaskType {
    SEARCH = 'search',
    EMAIL_EXTRACT = 'email_extract',
    BUCK_EMAIL = 'buck_email',
    VIDEO_DOWNLOAD = 'video_download',
   // SOCIAL_TASK = 'social_task'
}

export enum ScheduleStatus {
    ACTIVE = 'active',
    INACTIVE = 'inactive',
    PAUSED = 'paused'
}

export enum TriggerType {
    CRON = 'cron',
    DEPENDENCY = 'dependency',
    MANUAL = 'manual'
}

export enum DependencyCondition {
    ON_SUCCESS = 'on_success',
    ON_COMPLETION = 'on_completion',
    ON_FAILURE = 'on_failure'
}

@Entity("schedule_task")
@Index(["task_type", "task_id"])
@Index(["is_active", "next_run_time"])
@Index(["trigger_type", "parent_schedule_id"])
export class ScheduleTaskEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column("varchar", { length: 255 })
    name: string;

    @Column("text", { nullable: true })
    description: string;

    @Column("varchar", { 
        length: 50, 
        comment: "Type of task to be executed: search, email_marketing, buck_email, video_download" 
    })
    task_type: string;

    @Column("integer", { comment: "Foreign key to the actual task table" })
    task_id: number;

    @Column("varchar", { length: 100, comment: "Cron expression for scheduling" })
    cron_expression: string;

    @Column("boolean", { default: true, comment: "Whether the schedule is active" })
    is_active: boolean;

    @Column("datetime", { nullable: true, comment: "Last time the task was executed" })
    last_run_time: Date;

    @Column("datetime", { nullable: true, comment: "Next scheduled execution time" })
    next_run_time: Date;

    @Column("varchar", { 
        length: 20, 
        default: ScheduleStatus.ACTIVE,
        comment: "Current status of the schedule: active, inactive, paused" 
    })
    status: string;

    @Column("varchar", {
        length: 20,
        default: TriggerType.CRON,
        comment: "How the job is triggered: cron, dependency, manual"
    })
    trigger_type: string;

    @Column("integer", { 
        nullable: true, 
        comment: "Foreign key to parent schedule (for dependency triggers)" 
    })
    parent_schedule_id: number | null;

    @Column("varchar", {
        length: 20,
        nullable: true,
        comment: "Dependency condition: on_success, on_completion, on_failure"
    })
    dependency_condition: string | null;

    @Column("integer", { 
        default: 0, 
        comment: "Delay in minutes after parent job completes" 
    })
    delay_minutes: number;

    @Column("integer", { default: 0, comment: "Number of times the task has been executed" })
    execution_count: number;

    @Column("integer", { default: 0, comment: "Number of failed executions" })
    failure_count: number;

    @Column("text", { nullable: true, comment: "Last error message if any" })
    last_error_message: string;

    @Column("datetime", { nullable: true, comment: "When the schedule was last modified" })
    last_modified: Date;
} 