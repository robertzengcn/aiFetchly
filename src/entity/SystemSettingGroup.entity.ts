import "reflect-metadata"
import { Entity, Column, PrimaryGeneratedColumn,OneToMany } from "typeorm"
import AuditableEntity from "@/entity/Auditable.entity"
import {SystemSettingEntity} from "@/entity/SystemSetting.entity"
@Entity("system_setting_group")
export class SystemSettingGroupEntity extends AuditableEntity{
    @PrimaryGeneratedColumn()
    id: number;
    @Column('text')
    name: string;
    @Column("text")
    description: string;
    @OneToMany(() => SystemSettingEntity, (systemSettingEntity) => systemSettingEntity.group)
    settings: SystemSettingEntity[];
}
