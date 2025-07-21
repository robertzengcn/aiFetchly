import { Entity, Column, ManyToOne, JoinColumn,PrimaryGeneratedColumn } from "typeorm"
import AuditableEntity from "@/entity/Auditable.entity"
import { SearchTaskEntity } from "./SearchTask.entity";


@Entity("search_account")
export class SearchAccountEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column("integer")
    task_id: number;
    @Column("integer")
    account_id: number;

    @ManyToOne(() => SearchTaskEntity)
    @JoinColumn({ name: "id" })
    searchtask: SearchTaskEntity;

   
} 