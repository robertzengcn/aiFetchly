import { BaseModule } from "@/modules/baseModule";
import { SearchAccountModel } from "@/model/SearchAccount.model";
import { SearchAccountEntity } from "@/entity/SearchAccount.entity";

export class SearchAccountModule extends BaseModule {
    private searchAccountDb: SearchAccountModel;

    constructor() {
        super();
        this.searchAccountDb = new SearchAccountModel(this.dbpath);
    }

    async create(searchAccount: SearchAccountEntity): Promise<number> {
        return await this.searchAccountDb.create(searchAccount);
    }

    async read(id: number): Promise<SearchAccountEntity | null> {
        return await this.searchAccountDb.read(id);
    }

    async update(id: number, searchAccount: SearchAccountEntity): Promise<void> {
        await this.searchAccountDb.update(id, searchAccount);
    }

    async delete(id: number): Promise<void> {
        await this.searchAccountDb.delete(id);
    }

    async getAccountByTaskId(taskId: number): Promise<Array<SearchAccountEntity>> {
        return await this.searchAccountDb.getAccountByTaskId(taskId);
    }
} 