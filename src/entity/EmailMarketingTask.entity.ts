import { Entity, Column,PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("emailmarketing_task")
export class EmailMarketingTaskEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
     id: number;
    @Column("text", { nullable: true })
    task_name: string;
    
    @Column("text", { nullable: true })
    task_desc: string;
    
    @Column("text", { nullable: true })
    record_time: string;
    
    @Column("integer", { nullable: true })
    status: number;
}