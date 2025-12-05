import { Entity, Column, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

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
}