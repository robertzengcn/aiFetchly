import { SearchTaskProxyModel } from "@/model/SearchTaskProxy.model";
import { BaseModule } from "@/modules/baseModule";
import { SearchTaskProxyEntity } from "@/entity/SearchTaskProxy.entity";

export class SearchTaskProxyModule extends BaseModule {
    private searchTaskProxydb: SearchTaskProxyModel

    constructor() {
        super()
        this.searchTaskProxydb = new SearchTaskProxyModel(this.dbpath)
    }

    async create(taskId: number, proxyId: number): Promise<number> {
        const stpeEntity = new SearchTaskProxyEntity();
        stpeEntity.task_id = taskId;
        stpeEntity.proxy_id = proxyId;
        
        return await this.searchTaskProxydb.create(stpeEntity);
    }

    async read(id: number): Promise<SearchTaskProxyEntity | null> {
        return await this.searchTaskProxydb.read(id);
    }

    async update(id: number, stpe: SearchTaskProxyEntity): Promise<void> {
        await this.searchTaskProxydb.update(id, stpe);
    }

    async delete(id: number): Promise<void> {
        await this.searchTaskProxydb.delete(id);
    }

    public async getItemsByTaskId(taskId: number): Promise<Array<SearchTaskProxyEntity>> {
        return await this.searchTaskProxydb.getItemsByTaskId(taskId);
    }
} 