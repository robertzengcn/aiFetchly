import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm"
import {SystemSettingOptionEntity} from "@/entity/SystemSettingOption.entity"
import {SystemSettingEntity} from "@/entity/SystemSetting.entity"

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
    return this.repository.find({
        where: { systemSetting: settingEntity }
    })
}

/**
 * Initialize language options for a language preference setting
 * @param settingEntity - The language preference setting entity
 */
public async initLanguageOptions(settingEntity: SystemSettingEntity): Promise<void> {
    const languageOptions = [
        { value: 'en', label: 'English', description: 'English language' },
        { value: 'zh', label: '中文', description: 'Chinese language' }
    ];

    for (const option of languageOptions) {
        const existingOption = await this.repository.findOne({
            where: { 
                systemSetting: settingEntity,
                value: option.value
            }
        });

        if (!existingOption) {
            const optionEntity = new SystemSettingOptionEntity();
            optionEntity.systemSetting = settingEntity;
            optionEntity.value = option.value;
            optionEntity.label = option.label;
            optionEntity.description = option.description;
            await this.repository.save(optionEntity);
        }
    }
}


}