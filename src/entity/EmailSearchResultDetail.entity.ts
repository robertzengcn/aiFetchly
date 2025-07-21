import { Entity, Column, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("emailsearch_result_detail")
export class EmailSearchResultDetailEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;
    
    @Column("integer")
    result_id: number;
    
    @Column("text",{ nullable: true })
    email: string;
    
    @Column("text", { nullable: true })
    company: string;
    
    @Column("text", { nullable: true })
    title: string;
    
    @Column("text", { nullable: true })
    linkedin: string;
    
    @Column("text", { nullable: true })
    location: string;
    
    @Column("text", { nullable: true })
    record_time: string;
}