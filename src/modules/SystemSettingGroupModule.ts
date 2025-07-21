import { BaseModule } from "@/modules/baseModule";
import {SystemSettingGroupModel} from "@/model/SystemSettingGroup.model"
import {SystemSettingGroupEntity} from "@/entity/SystemSettingGroup.entity"

export class SystemSettingGroupModule extends BaseModule {
   
    private systemSettingGroupModel:SystemSettingGroupModel
    constructor() {
        super()
        this.systemSettingGroupModel = new SystemSettingGroupModel(this.dbpath)
    //    this.repository = this.sqliteDb.connection.getRepository(SystemSettingGroupEntity)
    }
    public async tableInit(){
        await this.systemSettingGroupModel.tableInit()
    }
    public async listall(): Promise<SystemSettingGroupEntity[]>{
        // return this.repository.find()
        return this.systemSettingGroupModel.listall()
    }
    public async getGroupItembyName(name:string): Promise<SystemSettingGroupEntity | null>{
        return this.systemSettingGroupModel.getGroupItembyName(name)
    }
}