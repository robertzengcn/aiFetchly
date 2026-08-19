import { Entity, Column, PrimaryGeneratedColumn, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("search_keyword")
export class SearchKeywordEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id!: number;
    
    @Column("integer")
    @Index()
    task_id!: number;
    
    @Column("text")
    keyword!: string;
}