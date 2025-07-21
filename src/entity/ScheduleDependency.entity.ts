import { Entity, Column, PrimaryGeneratedColumn, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

export enum DependencyCondition {
    ON_SUCCESS = 'on_success',
    ON_COMPLETION = 'on_completion',
    ON_FAILURE = 'on_failure'
}

@Entity("schedule_dependency")
@Index(["parent_schedule_id"])
@Index(["child_schedule_id"])
@Index(["parent_schedule_id", "child_schedule_id"], { unique: true })
export class ScheduleDependencyEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column("integer", { comment: "Foreign key to parent ScheduleTaskEntity" })
    parent_schedule_id: number;

    @Column("integer", { comment: "Foreign key to child ScheduleTaskEntity" })
    child_schedule_id: number;

    @Column("varchar", {
        length: 20,
        default: DependencyCondition.ON_SUCCESS,
        comment: "When to trigger the child job: on_success, on_completion, on_failure"
    })
    dependency_condition: string;

    @Column("integer", { 
        default: 0, 
        comment: "Delay in minutes after parent job completes" 
    })
    delay_minutes: number;

    @Column("boolean", { default: true, comment: "Whether the dependency is active" })
    is_active: boolean;

    @Column("text", { nullable: true, comment: "Additional notes about the dependency" })
    notes: string | null;
} 