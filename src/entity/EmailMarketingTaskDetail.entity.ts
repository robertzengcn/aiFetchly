import { Entity, Column, PrimaryGeneratedColumn, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("emailmarketing_task_detail")
export class EmailMarketingTaskDetailEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id!: number;
    
    @Column("integer")
    @Index()
    task_id!: number;
    
    @Column("integer")
    name!: number;
    
    @Column("integer")
    value!: number;
}