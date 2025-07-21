import { Entity, Column, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("search_keyword")
export class SearchKeywordEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;
    
    @Column("integer")
    task_id: number;
    
    @Column("text")
    keyword: string;
}