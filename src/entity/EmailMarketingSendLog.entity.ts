import { Entity, Column,PrimaryGeneratedColumn, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("emailmarketing_send_log")
export class EmailMarketingSendLogEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
      id: number;
    @Column("integer")
    @Index()
    task_id: number;
    
    @Column("integer")
    @Index()
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