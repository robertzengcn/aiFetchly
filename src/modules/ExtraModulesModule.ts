import { BaseModule } from "@/modules/baseModule";
import { ExtraModulesModel } from "@/model/ExtraModulesdb.model";
import { ExtraModuleEntity } from "@/entity/ExtraModule.entity";
// import { ExtraModuleEntity } from "@/entityTypes/extramoduleType";

export class ExtraModulesModule extends BaseModule {
    private extraModulesdb: ExtraModulesModel
    constructor() {
        super()
        this.extraModulesdb = new ExtraModulesModel(this.dbpath)
    }
    async create(extraModule: Omit<ExtraModuleEntity, 'id'>): Promise<number> {
        return await this.extraModulesdb.create(extraModule)
    }
    //get item from extra module
    async read(id: number): Promise<ExtraModuleEntity | null> {
        return await this.extraModulesdb.read(id)
    }
    //update extra module   
    async update(id: number, extraModule: ExtraModuleEntity): Promise<boolean> {
        return await this.extraModulesdb.update(id, extraModule)
    }
    //delete extra module
    async delete(id: number): Promise<boolean> {
        return await this.extraModulesdb.delete(id)
    }
    //get extra module by name
    async getExtraModuleByName(name: string): Promise<ExtraModuleEntity | null> {
        return await this.extraModulesdb.getExtraModuleByName(name)
    }
    async deletePackage(name: string): Promise<boolean> {
        return await this.extraModulesdb.deletePackage(name)
    }
}