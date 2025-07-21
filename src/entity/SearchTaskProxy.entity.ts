import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from "typeorm"
import AuditableEntity from "@/entity/Auditable.entity"
import { SearchTaskEntity } from "./SearchTask.entity"

@Entity("search_task_proxy")
export class SearchTaskProxyEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column("integer")
    task_id: number;

    @Column("integer")
    proxy_id: number;

    @Column("text")
    host:string;
    @Column("text")
    port:string;
    @Column("text")
    user:string;
    @Column("text")
    pass:string;

    @ManyToOne(() => SearchTaskEntity)
    @JoinColumn({ name: "task_id" })
    task: SearchTaskEntity;
} 