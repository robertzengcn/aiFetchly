import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { SearchTaskProxyEntity } from "@/entity/SearchTaskProxy.entity";

export class SearchTaskProxyModel extends BaseDb {
    private repository: Repository<SearchTaskProxyEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(SearchTaskProxyEntity);
    }

    async create(stpe: SearchTaskProxyEntity): Promise<number> {
        const result = await this.repository.save(stpe);
        return result.id;
    }

    async read(id: number): Promise<SearchTaskProxyEntity | null> {
        return this.repository.findOne({ where: { id } });
    }

    async update(id: number, stpe: SearchTaskProxyEntity): Promise<number> {
        const result = await this.repository.update(id, stpe);
        return result.affected || 0;
    }

    async delete(id: number): Promise<number> {
        const result = await this.repository.delete(id);
        return result.affected || 0;
    }

    async getItemsByTaskId(taskId: number): Promise<SearchTaskProxyEntity[]> {
        return this.repository.find({ where: { task_id: taskId } });
    }
} 