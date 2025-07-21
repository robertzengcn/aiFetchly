import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { EmailSearchTaskUrlEntity } from "@/entity/EmailSearchTaskUrl.entity";
import { EmailsearchUrlEntity } from "./emailsearchUrldb";

export class EmailsearchTaskUrlModel extends BaseDb {
    private repository: Repository<EmailSearchTaskUrlEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(EmailSearchTaskUrlEntity);
    }

    async create(emailsearchUrl: EmailsearchUrlEntity): Promise<number> {
        const entity = new EmailSearchTaskUrlEntity();
        entity.task_id = emailsearchUrl.task_id;
        entity.url = emailsearchUrl.url;

        const savedEntity = await this.repository.save(entity);
        return savedEntity.id;
    }

    async read(id: number): Promise<EmailsearchUrlEntity | null> {
        const entity = await this.repository.findOne({ where: { id } });
        if (!entity) return null;

        return {
            id: entity.id,
            task_id: entity.task_id,
            url: entity.url
        };
    }

    async update(emailsearchUrl: EmailsearchUrlEntity): Promise<boolean> {
        if (!emailsearchUrl.id) {
            throw new Error("URL ID is required for update");
        }

        const entity = await this.repository.findOne({ where: { id: emailsearchUrl.id } });
        if (!entity) return false;

        entity.task_id = emailsearchUrl.task_id;
        entity.url = emailsearchUrl.url;

        const result = await this.repository.save(entity);
        return !!result;
    }

    async delete(id: number): Promise<boolean> {
        const result = await this.repository.delete(id);
        return result.affected ? true : false;
    }

    async getUrls(taskId: number, page: number, size: number): Promise<EmailsearchUrlEntity[]> {
        const entities = await this.repository.find({
            where: { task_id: taskId },
            skip: page,
            take: size
        });

        return entities.map(entity => ({
            id: entity.id,
            task_id: entity.task_id,
            url: entity.url
        }));
    }
    async getAllUrlsByTaskId(taskId: number): Promise<EmailsearchUrlEntity[]> {
        const entities = await this.repository.find({
            where: { task_id: taskId }
        });

        return entities.map(entity => ({
            id: entity.id,
            task_id: entity.task_id,
            url: entity.url
        }));
    }
} 