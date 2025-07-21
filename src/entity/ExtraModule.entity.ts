import { Entity, Column, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("extra_modules")
export class ExtraModuleEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;
    
    @Column("text", { unique: true })
    name: string;
    
    @Column("text")
    version: string;
    
    @Column("text", { nullable: true })
    record_time: string;
}