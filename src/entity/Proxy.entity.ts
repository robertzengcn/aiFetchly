import { Entity, Column, PrimaryGeneratedColumn, OneToMany } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import { EmailSearchTaskProxyEntity } from "@/entity/EmailSearchTaskProxy.entity";

@Entity("proxy")
export class ProxyEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;
    
    @Column("text", { nullable: false })
    host: string;
    
    @Column("text", { nullable: false })
    port: string;
    
    @Column("text", { nullable: true })
    user?: string;
    
    @Column("text", { nullable: true })
    pass?: string;
    
    @Column("text", { nullable: true })
    protocol?: string;
    
    @Column("text", { nullable: true })
    country_code?: string;
    
    @Column("text", { nullable: true })
    addtime?: string;
    
    @OneToMany(() => EmailSearchTaskProxyEntity, taskProxy => taskProxy.proxy)
    taskProxies: EmailSearchTaskProxyEntity[];
} 