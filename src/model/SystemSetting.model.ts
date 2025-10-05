import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm"
import { SystemSettingEntity } from "@/entity/SystemSetting.entity"
import { SystemSettingGroupEntity } from "@/entity/SystemSettingGroup.entity"
import { default_embedding_model, embedding_group_description } from "@/config/settinggroupInit";


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

    /**
     * Get or create default embedding model setting
     * @param group SystemSettingGroupEntity for embedding settings
     * @returns SystemSettingEntity for default embedding model
     */
    public async getOrCreateDefaultEmbeddingModel(group: SystemSettingGroupEntity): Promise<SystemSettingEntity> {
        const defaultEmbeddingModelKey = default_embedding_model;
        const defaultEmbeddingModelValue = 'Qwen/Qwen3-Embedding-4B'; // Default model

        let defaultEmbeddingModelSetting = await this.repository.findOne({
            where: { group: group, key: defaultEmbeddingModelKey }
        });

        if (!defaultEmbeddingModelSetting) {
            const systemSettingEntity = new SystemSettingEntity();
            systemSettingEntity.group = group;
            systemSettingEntity.key = defaultEmbeddingModelKey;
            systemSettingEntity.value = defaultEmbeddingModelValue;
            systemSettingEntity.description = 'Default embedding model for document processing';
            systemSettingEntity.type = 'select';
            defaultEmbeddingModelSetting = await this.repository.save(systemSettingEntity);
        }

        return defaultEmbeddingModelSetting;
    }

    /**
     * Update default embedding model setting
     * @param modelName New embedding model name
     * @param group SystemSettingGroupEntity for embedding settings
     * @returns Updated SystemSettingEntity
     */
    public async updateDefaultEmbeddingModel(modelName: string, group: SystemSettingGroupEntity): Promise<SystemSettingEntity> {
        const defaultEmbeddingModelKey = default_embedding_model;
        
        let setting = await this.repository.findOne({
            where: { key: defaultEmbeddingModelKey }
        });

        if (!setting) {
            // Create new setting if it doesn't exist
            const systemSettingEntity = new SystemSettingEntity();
            systemSettingEntity.group = group;
            systemSettingEntity.key = defaultEmbeddingModelKey;
            systemSettingEntity.value = modelName;
            systemSettingEntity.description = embedding_group_description;
            systemSettingEntity.type = 'select';
            setting = await this.repository.save(systemSettingEntity);
        } else {
            // Update existing setting
            setting.value = modelName;
            setting = await this.repository.save(setting);
        }

        return setting;
    }

    /**
     * Get default embedding model value
     * @param group SystemSettingGroupEntity for embedding settings
     * @returns Default embedding model name or null if not found
     */
    public async getDefaultEmbeddingModel(group: SystemSettingGroupEntity): Promise<string | null> {
        const defaultEmbeddingModelKey = default_embedding_model;
        
        const setting = await this.repository.findOne({
            where: { group: group, key: defaultEmbeddingModelKey }
        });

        return setting ? setting.value : null;
    }
}