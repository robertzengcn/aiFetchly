import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm"
import { SystemSettingGroupEntity } from "@/entity/SystemSettingGroup.entity"
import {SystemSettingModel} from "@/model/SystemSetting.model"
import {settinggroupInit} from "@/config/settinggroupInit"
import { SystemSettingEntity } from "@/entity/SystemSetting.entity"

export const deepseeklocalgroup = 'Deepseek-local'
export class SystemSettingGroupModel extends BaseDb {
    private repository: Repository<SystemSettingGroupEntity>
    private systemSettingModel:SystemSettingModel
    constructor(filepath: string) {
        super(filepath)
        this.systemSettingModel = new SystemSettingModel(filepath)
        this.repository = this.sqliteDb.connection.getRepository(SystemSettingGroupEntity)
       
    }
    public async tableInit() {
        await this.initSystemSetting()
       //const deepseekgroup=await this.insertDeepseekgroup()
       //await this.systemSettingModel.InsertDeepseekSetting(deepseekgroup) 
    }
    public async initSystemSetting(){
        console.log(settinggroupInit)
        for(const sgelement of settinggroupInit){
           console.log(sgelement)
            let settargroup=await this.repository.findOne({
                where:{name: sgelement.name},
             })
                if (!settargroup) {
                    const systemSettingGroupEntity = new SystemSettingGroupEntity();
                    systemSettingGroupEntity.name = sgelement.name;
                    systemSettingGroupEntity.description = sgelement.description? sgelement.description:'';
                    settargroup=await this.repository.save(systemSettingGroupEntity)
                }
                for(const settingelement of sgelement.items){
                    await this.systemSettingModel.getSettingItem(settingelement.key).then(async (setting)=>{
                        if(!setting){
                            const systemSettingEntity = new SystemSettingEntity();
                            systemSettingEntity.group = settargroup;
                            systemSettingEntity.key = settingelement.key;
                            systemSettingEntity.value = settingelement.value;
                            systemSettingEntity.description = settingelement.description? settingelement.description:'';
                            systemSettingEntity.type = settingelement.type;
                           await this.systemSettingModel.insert(systemSettingEntity)
                        }else{
                            await this.systemSettingModel.updateGroup(setting,settargroup)
                        }
                    })
                }
        }
    }
    public async insertDeepseekgroup():Promise<SystemSettingGroupEntity>{
        let deepseekgroup = await this.repository.findOne({
            where:{name: deepseeklocalgroup},
            relations: {settings:true}
         })
         if (!deepseekgroup) {
             const systemSettingGroupEntity = new SystemSettingGroupEntity();
             systemSettingGroupEntity.name = deepseeklocalgroup;
             systemSettingGroupEntity.description = 'deepseek-local-group-description';
             
 
             deepseekgroup=await this.repository.save(systemSettingGroupEntity)
         }
         return deepseekgroup
    }

    public async listall(): Promise<SystemSettingGroupEntity[]> {
        return this.repository.find({
            order: {
                id: 'ASC'  // or 'DESC' for descending
            },
            relations: {
                settings: true
            }
           
        })
    }
    public async getGroupItembyName(name: string): Promise<SystemSettingGroupEntity | null> {
        return this.repository.findOne({
            where: { name: name },
            relations: {
                settings: true
            }
        });
    }
   



}