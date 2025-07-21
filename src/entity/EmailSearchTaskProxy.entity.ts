import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import { EmailSearchTaskEntity } from "@/entity/EmailSearchTask.entity";
import { ProxyEntity } from "@/entity/Proxy.entity";

@Entity("emailsearch_task_proxy")
export class EmailSearchTaskProxyEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;
    
    @Column("integer", { nullable: false })
    email_search_task_id: number;
    
    @Column("integer", { nullable: false })
    proxy_id: number;
    
    @Column("boolean", { default: true })
    is_active: boolean;
    
    @Column("text", { nullable: true })
    notes?: string;
    
    @ManyToOne(() => EmailSearchTaskEntity, emailSearchTask => emailSearchTask.id)
    @JoinColumn({ name: "email_search_task_id" })
    emailSearchTask: EmailSearchTaskEntity;
    
    @ManyToOne(() => ProxyEntity, proxy => proxy.id)
    @JoinColumn({ name: "proxy_id" })
    proxy: ProxyEntity;
} 