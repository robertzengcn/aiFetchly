import { Entity, Column, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("task_run")
export class TaskRunEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;
    
    @Column("integer")
    task_id: number;
    @Column("text", { nullable: true })
    taskrun_num: string;
    
    @Column("text", { nullable: true })
    log_path: string;
    
    @Column("text", { nullable: true })
    error_log: string;
    
    @Column("text", { nullable: true })
    record_time: string;
    
    @Column("integer", { nullable: true })
    status: number;
}