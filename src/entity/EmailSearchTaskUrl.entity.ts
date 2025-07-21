import { Entity, Column, PrimaryGeneratedColumn, JoinColumn, ManyToOne } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import { EmailSearchTaskEntity } from "./EmailSearchTask.entity";

@Entity("emailsearch_url")
export class EmailSearchTaskUrlEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;
    
    @Column("integer")
    task_id: number;
    
    @Column("text")
    url: string;
    
    @Column("text", { nullable: true })
    record_time: string;

    @ManyToOne(() => EmailSearchTaskEntity, task => task.urls)
    @JoinColumn({ name: "task_id" })
    emailSearchTask: EmailSearchTaskEntity;
}