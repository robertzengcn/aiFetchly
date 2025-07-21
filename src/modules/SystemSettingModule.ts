import { BaseModule } from "@/modules/baseModule";
import {SystemSettingModel} from "@/model/SystemSetting.model"
import {SystemSettingEntity} from "@/entity/SystemSetting.entity"

export class SystemSettingModule extends BaseModule {
   
   private systemSettingModel:SystemSettingModel
   constructor() {
       super()
       this.systemSettingModel = new SystemSettingModel(this.dbpath)
   }
   public async updateSystemSetting(settingId:number, settingValue:string|null): Promise<SystemSettingEntity>{
   return this.systemSettingModel.updateSystemSetting(settingId,settingValue)
    }

}