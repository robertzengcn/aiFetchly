import { Entity, Column, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("search_task")
export class SearchTaskEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column("text", { nullable: true })
    enginer_id: string;
    
    @Column("text", { nullable: true })
    error_log: string;
    @Column("text", { nullable: true })
    runtime_log: string;    
    
    @Column("text", { nullable: true })
    record_time: string;
    
    @Column("integer", { nullable: true })
    status: number;
    @Column("integer", { nullable: true })
    num_pages: number; //how many pages to scrape
    @Column("integer", { nullable: true })
    concurrency: number; //how many concurrent requests
    @Column("integer", { nullable: true })
    notShowBrowser: number; //if true, the browser will not be shown
    @Column("integer", { nullable: true })
    useLocalbrowserdata:number
    @Column("text", { nullable: true })
    localBrowser:string
}