import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { SearchAccountEntity } from "@/entity/SearchAccount.entity";

export class SearchAccountModel extends BaseDb {
    private repository: Repository<SearchAccountEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(SearchAccountEntity);
    }

    async create(searchAccount: SearchAccountEntity): Promise<number> {
        const result = await this.repository.save(searchAccount);
        return result.id;
    }

    async read(id: number): Promise<SearchAccountEntity | null> {
        return this.repository.findOne({ where: { id } });
    }

    async update(id: number, searchAccount: SearchAccountEntity): Promise<number> {
        const result = await this.repository.update(id, searchAccount);
        return result.affected || 0;
    }

    async delete(id: number): Promise<number> {
        const result = await this.repository.delete(id);
        return result.affected || 0;
    }

    async getAccountByTaskId(taskId: number): Promise<SearchAccountEntity[]> {
        return this.repository.find({ where: { task_id: taskId } });
    }
} 