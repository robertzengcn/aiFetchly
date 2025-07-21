import { Entity, Column, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("scheduler_status")
export class SchedulerStatusEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;
    
    @Column("boolean", { default: false })
    is_running: boolean;
    
    @Column("integer", { default: 0 })
    active_schedules: number;
    
    @Column("integer", { default: 0 })
    total_schedules: number;
    
    @Column("datetime", { nullable: true })
    last_check_time: Date;
    
    @Column("datetime", { nullable: true })
    next_check_time: Date;
    
    @Column("text", { nullable: true })
    last_error_message: string;
    
    @Column("datetime", { nullable: true })
    last_start_time: Date;
    
    @Column("datetime", { nullable: true })
    last_stop_time: Date;
} 