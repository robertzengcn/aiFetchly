import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { ExtraModuleEntity } from "@/entity/ExtraModule.entity";
import { getRecorddatetime } from "@/modules/lib/function";

export class ExtraModulesModel extends BaseDb {
    private repository: Repository<ExtraModuleEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(ExtraModuleEntity);
    }

    async create(extraModule: Omit<ExtraModuleEntity, 'id'>): Promise<number> {
        const ext = await this.getExtraModuleByName(extraModule.name);
        if (ext) {
            // const updateExtraModule = {
            //     id: ext.id,
            //     name: extraModule.name,
            //     version: extraModule.version,
            //     record_time: getRecorddatetime()
            // };
            const updateExtraModule = new ExtraModuleEntity();
            updateExtraModule.id = ext.id;
            updateExtraModule.name = extraModule.name;
            updateExtraModule.version = extraModule.version;
            updateExtraModule.record_time = getRecorddatetime();
            await this.update(ext.id, updateExtraModule);
            return ext.id;
        } else {
            const newModule = new ExtraModuleEntity();
            newModule.name = extraModule.name;
            newModule.version = extraModule.version;
            newModule.record_time = getRecorddatetime();
            const result = await this.repository.save(newModule);
            return result.id;
        }
    }

    async read(id: number): Promise<ExtraModuleEntity | null> {
        return await this.repository.findOne({
            where: { id }
        });
    }

    async update(id: number, extraModule: ExtraModuleEntity): Promise<boolean> {
        const result = await this.repository.update(id, {
            name: extraModule.name,
            version: extraModule.version,
            record_time: getRecorddatetime()
        });
        return result.affected !== undefined && result.affected > 0;
    }

    async delete(id: number): Promise<boolean> {
        const result = await this.repository.delete(id);
        return result.affected !== undefined && result.affected ? true : false;
    }

    async getExtraModuleByName(name: string): Promise<ExtraModuleEntity | null> {
        return await this.repository.findOne({
            where: { name }
        });
    }

    async deletePackage(name: string): Promise<boolean> {
        const result = await this.repository.delete({ name });
        return result.affected !== undefined && result.affected ? true : false;
    }

    async truncatedb(): Promise<void> {
        await this.repository.clear();
    }
} 