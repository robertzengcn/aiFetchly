import { Entity, Column,PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("emailmarketing_send_log")
export class EmailMarketingSendLogEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
      id: number;
    @Column("integer")
    task_id: number;
    
    @Column("integer")
    status: number;
    
    @Column("text", { nullable: true })
    receiver: string;
    
    @Column("text", { nullable: true })
    title: string;
    
    @Column("text", { nullable: true })
    content: string;
    @Column("text", { nullable: true })
    log: string;
    
    @Column("text", { nullable: true })
    record_time: string;
}