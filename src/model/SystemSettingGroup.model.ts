import { BaseDb } from "@/model/Basedb";
import { log } from "@/modules/Logger";
import { Repository } from "typeorm"
import { SystemSettingGroupEntity } from "@/entity/SystemSettingGroup.entity"
import {SystemSettingModel} from "@/model/SystemSetting.model"
import {settinggroupInit, language_preference, embedding_group} from "@/config/settinggroupInit"
import { SystemSettingEntity } from "@/entity/SystemSetting.entity"
import {SystemSettingOptionModel} from "@/model/SystemSettingOption.model"
import { SqliteDb } from "@/config/SqliteDb";

export class SystemSettingGroupModel extends BaseDb {
    private _repository: Repository<SystemSettingGroupEntity> | null = null;
    private systemSettingModel:SystemSettingModel
    private systemSettingOptionModel:SystemSettingOptionModel
    private filepath: string;
    constructor(filepath: string) {
        super(filepath)
        this.filepath = filepath;
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
                    await SqliteDb.ensureInitialized();
                    log.info('Database connection initialized in SystemSettingGroupModel');
                } catch (error) {
                    // Check if error is about already being initialized
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    if (!errorMessage.includes('already initialized') && !errorMessage.includes('already been initialized')) {
                        log.error('Failed to initialize database connection:', error);
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
                log.error('Failed to get repository for SystemSettingGroupEntity:', error);
                throw new Error(`Failed to get repository: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        return this._repository;
    }
    private static inFlightInitByPath = new Map<string, Promise<void>>();

    public async tableInit(): Promise<void> {
        await this.initSystemSetting();
    }

    public async initSystemSetting(): Promise<void> {
        const key = this.filepath || "default";
        const existing = SystemSettingGroupModel.inFlightInitByPath.get(key);
        if (existing) {
            return existing;
        }
        const promise = (async () => {
            try {
                await this._doInitSystemSetting();
            } finally {
                SystemSettingGroupModel.inFlightInitByPath.delete(key);
            }
        })();
        SystemSettingGroupModel.inFlightInitByPath.set(key, promise);
        return promise;
    }

    private async _doInitSystemSetting(): Promise<void> {
        const repository = await this.getRepository();

        // Remove deprecated groups and their settings.
        for (const name of ['Deepseek-local', 'deepseek-api-group', 'grokai-group', 'openai-group', 'volcengine-group']) {
            const deprecatedGroup = await repository.findOne({
                where: { name },
                relations: { settings: true },
            });
            if (deprecatedGroup) {
                for (const s of deprecatedGroup.settings ?? []) {
                    await this.systemSettingModel.removeById(s.id);
                }
                await repository.remove(deprecatedGroup);
                log.info(`[system-setting] removed deprecated group: ${name}`);
            }
        }

        for(const sgelement of settinggroupInit){
        //    console.log(sgelement)
            let settargroup = await repository.findOne({
                where:{name: sgelement.name},
             })
                if (!settargroup) {
                    const systemSettingGroupEntity = new SystemSettingGroupEntity();
                    systemSettingGroupEntity.name = sgelement.name;
                    systemSettingGroupEntity.description = sgelement.description? sgelement.description:'';
                    try {
                        settargroup = await repository.save(systemSettingGroupEntity);
                    } catch {
                        settargroup = await repository.findOne({
                            where: { name: sgelement.name },
                        });
                    }
                }
                // Ensure settargroup is not null before using it
                if (!settargroup) {
                    log.error(`Failed to create or find setting group: ${sgelement.name}`);
                    continue; // Skip this group if we can't create/find it
                }
                for(const settingelement of sgelement.items){
                    await this.systemSettingModel.getSettingItem(settingelement.key).then(async (setting)=>{
                        const isLanguageKey = settingelement.key === language_preference;
                        if(!setting){
                            const systemSettingEntity = new SystemSettingEntity();
                            systemSettingEntity.group = settargroup!; // Safe to use ! here since we checked above
                            systemSettingEntity.key = settingelement.key;
                            systemSettingEntity.value = settingelement.value;
                            systemSettingEntity.description = settingelement.description? settingelement.description:'';
                            systemSettingEntity.type = settingelement.type;
                            let savedSetting: SystemSettingEntity | null = null;
                            try {
                                savedSetting = await this.systemSettingModel.insert(systemSettingEntity);
                            } catch (err: unknown) {
                                const errorMsg = err instanceof Error ? err.message : String(err);
                                if (
                                    errorMsg.includes('UNIQUE constraint failed') ||
                                    errorMsg.includes('SQLITE_CONSTRAINT') ||
                                    errorMsg.includes('constraint failed')
                                ) {
                                    log.warn(`[system-setting] Setting already exists for key "${settingelement.key}", using existing.`);
                                    savedSetting = await this.systemSettingModel.getSettingItem(settingelement.key);
                                } else {
                                    throw err;
                                }
                            }
                           
                           // Initialize language options if this is the language preference setting
                           if (isLanguageKey && savedSetting) {
                               await this.systemSettingOptionModel.initLanguageOptions(savedSetting);
                           }
                       }else{
                            await this.systemSettingModel.updateGroup(setting, settargroup!)
                            // Self-heal: databases created before option seeding
                            // existed have a language row with NO option rows —
                            // re-run the idempotent seed on every boot too.
                            if (isLanguageKey) {
                                await this.systemSettingOptionModel.initLanguageOptions(setting);
                            }
                        }
                    })
                }
        }
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
