import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm"
import { SystemSettingGroupEntity } from "@/entity/SystemSettingGroup.entity"
import {SystemSettingModel} from "@/model/SystemSetting.model"
import {settinggroupInit, language_preference, embedding_group} from "@/config/settinggroupInit"
import { SystemSettingEntity } from "@/entity/SystemSetting.entity"
import {SystemSettingOptionModel} from "@/model/SystemSettingOption.model"

export const deepseeklocalgroup = 'Deepseek-local'
export class SystemSettingGroupModel extends BaseDb {
    private _repository: Repository<SystemSettingGroupEntity> | null = null;
    private systemSettingModel:SystemSettingModel
    private systemSettingOptionModel:SystemSettingOptionModel
    constructor(filepath: string) {
        super(filepath)
        this.systemSettingModel = new SystemSettingModel(filepath)
        this.systemSettingOptionModel = new SystemSettingOptionModel(filepath)
    }

    /**
     * Get repository, ensuring DataSource is initialized first
     */
    private async getRepository(): Promise<Repository<SystemSettingGroupEntity>> {
        if (!this._repository) {
            // Ensure DataSource is initialized before getting repository
            if (!this.sqliteDb.connection.isInitialized) {
                try {
                    await this.sqliteDb.connection.initialize();
                    console.log('Database connection initialized in SystemSettingGroupModel');
                } catch (error) {
                    // Check if error is about already being initialized
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    if (!errorMessage.includes('already initialized') && !errorMessage.includes('already been initialized')) {
                        console.error('Failed to initialize database connection:', error);
                        throw new Error(`Failed to initialize database connection: ${errorMessage}`);
                    }
                    // If already initialized, that's fine - continue
                }
            }
            
            // Verify the connection is initialized before getting repository
            if (!this.sqliteDb.connection.isInitialized) {
                throw new Error('DataSource is not initialized and initialization failed');
            }
            
            try {
                this._repository = this.sqliteDb.connection.getRepository(SystemSettingGroupEntity);
            } catch (error) {
                console.error('Failed to get repository for SystemSettingGroupEntity:', error);
                throw new Error(`Failed to get repository: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        return this._repository;
    }
    public async tableInit() {
        await this.initSystemSetting()
       //const deepseekgroup=await this.insertDeepseekgroup()
       //await this.systemSettingModel.InsertDeepseekSetting(deepseekgroup) 
    }
    public async initSystemSetting(){
        console.log(settinggroupInit)
        const repository = await this.getRepository();
        for(const sgelement of settinggroupInit){
           console.log(sgelement)
            let settargroup = await repository.findOne({
                where:{name: sgelement.name},
             })
                if (!settargroup) {
                    const systemSettingGroupEntity = new SystemSettingGroupEntity();
                    systemSettingGroupEntity.name = sgelement.name;
                    systemSettingGroupEntity.description = sgelement.description? sgelement.description:'';
                    settargroup = await repository.save(systemSettingGroupEntity)
                }
                // Ensure settargroup is not null before using it
                if (!settargroup) {
                    console.error(`Failed to create or find setting group: ${sgelement.name}`);
                    continue; // Skip this group if we can't create/find it
                }
                for(const settingelement of sgelement.items){
                    await this.systemSettingModel.getSettingItem(settingelement.key).then(async (setting)=>{
                        if(!setting){
                            const systemSettingEntity = new SystemSettingEntity();
                            systemSettingEntity.group = settargroup!; // Safe to use ! here since we checked above
                            systemSettingEntity.key = settingelement.key;
                            systemSettingEntity.value = settingelement.value;
                            systemSettingEntity.description = settingelement.description? settingelement.description:'';
                            systemSettingEntity.type = settingelement.type;
                           const savedSetting = await this.systemSettingModel.insert(systemSettingEntity)
                           
                           // Initialize language options if this is the language preference setting
                           if (settingelement.key === language_preference) {
                               await this.systemSettingOptionModel.initLanguageOptions(savedSetting);
                           }
                        }else{
                            await this.systemSettingModel.updateGroup(setting, settargroup!)
                        }
                    })
                }
        }
    }
    public async insertDeepseekgroup():Promise<SystemSettingGroupEntity>{
        const repository = await this.getRepository();
        let deepseekgroup = await repository.findOne({
            where:{name: deepseeklocalgroup},
            relations: {settings:true}
         })
         if (!deepseekgroup) {
             const systemSettingGroupEntity = new SystemSettingGroupEntity();
             systemSettingGroupEntity.name = deepseeklocalgroup;
             systemSettingGroupEntity.description = 'deepseek-local-group-description';
             

             deepseekgroup=await repository.save(systemSettingGroupEntity)
         }
         return deepseekgroup
    }

    public async listall(): Promise<SystemSettingGroupEntity[]> {
        const repository = await this.getRepository();
        return repository.find({
            order: {
                id: 'ASC'  // or 'DESC' for descending
            },
            relations: {
                settings: true
            }
           
        })
    }
    public async getGroupItembyName(name: string): Promise<SystemSettingGroupEntity | null> {
        const repository = await this.getRepository();
        return repository.findOne({
            where: { name: name },
            relations: {
                settings: true
            }
        });
    }

    /**
     * Get or create embedding settings group
     * @returns SystemSettingGroupEntity for embedding settings
     */
    public async getOrCreateEmbeddingGroup(): Promise<SystemSettingGroupEntity> {
        const repository = await this.getRepository();
        const embeddingGroupName = embedding_group;
        
        let embeddingGroup = await repository.findOne({
            where: { name: embeddingGroupName },
            relations: { settings: true }
        });

        if (!embeddingGroup) {
            const systemSettingGroupEntity = new SystemSettingGroupEntity();
            systemSettingGroupEntity.name = embeddingGroupName;
            systemSettingGroupEntity.description = 'Settings for embedding models and document processing';
            embeddingGroup = await repository.save(systemSettingGroupEntity);
        }

        return embeddingGroup;
    }

    /**
     * Create a new system setting group
     * @param name Group name
     * @param description Group description
     * @returns Created SystemSettingGroupEntity
     */
    public async createGroup(name: string, description: string): Promise<SystemSettingGroupEntity> {
        const repository = await this.getRepository();
        const systemSettingGroupEntity = new SystemSettingGroupEntity();
        systemSettingGroupEntity.name = name;
        systemSettingGroupEntity.description = description;
        return await repository.save(systemSettingGroupEntity);
    }
   



}