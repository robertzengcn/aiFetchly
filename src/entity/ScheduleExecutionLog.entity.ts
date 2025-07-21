import { Entity, Column, PrimaryGeneratedColumn, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

export enum ExecutionStatus {
    PENDING = 'pending',
    RUNNING = 'running',
    SUCCESS = 'success',
    FAILED = 'failed',
    CANCELLED = 'cancelled',
    TIMEOUT = 'timeout'
}

export enum TriggerType {
    CRON = 'cron',
    DEPENDENCY = 'dependency',
    MANUAL = 'manual'
}

@Entity("schedule_execution_log")
@Index(["schedule_id"])
@Index(["parent_execution_id"])
@Index(["execution_time"])
@Index(["status"])
export class ScheduleExecutionLogEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column("integer", { comment: "Foreign key to ScheduleTaskEntity" })
    schedule_id: number;

    @Column("integer", { 
        nullable: true, 
        comment: "Foreign key to parent execution log (for dependency chains)" 
    })
    parent_execution_id: number | null;

    @Column("datetime", { comment: "When execution started" })
    execution_time: Date;

    @Column("varchar", {
        length: 20,
        comment: "Execution status: pending, running, success, failed, cancelled, timeout"
    })
    status: string;

    @Column("text", { nullable: true, comment: "Execution result or error message" })
    result_message: string | null;

    @Column("integer", { 
        nullable: true, 
        comment: "Execution duration in milliseconds" 
    })
    execution_duration: number | null;

    @Column("integer", { 
        nullable: true, 
        comment: "Reference to task output or result" 
    })
    task_output_id: number | null;

    @Column("varchar", {
        length: 20,
        default: TriggerType.CRON,
        comment: "What triggered this execution: cron, dependency, manual"
    })
    triggered_by: string;

    @Column("datetime", { nullable: true, comment: "When execution completed" })
    completion_time: Date | null;

    @Column("text", { nullable: true, comment: "Additional execution metadata" })
    metadata: string | null;
} 