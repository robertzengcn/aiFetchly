import { Entity, Column, PrimaryGeneratedColumn, OneToOne } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import { ContactInfoEntity } from "./ContactInfo.entity";

@Entity("search_result")
export class SearchResultEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;
    
    @Column("integer", { default: 0 })
    task_id: number;

    @Column("integer", { default: 0 })
    keyword_id: number;

    @Column("text", { nullable: true })
    title: string;
    
    @Column("text", { nullable: true })
    link: string;
    
    @Column("text", { nullable: true })
    snippet: string;
    
    @Column("text", { nullable: true })
    domain: string;
    
    @Column("text", { nullable: true })
    record_time: string;
    
    @Column("text", { nullable: true })
    ai_industry: string;
    
    @Column("integer", { nullable: true })
    ai_match_score: number;
    
    @Column("text", { nullable: true })
    ai_reasoning: string;
    
    @Column("text", { nullable: true })
    ai_client_business: string;
    
    @Column("text", { nullable: true })
    ai_analysis_time: string;
    
    @Column("text", { nullable: true, default: null })
    ai_analysis_status: string; // 'pending', 'analyzing', 'completed', 'failed'

    @OneToOne(() => ContactInfoEntity, contactInfo => contactInfo.searchResult, {
        nullable: true,
        eager: false, // Load on demand to avoid unnecessary queries
        cascade: false // Don't cascade operations (handled manually)
    })
    contactInfo: ContactInfoEntity | null;
}