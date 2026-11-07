import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm"
import {SystemSettingOptionEntity} from "@/entity/SystemSettingOption.entity"
import {SystemSettingEntity} from "@/entity/SystemSetting.entity"
import { SUPPORTED_LANGUAGES } from "@/config/languages"

export class SystemSettingOptionModel extends BaseDb {
private repository: Repository<SystemSettingOptionEntity>
constructor(filepath: string) {
    super(filepath)
    this.repository = this.sqliteDb.connection.getRepository(SystemSettingOptionEntity)
}

/**
 * Retrieves all setting options associated with a specific system setting.
 *
 * @param settingEntity - The system setting entity to find options for
 * @returns A promise that resolves to an array of SystemSettingOptionEntity objects
 * 
 * @example
 * const settingEntity = await systemSettingRepository.findOne(1);
 * const options = await systemSettingOptionModel.findOptionBySettingId(settingEntity);
 */
public async findOptionBySetting(settingEntity:SystemSettingEntity): Promise<SystemSettingOptionEntity[]> {
    // Match by the relation's primary key. Passing the full entity instance
    // into FindOptionsWhere does not match rows under TypeORM 0.3 (returns
    // [] even when FK rows exist), which left the Language switch empty.
    return this.repository.find({
        where: {
            systemSetting: { id: settingEntity.id }
        }
    })
}

/**
 * Initialize language options for a language preference setting
 * @param settingEntity - The language preference setting entity
 */
public async initLanguageOptions(settingEntity: SystemSettingEntity): Promise<void> {
    // Seeded from the shared language config so the switch offers exactly
    // the languages the app ships (src/views/lang/*).
    for (const option of SUPPORTED_LANGUAGES) {
        // Match the FK by primary key (entity instances do not match in
        // FindOptionsWhere under TypeORM 0.3).
        const existingOption = await this.repository.findOne({
            where: { 
                systemSetting: { id: settingEntity.id },
                value: option.code
            }
        });

        if (!existingOption) {
            const optionEntity = new SystemSettingOptionEntity();
            optionEntity.systemSetting = settingEntity;
            optionEntity.value = option.code;
            optionEntity.label = option.label;
            optionEntity.description = option.description;
            await this.repository.save(optionEntity);
        }
    }
}


}