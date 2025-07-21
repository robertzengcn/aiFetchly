import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm"
import { SystemSettingEntity } from "@/entity/SystemSetting.entity"
import { SystemSettingGroupEntity } from "@/entity/SystemSettingGroup.entity"


export class SystemSettingModel extends BaseDb {
    private repository: Repository<SystemSettingEntity>
    constructor(filepath: string) {
        super(filepath)
      
        this.repository = this.sqliteDb.connection.getRepository(SystemSettingEntity)
    }
    public async tableInit() {
        // this.sqliteDb.connection  
        
    }

    public async InsertDeepseekSetting(deepseekgroup:SystemSettingGroupEntity) {
        await this.InsertDeepseekUrl(deepseekgroup)
    }
    public async InsertDeepseekUrl(deepseekgroup:SystemSettingGroupEntity) {
        const deepseek_local_url_key='deepseek-local-url'
        const deepseek_local_url_value='http://localhost:11434'

        let deepseeksettingurl = await this.repository.findOne({
            where: { group: deepseekgroup,key:deepseek_local_url_key }
        })
        if (!deepseeksettingurl) {
            const systemSettingEntity = new SystemSettingEntity();
            systemSettingEntity.group = deepseekgroup;
            systemSettingEntity.key = deepseek_local_url_key;
            systemSettingEntity.value = deepseek_local_url_value;
            systemSettingEntity.description = 'deepseek-local-url-description';
            systemSettingEntity.type = 'input';
            deepseeksettingurl = await this.repository.save(systemSettingEntity)
        }
        return deepseeksettingurl
    }
    public async getSettingItem(key:string):Promise<SystemSettingEntity|null>{
        return this.repository.findOne({
            where: { key: key }
        })
    }
    public async insert(systemSettingEntity:SystemSettingEntity){
        return this.repository.save(systemSettingEntity)
    }
    //update system setting group field
    public async updateGroup(systemSettingEntity:SystemSettingEntity,systemsettinggroup:SystemSettingGroupEntity){
        if (!systemSettingEntity.id) {
            throw new Error("Entity ID is required for update");
        }
        systemSettingEntity.group = systemsettinggroup;
        return this.repository.save(systemSettingEntity);
        // return this.repository.update(
        //     systemSettingEntity.id,
        //     { group: systemSettingEntity.group }
        // );
    }
    // update system setting value
    public async updateSystemSetting(settingId:number, settingValue:string|null): Promise<SystemSettingEntity>{
       if(!settingId){
           throw new Error("settingId is required");
       }
       if(!settingValue){
        settingValue=""
       }
       const itemToUpdate =await this.repository.findOneBy({
            id:settingId
        })
        if(!itemToUpdate){
            throw new Error("settingId not found")
        }
        itemToUpdate.value=settingValue
        return this.repository.save(itemToUpdate)

    }
}