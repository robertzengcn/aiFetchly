import { Entity, Column, PrimaryGeneratedColumn,ManyToOne,OneToMany,Index } from "typeorm"
import AuditableEntity from "@/entity/Auditable.entity"
import {SystemSettingGroupEntity} from "@/entity/SystemSettingGroup.entity"
import {SystemSettingOptionEntity} from "@/entity/SystemSettingOption.entity"
@Entity("system_setting")
export class SystemSettingEntity extends AuditableEntity{
    @PrimaryGeneratedColumn()
    id: number;
    @Index({ unique: true })
    @Column('text')
    key: string;
    @Column("text")
    value: string;
    @Column("text")
    description: string;
    @Column("text")
    type: string;
    @ManyToOne(() => SystemSettingGroupEntity, (systemSettingGroupEntity) => systemSettingGroupEntity.settings)
    group: SystemSettingGroupEntity;
    @OneToMany(() => SystemSettingOptionEntity, (systemSettingOptionEntity) => systemSettingOptionEntity.systemSetting)
    options:SystemSettingOptionEntity[];

}