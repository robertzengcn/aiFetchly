import { Entity, Column, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("task_result")
export class TaskResultEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;
    
    @Column("integer")
    taskrun_id: number;

    @Column("text",{ nullable: true })
    url: string;
    @Column("text",{ nullable: true })
    title: string;
    @Column("text",{ nullable: true })
    content: string;
    @Column("text",{ nullable: true })
    lang: string;
    
    // @Column("text", { nullable: true })
    // result_path: string;
    
    @Column("text", { nullable: true })
    record_time: string;
}