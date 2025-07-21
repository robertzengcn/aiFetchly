import AuditableEntity from "@/entity/Auditable.entity"
import { Entity, Column, PrimaryGeneratedColumn,ManyToOne } from "typeorm"
import {SystemSettingEntity} from "@/entity/SystemSetting.entity"

@Entity("system_setting_option")
export class SystemSettingOptionEntity extends AuditableEntity{
    @PrimaryGeneratedColumn()
    id: number;
    @Column('text')
    label: string;
    @Column('text')
    value: string;
    @Column('text')
    description: string;
    @ManyToOne(() => SystemSettingEntity, (systemSettingEntity) => systemSettingEntity.options)
    systemSetting: SystemSettingEntity;
}