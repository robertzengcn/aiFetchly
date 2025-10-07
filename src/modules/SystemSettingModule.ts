import { BaseModule } from "@/modules/baseModule";
import {SystemSettingModel} from "@/model/SystemSetting.model"
import {SystemSettingEntity} from "@/entity/SystemSetting.entity"
import {SystemSettingGroupEntity} from "@/entity/SystemSettingGroup.entity"

export class SystemSettingModule extends BaseModule {
   
   private systemSettingModel:SystemSettingModel
   constructor() {
       super()
       this.systemSettingModel = new SystemSettingModel(this.dbpath)
   }
   public async updateSystemSetting(settingId:number, settingValue:string|null): Promise<SystemSettingEntity>{
   return this.systemSettingModel.updateSystemSetting(settingId,settingValue)
    }

    /**
     * Get or create default embedding model setting
     * @param group SystemSettingGroupEntity for embedding settings
     * @returns SystemSettingEntity for default embedding model
     */
    public async getOrCreateDefaultEmbeddingModel(group: SystemSettingGroupEntity): Promise<SystemSettingEntity> {
        return this.systemSettingModel.getOrCreateDefaultEmbeddingModel(group);
    }

    /**
     * Update default embedding model setting
     * @param modelName New embedding model name
     * @param group SystemSettingGroupEntity for embedding settings
     * @returns Updated SystemSettingEntity
     */
    public async updateDefaultEmbeddingModel(modelName: string, group: SystemSettingGroupEntity): Promise<SystemSettingEntity> {
        return this.systemSettingModel.updateDefaultEmbeddingModel(modelName, group);
    }

    /**
     * Get default embedding model value
     * @param group SystemSettingGroupEntity for embedding settings
     * @returns Default embedding model name or null if not found
     */
    public async getDefaultEmbeddingModel(): Promise<string | null> {
        return this.systemSettingModel.getDefaultEmbeddingModel();
    }
}