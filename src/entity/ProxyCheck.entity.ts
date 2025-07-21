import { Entity, Column, PrimaryColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("proxy_check")
export class ProxyCheckEntity extends AuditableEntity {

    @PrimaryColumn("integer")
    proxy_id: number;
    
    @Column("text", { nullable: true })
    check_time: string;
    
    @Column("integer", { nullable: true })
    status: number;
}