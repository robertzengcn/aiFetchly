import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { EmailSearchResultEntity } from "@/entity/EmailSearchResult.entity";

export class EmailsearchResultModel extends BaseDb {
    private repository: Repository<EmailSearchResultEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(EmailSearchResultEntity);
    }

    async create(emailsearchResult: EmailSearchResultEntity): Promise<number> {
        const item = await this.getByTaskIdUrl(emailsearchResult.task_id, emailsearchResult.email);
        if (item) {
            return item.id;
        }

        const savedResult = await this.repository.save(emailsearchResult);
        return savedResult.id;
    }

    async read(id: number): Promise<EmailSearchResultEntity | null> {
        return this.repository.findOne({ where: { id } });
    }

    async update(id: number, emailsearchResult: EmailSearchResultEntity): Promise<boolean> {
        const result = await this.repository.update(id, emailsearchResult);
        return result.affected?true:false
    }

    async delete(id: number): Promise<boolean> {
        const result = await this.repository.delete(id);
        return result.affected?true:false
    }

    async getByTaskIdUrl(taskId: number, email: string): Promise<EmailSearchResultEntity | null> {
        return this.repository.findOne({ where: { task_id: taskId, email } });
    }

    async getTaskResult(taskId: number, page: number, size: number): Promise<EmailSearchResultEntity[]> {
        return this.repository.find({
            where: { task_id: taskId },
            skip: page,
            take: size
        });
    }

    async getTaskResultCount(taskId: number): Promise<number> {
        return this.repository.count({ where: { task_id: taskId } });
    }
} 