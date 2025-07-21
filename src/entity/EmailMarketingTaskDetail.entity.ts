import { Entity, Column, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("emailmarketing_task_detail")
export class EmailMarketingTaskDetailEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;
    
    @Column("integer")
    task_id: number;
    
    @Column("integer")
    name: number;
    
    @Column("integer")
    value: number;
}