import { BaseModule } from "@/modules/baseModule";
// import {SystemSettingGroupModel} from "@/model/SystemSettingGroup.model"
import {SystemSettingOptionModel} from "@/model/SystemSettingOption.model"
import {SystemSettingEntity} from "@/entity/SystemSetting.entity"

export class SystemSettingOptionModule extends BaseModule {
   
    private systemSettingOptionModel:SystemSettingOptionModel
    constructor() {
        super()
        this.systemSettingOptionModel = new SystemSettingOptionModel(this.dbpath)
    //    this.repository = this.sqliteDb.connection.getRepository(SystemSettingGroupEntity)
    }
    public async findOptionBySetting(settingEntity:SystemSettingEntity){
        return this.systemSettingOptionModel.findOptionBySetting(settingEntity)
    }
}